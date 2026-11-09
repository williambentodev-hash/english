// Estatísticas de evolução. Com Firebase configurado e usuário autenticado, ficam no Firestore
// (ver services/db.ts); caso contrário, só no localStorage deste navegador.
import type { Feedback, Level } from './groq'
import { isLevel } from './groq'
import { firebaseReady } from '../lib/firebase'
import { clearStatsRemote, loadStatsRemote, recordPhraseRemote } from './db'

const STORAGE = 'tutor_stats_v1'
const MAX_SESSIONS = 200
const MAX_CORRECTIONS = 50

export interface SessionStat {
  id: string
  /** ISO da primeira frase da sessão */
  date: string
  level: Level
  /** frases enviadas pelo aluno e respondidas pelo tutor */
  phrases: number
  /** soma e quantidade de scores (frases em português não recebem score) */
  scoreSum: number
  scored: number
}

export interface CorrectionEntry {
  date: string
  level: Level
  said: string
  correction: string
  native: string
}

export interface Stats {
  sessions: SessionStat[]
  corrections: CorrectionEntry[]
}

const empty = (): Stats => ({ sessions: [], corrections: [] })

const isSession = (s: any): s is SessionStat =>
  s && typeof s.id === 'string' && typeof s.date === 'string' && isLevel(s.level) &&
  [s.phrases, s.scoreSum, s.scored].every((n) => typeof n === 'number' && Number.isFinite(n))

const isCorrection = (c: any): c is CorrectionEntry =>
  c && isLevel(c.level) && ['date', 'said', 'correction', 'native'].every((k) => typeof c[k] === 'string')

export function loadStats(): Stats {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE) ?? 'null')
    if (!data) return empty()
    return {
      sessions: Array.isArray(data.sessions) ? data.sessions.filter(isSession) : [],
      corrections: Array.isArray(data.corrections) ? data.corrections.filter(isCorrection) : [],
    }
  } catch {
    return empty()
  }
}

function saveStats(stats: Stats) {
  try {
    localStorage.setItem(STORAGE, JSON.stringify(stats))
  } catch {
    /* modo privado / storage cheio */
  }
}

export function clearStats() {
  try {
    localStorage.removeItem(STORAGE)
  } catch {
    /* ignore */
  }
}

export const newSessionId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

function recordPhraseLocal(sessionId: string, level: Level, said: string, feedback: Feedback | null) {
  const stats = loadStats()
  const now = new Date().toISOString()
  let s = stats.sessions.find((x) => x.id === sessionId && x.level === level)
  if (!s) {
    s = { id: sessionId, date: now, level, phrases: 0, scoreSum: 0, scored: 0 }
    stats.sessions.push(s)
  }
  s.phrases += 1
  if (feedback?.score != null) {
    s.scoreSum += feedback.score
    s.scored += 1
  }
  if (feedback?.correction) {
    stats.corrections.unshift({ date: now, level, said, correction: feedback.correction, native: feedback.native })
  }
  stats.sessions = stats.sessions.slice(-MAX_SESSIONS)
  stats.corrections = stats.corrections.slice(0, MAX_CORRECTIONS)
  saveStats(stats)
}

export const sessionAverage = (s: SessionStat) => (s.scored ? s.scoreSum / s.scored : null)

/* ---------------- Fachada: Firestore quando possível, localStorage como fallback ---------------- */

const useCloud = (uid: string | null | undefined): uid is string => !!uid && firebaseReady()

/** Registra uma frase avaliada. Trocar de nível no meio da conversa abre um novo registro. */
export async function recordPhrase(
  uid: string | null,
  sessionId: string,
  level: Level,
  said: string,
  feedback: Feedback | null,
  reply: string,
) {
  if (!useCloud(uid)) return recordPhraseLocal(sessionId, level, said, feedback)
  try {
    await recordPhraseRemote(uid, sessionId, level, said, feedback, reply)
  } catch (e) {
    console.warn('[stats] falha ao salvar no Firestore; gravando no localStorage.', e)
    recordPhraseLocal(sessionId, level, said, feedback)
  }
}

export async function fetchStats(uid: string | null): Promise<Stats> {
  return useCloud(uid) ? loadStatsRemote(uid) : loadStats()
}

export async function resetStats(uid: string | null) {
  if (useCloud(uid)) await clearStatsRemote(uid)
  clearStats()
}
