// Persistência no Firestore. Coleções (todas com o campo `uid` do dono, exigido pelas regras):
//   users/{uid}                          nível de fluência e configurações
//   sessions/{uid}_{sessionId}_{level}   histórico da conversa, total de frases e soma dos scores
//   feedbacks/{uid}_{phraseId}           frase do aluno, score, correção em português e versão nativa
import {
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
  type FirestoreError,
  type Query,
  type QueryDocumentSnapshot,
  type QuerySnapshot,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import { isLevel, type Feedback, type Level } from './groq'
import type { CorrectionEntry, SessionStat, Stats } from './stats'

const MAX_SESSIONS = 200
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

/** Uma frase do aluno com a avaliação da IA. `id` é único e gerado no aparelho. */
export interface PhraseRecord {
  id: string
  sessionId: string
  level: Level
  said: string
  feedback: Feedback | null
  reply: string
  /** ISO de quando a frase foi enviada */
  at: string
}

const sessionDocId = (uid: string, sessionId: string, level: Level) => `${uid}_${sessionId}_${level}`
export const feedbackDocId = (uid: string, phraseId: string) => `${uid}_${phraseId}`

/** Início da conversa, extraído do id da sessão (timestamp em base 36); determinístico entre reenvios. */
function sessionStart(sessionId: string, fallback: string) {
  const ms = parseInt(sessionId.split('-')[0], 36)
  return Number.isFinite(ms) && ms > 1.5e12 && ms < 4e12 ? new Date(ms).toISOString() : fallback
}

/**
 * Grava a frase em uma escrita atômica: o feedback (id determinístico, então reenviar não duplica)
 * e os contadores da sessão (incrementos, sem depender de estado em memória — funciona ao
 * reenviar a fila offline depois de recarregar a página).
 */
export async function recordPhraseRemote(uid: string, r: PhraseRecord) {
  const fs = firestore()
  const score = r.feedback?.score ?? null
  const batch = writeBatch(fs)
  batch.set(
    doc(fs, 'sessions', sessionDocId(uid, r.sessionId, r.level)),
    {
      uid,
      sessionId: r.sessionId,
      level: r.level,
      date: sessionStart(r.sessionId, r.at),
      updatedAt: r.at,
      phrases: increment(1),
      scoreSum: increment(score ?? 0),
      scored: increment(score != null ? 1 : 0),
      messages: arrayUnion(
        { role: 'user', content: r.said, at: r.at },
        { role: 'assistant', content: r.reply, at: r.at },
      ),
    },
    { merge: true },
  )
  batch.set(doc(fs, 'feedbacks', feedbackDocId(uid, r.id)), {
    uid,
    sessionId: r.sessionId,
    level: r.level,
    date: r.at,
    said: r.said,
    score,
    correction: r.feedback?.correction ?? null,
    native: r.feedback?.native ?? '',
    createdAt: serverTimestamp(),
  })
  await batch.commit()
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
  return {
    date: x.date,
    level: x.level,
    said: x.said,
    correction: x.correction,
    native: String(x.native ?? ''),
    score: typeof x.score === 'number' ? x.score : null,
  }
}

export interface RemoteStats extends Stats {
  /** dados vindos do cache local do Firestore (offline ou ainda sincronizando) */
  fromCache: boolean
  /** ids dos documentos de feedback recebidos (para não contar duas vezes a fila offline) */
  feedbackIds: Set<string>
}

/**
 * Acompanha em tempo real as sessões e os feedbacks do usuário. `onData` é chamado a cada
 * mudança (inclusive escritas locais ainda não confirmadas pelo servidor).
 */
export function subscribeStatsRemote(
  uid: string,
  onData: (s: RemoteStats) => void,
  onError: (e: FirestoreError) => void,
) {
  const fs = firestore()
  const col = collection(fs, 'feedbacks')
  let sessions: QuerySnapshot | null = null
  let feedbacks: QuerySnapshot | null = null
  let stopFeedbacks = () => {}

  const emit = () => {
    if (!sessions || !feedbacks) return
    onData({
      sessions: sessions.docs
        .map(toSession)
        .filter((s): s is SessionStat => s !== null)
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(-MAX_SESSIONS),
      corrections: feedbacks.docs
        .map(toCorrection)
        .filter((c): c is CorrectionEntry => c !== null)
        .sort((a, b) => b.date.localeCompare(a.date)),
      fromCache: sessions.metadata.fromCache || feedbacks.metadata.fromCache,
      feedbackIds: new Set(feedbacks.docs.map((d) => d.id)),
    })
  }

  const listenFeedbacks = (q: Query, ordered: boolean) => {
    stopFeedbacks = onSnapshot(
      q,
      { includeMetadataChanges: true },
      (snap) => {
        feedbacks = snap
        emit()
      },
      (e) => {
        // sem o índice composto (uid ASC, date DESC) de firestore.indexes.json: ordena no cliente
        if (ordered && e.code === 'failed-precondition') {
          console.warn('[firestore] índice de feedbacks ausente; ordenando no cliente.')
          listenFeedbacks(query(col, where('uid', '==', uid)), false)
        } else onError(e)
      },
    )
  }

  const stopSessions = onSnapshot(
    query(collection(fs, 'sessions'), where('uid', '==', uid)),
    { includeMetadataChanges: true },
    (snap) => {
      sessions = snap
      emit()
    },
    onError,
  )
  listenFeedbacks(query(col, where('uid', '==', uid), orderBy('date', 'desc'), limit(FEEDBACK_FETCH)), true)

  return () => {
    stopSessions()
    stopFeedbacks()
  }
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
}
