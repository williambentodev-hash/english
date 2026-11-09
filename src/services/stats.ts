// Estatísticas de evolução.
// - Firebase configurado + usuário autenticado: fonte de verdade é o Firestore (services/db.ts),
//   acompanhado em tempo real pelo dashboard.
// - Sem conexão (ou falha na gravação): a frase vai para uma fila no localStorage, enviada assim
//   que a conexão volta; enquanto isso o dashboard já a mostra mesclada aos dados da nuvem.
// - Firebase não configurado: tudo fica só no localStorage deste navegador.
import { useEffect } from 'react'
import type { Feedback, Level } from './groq'
import { isLevel } from './groq'
import { firebaseReady } from '../lib/firebase'
import { clearStatsRemote, feedbackDocId, recordPhraseRemote, subscribeStatsRemote, type PhraseRecord } from './db'

const STORAGE = 'tutor_stats_v1'
const PENDING = 'tutor_pending_v1'
const CACHE = (uid: string) => `tutor_stats_cache_v1_${uid}`
const CHANGED = 'tutor-stats-changed'
const MAX_SESSIONS = 200
const MAX_CORRECTIONS = 200
const MAX_PENDING = 500

export interface SessionStat {
  id: string
  /** ISO do início da conversa */
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
  /** explicação do erro, em português */
  correction: string
  native: string
  score?: number | null
}

export interface Stats {
  sessions: SessionStat[]
  corrections: CorrectionEntry[]
}

const empty = (): Stats => ({ sessions: [], corrections: [] })

/* ---------------- localStorage ---------------- */

function readJson(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null')
  } catch {
    return null
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* modo privado / storage cheio */
  }
}

