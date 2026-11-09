// Persistência no Firestore. Coleções (todas com o campo `uid` do dono, exigido pelas regras):
//   users/{uid}                          nível de fluência e configurações
//   sessions/{uid}_{sessionId}_{level}   histórico da conversa, total de frases e média de scores
//   feedbacks/{auto}                     correção em português, versão nativa e nota de cada frase
import {
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
  addDoc,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import { isLevel, type Feedback, type Level } from './groq'
import type { CorrectionEntry, SessionStat, Stats } from './stats'

const MAX_SESSIONS = 200
const MAX_CORRECTIONS = 50
const FEEDBACK_FETCH = 200

function firestore() {
  if (!db) throw new Error('Firestore não configurado.')
  return db
}

/* ---------------- users ---------------- */

export interface UserProfile {
  level: Level
  blindListening: boolean
  speechRate: number
}

export async function loadUserProfile(uid: string): Promise<Partial<UserProfile> | null> {
  const snap = await getDoc(doc(firestore(), 'users', uid))
  if (!snap.exists()) return null
  const d = snap.data()
  const out: Partial<UserProfile> = {}
  if (isLevel(d.level)) out.level = d.level
  if (typeof d.blindListening === 'boolean') out.blindListening = d.blindListening
  if (typeof d.speechRate === 'number') out.speechRate = d.speechRate
  return out
}

export async function saveUserProfile(
  uid: string,
  profile: UserProfile & { email?: string | null; anonymous?: boolean },
) {
  await setDoc(
    doc(firestore(), 'users', uid),
    { uid, ...profile, updatedAt: serverTimestamp() },
    { merge: true },
  )
}

/* ---------------- sessions + feedbacks ---------------- */

// Contadores da sessão em andamento. Uma sessão pertence a uma única aba, então manter os
// totais em memória permite gravar valores absolutos (inclusive a média) sem transação,
// o que também funciona offline.
const sessionCache = new Map<string, { date: string; phrases: number; scoreSum: number; scored: number }>()

const sessionDocId = (uid: string, sessionId: string, level: Level) => `${uid}_${sessionId}_${level}`

export async function recordPhraseRemote(
  uid: string,
  sessionId: string,
  level: Level,
  said: string,
  feedback: Feedback | null,
  reply: string,
) {
  const fs = firestore()
  const now = new Date().toISOString()
  const id = sessionDocId(uid, sessionId, level)

  const s = sessionCache.get(id) ?? { date: now, phrases: 0, scoreSum: 0, scored: 0 }
  s.phrases += 1
  if (feedback?.score != null) {
    s.scoreSum += feedback.score
    s.scored += 1
  }
  sessionCache.set(id, s)

  await Promise.all([
    setDoc(
      doc(fs, 'sessions', id),
      {
        uid,
        sessionId,
        level,
        date: s.date,
        updatedAt: now,
        phrases: s.phrases,
        scoreSum: s.scoreSum,
        scored: s.scored,
        averageScore: s.scored ? s.scoreSum / s.scored : null,
        messages: arrayUnion(
          { role: 'user', content: said, at: now },
          { role: 'assistant', content: reply, at: now },
        ),
      },
      { merge: true },
    ),
    addDoc(collection(fs, 'feedbacks'), {
      uid,
      sessionId,
      level,
      date: now,
      said,
      score: feedback?.score ?? null,
      correction: feedback?.correction ?? null,
      native: feedback?.native ?? '',
    }),
  ])
}

const toSession = (d: QueryDocumentSnapshot): SessionStat | null => {
  const x = d.data()
  if (typeof x.sessionId !== 'string' || typeof x.date !== 'string' || !isLevel(x.level)) return null
  const nums = [x.phrases, x.scoreSum, x.scored]
  if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n))) return null
  return { id: x.sessionId, date: x.date, level: x.level, phrases: x.phrases, scoreSum: x.scoreSum, scored: x.scored }
}

const toCorrection = (d: QueryDocumentSnapshot): CorrectionEntry | null => {
  const x = d.data()
  if (typeof x.correction !== 'string' || !x.correction || !isLevel(x.level)) return null
  if (typeof x.date !== 'string' || typeof x.said !== 'string') return null
  return { date: x.date, level: x.level, said: x.said, correction: x.correction, native: String(x.native ?? '') }
}

async function fetchFeedbackDocs(uid: string) {
  const col = collection(firestore(), 'feedbacks')
  try {
    // exige o índice composto (uid ASC, date DESC) de firestore.indexes.json
    return (await getDocs(query(col, where('uid', '==', uid), orderBy('date', 'desc'), limit(FEEDBACK_FETCH)))).docs
  } catch (e) {
    if ((e as { code?: string }).code !== 'failed-precondition') throw e
    console.warn('[firestore] índice de feedbacks ausente; ordenando no cliente.')
    return (await getDocs(query(col, where('uid', '==', uid)))).docs
  }
}

export async function loadStatsRemote(uid: string): Promise<Stats> {
  const fs = firestore()
  const [sessionDocs, feedbackDocs] = await Promise.all([
    getDocs(query(collection(fs, 'sessions'), where('uid', '==', uid))).then((r) => r.docs),
    fetchFeedbackDocs(uid),
  ])

  const sessions = sessionDocs
    .map(toSession)
    .filter((s): s is SessionStat => s !== null)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-MAX_SESSIONS)

  const corrections = feedbackDocs
    .map(toCorrection)
    .filter((c): c is CorrectionEntry => c !== null)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, MAX_CORRECTIONS)

  return { sessions, corrections }
}

/** Apaga todas as sessões e feedbacks do usuário (mantém o perfil). */
export async function clearStatsRemote(uid: string) {
  const fs = firestore()
  const [a, b] = await Promise.all([
    getDocs(query(collection(fs, 'sessions'), where('uid', '==', uid))),
    getDocs(query(collection(fs, 'feedbacks'), where('uid', '==', uid))),
  ])
  const refs = [...a.docs, ...b.docs].map((d) => d.ref)
  for (let i = 0; i < refs.length; i += 450) {
    const batch = writeBatch(fs)
    refs.slice(i, i + 450).forEach((r) => batch.delete(r))
    await batch.commit()
  }
  for (const key of sessionCache.keys()) if (key.startsWith(`${uid}_`)) sessionCache.delete(key)
}