function removeKey(key: string) {
  try {
    localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}

const notify = () => window.dispatchEvent(new Event(CHANGED))

const isSession = (s: any): s is SessionStat =>
  s && typeof s.id === 'string' && typeof s.date === 'string' && isLevel(s.level) &&
  [s.phrases, s.scoreSum, s.scored].every((n) => typeof n === 'number' && Number.isFinite(n))

const isCorrection = (c: any): c is CorrectionEntry =>
  c && isLevel(c.level) && ['date', 'said', 'correction', 'native'].every((k) => typeof c[k] === 'string') &&
  (c.score == null || typeof c.score === 'number')

function parseStats(data: any): Stats | null {
  if (!data || typeof data !== 'object') return null
  return {
    sessions: Array.isArray(data.sessions) ? data.sessions.filter(isSession) : [],
    corrections: Array.isArray(data.corrections) ? data.corrections.filter(isCorrection) : [],
  }
}

export const loadStats = (): Stats => parseStats(readJson(STORAGE)) ?? empty()

export function clearStats() {
  removeKey(STORAGE)
  notify()
}

export const newSessionId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
const newPhraseId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

/** Soma uma frase às estatísticas (sem mutar `stats`). */
function applyPhrase(stats: Stats, r: PhraseRecord): Stats {
  const sessions = stats.sessions.map((s) => ({ ...s }))
  let s = sessions.find((x) => x.id === r.sessionId && x.level === r.level)
  if (!s) {
    s = { id: r.sessionId, date: r.at, level: r.level, phrases: 0, scoreSum: 0, scored: 0 }
    sessions.push(s)
  }
  s.phrases += 1
  if (r.feedback?.score != null) {
    s.scoreSum += r.feedback.score
    s.scored += 1
  }
  const corrections = r.feedback?.correction
    ? [
        {
          date: r.at,
          level: r.level,
          said: r.said,
          correction: r.feedback.correction,
          native: r.feedback.native,
          score: r.feedback.score,
        },
        ...stats.corrections,
      ]
    : stats.corrections
  return {
    sessions: sessions.sort((a, b) => a.date.localeCompare(b.date)).slice(-MAX_SESSIONS),
    corrections: corrections.sort((a, b) => b.date.localeCompare(a.date)).slice(0, MAX_CORRECTIONS),
  }
}

/* ---------------- Fila offline ---------------- */

/** Frase aguardando envio. `uid` null = gravada antes do login; vai para o primeiro usuário que entrar. */
interface PendingPhrase extends PhraseRecord {
  uid: string | null
}

const isPending = (p: any): p is PendingPhrase =>
  p && (p.uid === null || typeof p.uid === 'string') && isLevel(p.level) &&
  ['id', 'sessionId', 'said', 'reply', 'at'].every((k) => typeof p[k] === 'string')

function loadPending(): PendingPhrase[] {
  const data = readJson(PENDING)
  return Array.isArray(data) ? data.filter(isPending) : []
}

function savePending(list: PendingPhrase[]) {
  if (list.length) writeJson(PENDING, list.slice(-MAX_PENDING))
  else removeKey(PENDING)
  notify()
}

const pendingFor = (uid: string | null) => loadPending().filter((p) => p.uid === null || p.uid === uid)

function addPending(p: PendingPhrase) {
  savePending([...loadPending(), p])
}

function removePending(ids: Set<string>) {
  savePending(loadPending().filter((p) => !ids.has(p.id)))
}

let flushing = false

/** Envia a fila offline ao Firestore, na ordem em que as frases foram feitas. */
export async function flushPending(uid: string) {
  if (flushing || !firebaseReady() || !navigator.onLine) return
  flushing = true
  try {
    for (const p of pendingFor(uid)) {
      try {
        await recordPhraseRemote(uid, p)
        removePending(new Set([p.id]))
      } catch (e) {
        console.warn('[stats] fila offline: envio falhou; tento de novo depois.', e)
        break
      }
    }
  } finally {
    flushing = false
  }
}

/** Envia a fila ao entrar e sempre que a conexão voltar. */
export function usePendingSync(uid: string | null) {
  useEffect(() => {
    if (!uid || !firebaseReady()) return
    const run = () => void flushPending(uid)
    run()
    window.addEventListener('online', run)
    return () => window.removeEventListener('online', run)
  }, [uid])
}

/* ---------------- Gravação ---------------- */

/** Registra uma frase avaliada pela IA. Trocar de nível no meio da conversa abre um novo registro. */
export async function recordPhrase(
  uid: string | null,
  sessionId: string,
  level: Level,
  said: string,
  feedback: Feedback | null,
  reply: string,
) {
  const rec: PhraseRecord = { id: newPhraseId(), sessionId, level, said, feedback, reply, at: new Date().toISOString() }

  if (!firebaseReady()) {
    writeJson(STORAGE, applyPhrase(loadStats(), rec))
    return notify()
  }
  // offline ou ainda sem login: guarda na fila e envia depois
  if (!uid || !navigator.onLine) return addPending({ ...rec, uid })
  try {
    await recordPhraseRemote(uid, rec)
  } catch (e) {
    console.warn('[stats] falha ao salvar no Firestore; guardando no localStorage para reenviar.', e)
    addPending({ ...rec, uid })
  }
}

/* ---------------- Leitura em tempo real ---------------- */

/** cloud = sincronizado · cache = Firestore offline/sincronizando · local = só este aparelho */
export type StatsSource = 'cloud' | 'cache' | 'local'

export interface StatsView {
  stats: Stats
  source: StatsSource
  /** frases ainda não enviadas à nuvem */
  pending: number
}

/**
 * Entrega as estatísticas agora e a cada mudança (Firestore em tempo real, fila offline e
 * localStorage). Retorna a função para cancelar.
 */
export function subscribeStats(uid: string | null, onView: (v: StatsView) => void): () => void {
  // sem Firebase, ou com Firebase mas sem login (login automático falhou): só o aparelho
  if (!uid || !firebaseReady()) {
    const emit = () => {
      const pending = firebaseReady() ? pendingFor(null) : []
      onView({ stats: pending.reduce(applyPhrase, loadStats()), source: 'local', pending: pending.length })
    }
    emit()
    window.addEventListener(CHANGED, emit)
    return () => window.removeEventListener(CHANGED, emit)
  }

  // último snapshot da nuvem guardado neste aparelho: aparece na hora e serve de reserva offline
  const cached = parseStats(readJson(CACHE(uid)))
  let remote: (Stats & { fromCache: boolean; feedbackIds: Set<string> }) | null = null
  let failed = false

  const emit = () => {
    const pending = pendingFor(uid)
    if (remote && !failed) {
      // frases da fila que o Firestore já tem (escrita local ou confirmada) não contam duas vezes
      const ids = remote.feedbackIds
      const unsynced = pending.filter((p) => !ids.has(feedbackDocId(uid, p.id)))
      // cache do Firestore vazio (ex.: abriu offline sem cache persistente): usa a cópia local
      const base = remote.fromCache && remote.sessions.length === 0 && cached ? cached : remote
      onView({
        stats: unsynced.reduce(applyPhrase, base),
        source: remote.fromCache ? 'cache' : 'cloud',
        pending: unsynced.length,
      })
    } else if (cached || failed || pending.length) {
      onView({ stats: pending.reduce(applyPhrase, cached ?? empty()), source: 'local', pending: pending.length })
    }
  }

  const stopRemote = subscribeStatsRemote(
    uid,
    (data) => {
      remote = data
      failed = false
      if (!data.fromCache) writeJson(CACHE(uid), { sessions: data.sessions, corrections: data.corrections.slice(0, MAX_CORRECTIONS) })
      emit()
    },
    (e) => {
      console.warn('[stats] Firestore indisponível; mostrando dados salvos neste aparelho.', e)
      failed = true
      emit()
    },
  )

  emit()
  window.addEventListener(CHANGED, emit)
  return () => {
    stopRemote()
    window.removeEventListener(CHANGED, emit)
  }
}

export const sessionAverage = (s: SessionStat) => (s.scored ? s.scoreSum / s.scored : null)

export async function resetStats(uid: string | null) {
  if (uid && firebaseReady()) {
    await clearStatsRemote(uid)
    removeKey(CACHE(uid))
  }
  savePending(loadPending().filter((p) => p.uid !== null && p.uid !== uid))
  clearStats()
}
