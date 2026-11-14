// Persistência no Firestore. Coleções (todas com o campo `uid` do dono, exigido pelas regras):
//   users/{uid}                          nível de fluência e configurações
//   sessions/{uid}_{sessionId}_{level}   histórico da conversa, total de frases e soma dos scores
//   feedbacks/{uid}_{phraseId}           frase do aluno, score, correção em português e versão nativa
//   vocabulary/{uid}_{termId}            termo salvo, tradução, frase de contexto, data e se já foi aprendido
//   chats/{uid}_{sessionId}              histórico: título, início, última atividade, nível e nº de frases
//   chat_messages/{uid}_{phraseId}       histórico: frase do aluno + resposta do tutor (com feedback e tradução)
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
  updateDoc,
  deleteDoc,
  where,
  writeBatch,
  type FirestoreError,
  type Query,
  type QueryDocumentSnapshot,
  type QuerySnapshot,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import { isLevel, parseTags, type Feedback, type Level } from './tutor'
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
  /** tradução da resposta do tutor (histórico) */
  translation?: string | null
  /** só na primeira frase da conversa: vira o título no histórico */
  title?: string
  /** conversa apagada do histórico antes do envio: grava só as estatísticas */
  skipChat?: boolean
}

const sessionDocId = (uid: string, sessionId: string, level: Level) => `${uid}_${sessionId}_${level}`
export const feedbackDocId = (uid: string, phraseId: string) => `${uid}_${phraseId}`
const chatDocId = (uid: string, sessionId: string) => `${uid}_${sessionId}`

/** Início da conversa, extraído do id da sessão (timestamp em base 36); determinístico entre reenvios. */
export function sessionStart(sessionId: string, fallback: string) {
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
    tags: parseTags(r.feedback?.tags),
    native: r.feedback?.native ?? '',
    createdAt: serverTimestamp(),
  })
  if (!r.skipChat) {
    batch.set(
      doc(fs, 'chats', chatDocId(uid, r.sessionId)),
      {
        uid,
        sessionId: r.sessionId,
        level: r.level,
        createdAt: sessionStart(r.sessionId, r.at),
        updatedAt: r.at,
        count: increment(1),
        // merge: o título só é enviado na primeira frase, então não é sobrescrito depois
        ...(r.title ? { title: r.title } : {}),
      },
      { merge: true },
    )
    batch.set(doc(fs, 'chat_messages', feedbackDocId(uid, r.id)), {
      uid,
      sessionId: r.sessionId,
      level: r.level,
      at: r.at,
      said: r.said,
      reply: r.reply,
      feedback: r.feedback ?? null,
      translation: r.translation ?? null,
    })
  }
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
    tags: parseTags(x.tags),
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

/* ---------------- vocabulary ---------------- */

export interface VocabEntry {
  /** id do termo (normalizado), único por usuário */
  id: string
  term: string
  translation: string
  /** forma de dicionário, quando diferente do termo */
  base: string | null
  /** frase do tutor onde o termo apareceu */
  context: string
  /** ISO de quando foi salvo */
  date: string
  learned: boolean
}

const vocabDocId = (uid: string, id: string) => `${uid}_${id}`

export function toVocabEntry(x: any, id: string): VocabEntry | null {
  if (!x || typeof x.term !== 'string' || typeof x.translation !== 'string' || typeof x.date !== 'string') return null
  return {
    id,
    term: x.term,
    translation: x.translation,
    base: typeof x.base === 'string' && x.base ? x.base : null,
    context: typeof x.context === 'string' ? x.context : '',
    date: x.date,
    learned: x.learned === true,
  }
}

/** A escrita entra no cache local na hora (o snapshot já reflete); a promise só resolve ao chegar no servidor. */
export function saveVocabRemote(uid: string, e: VocabEntry) {
  const { id, ...data } = e
  return setDoc(doc(firestore(), 'vocabulary', vocabDocId(uid, id)), { uid, ...data, createdAt: serverTimestamp() })
}

export function setVocabLearnedRemote(uid: string, id: string, learned: boolean) {
  return updateDoc(doc(firestore(), 'vocabulary', vocabDocId(uid, id)), { learned })
}

export function deleteVocabRemote(uid: string, id: string) {
  return deleteDoc(doc(firestore(), 'vocabulary', vocabDocId(uid, id)))
}

export function subscribeVocabRemote(
  uid: string,
  onData: (entries: VocabEntry[]) => void,
  onError: (e: FirestoreError) => void,
) {
  const prefix = `${uid}_`
  return onSnapshot(
    query(collection(firestore(), 'vocabulary'), where('uid', '==', uid)),
    (snap) =>
      onData(
        snap.docs
          .map((d) => toVocabEntry(d.data(), d.id.startsWith(prefix) ? d.id.slice(prefix.length) : d.id))
          .filter((v): v is VocabEntry => v !== null)
          .sort((a, b) => b.date.localeCompare(a.date)),
      ),
    onError,
  )
}

/* ---------------- histórico de conversas ---------------- */

/** Conversa na lista do histórico. `id` = sessionId. */
export interface ChatSummary {
  id: string
  /** null = sem título salvo (a interface mostra a data) */
  title: string | null
  /** ISO do início */
  createdAt: string
  /** ISO da última frase */
  updatedAt: string
  level: Level
  /** frases do aluno */
  count: number
}

/** Uma troca da conversa: frase do aluno e resposta do tutor. */
export interface ChatTurn {
  id: string
  at: string
  said: string
  reply: string
  feedback: Feedback | null
  translation: string | null
}

const toChatSummary = (x: any): ChatSummary | null => {
  if (!x || typeof x.sessionId !== 'string' || typeof x.updatedAt !== 'string' || !isLevel(x.level)) return null
  return {
    id: x.sessionId,
    title: typeof x.title === 'string' && x.title.trim() ? x.title : null,
    createdAt: typeof x.createdAt === 'string' ? x.createdAt : x.updatedAt,
    updatedAt: x.updatedAt,
    level: x.level,
    count: typeof x.count === 'number' && Number.isFinite(x.count) ? x.count : 0,
  }
}

export function toFeedback(f: any): Feedback | null {
  if (!f || typeof f.native !== 'string') return null
  return {
    score: typeof f.score === 'number' ? f.score : null,
    correction: typeof f.correction === 'string' ? f.correction : null,
    tags: parseTags(f.tags),
    native: f.native,
  }
}

const toChatTurn = (x: any, id: string): ChatTurn | null => {
  if (!x || typeof x.at !== 'string' || typeof x.said !== 'string' || typeof x.reply !== 'string') return null
  return {
    id,
    at: x.at,
    said: x.said,
    reply: x.reply,
    feedback: toFeedback(x.feedback),
    translation: typeof x.translation === 'string' ? x.translation : null,
  }
}

/** Lista de conversas em tempo real (ordenada no cliente: dispensa índice composto). */
export function subscribeChatsRemote(
  uid: string,
  onData: (chats: ChatSummary[]) => void,
  onError: (e: FirestoreError) => void,
) {
  return onSnapshot(
    query(collection(firestore(), 'chats'), where('uid', '==', uid)),
    (snap) =>
      onData(
        snap.docs
          .map((d) => toChatSummary(d.data()))
          .filter((c): c is ChatSummary => c !== null)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      ),
    onError,
  )
}

/** Todas as trocas de uma conversa, em ordem cronológica. */
export async function loadChatRemote(uid: string, sessionId: string): Promise<ChatTurn[]> {
  const prefix = `${uid}_`
  const snap = await getDocs(
    query(collection(firestore(), 'chat_messages'), where('uid', '==', uid), where('sessionId', '==', sessionId)),
  )
  return snap.docs
    .map((d) => toChatTurn(d.data(), d.id.startsWith(prefix) ? d.id.slice(prefix.length) : d.id))
    .filter((t): t is ChatTurn => t !== null)
    .sort((a, b) => a.at.localeCompare(b.at))
}

/** Marca a conversa como encerrada (ao abrir uma nova ou trocar de conversa). */
export function endChatRemote(uid: string, sessionId: string) {
  return setDoc(
    doc(firestore(), 'chats', chatDocId(uid, sessionId)),
    { uid, sessionId, endedAt: new Date().toISOString() },
    { merge: true },
  )
}

/** Apaga a conversa do histórico (as estatísticas e correções continuam). */
export async function deleteChatRemote(uid: string, sessionId: string) {
  const fs = firestore()
  const snap = await getDocs(
    query(collection(fs, 'chat_messages'), where('uid', '==', uid), where('sessionId', '==', sessionId)),
  )
  const refs = [doc(fs, 'chats', chatDocId(uid, sessionId)), ...snap.docs.map((d) => d.ref)]
  for (let i = 0; i < refs.length; i += 450) {
    const batch = writeBatch(fs)
    refs.slice(i, i + 450).forEach((r) => batch.delete(r))
    await batch.commit()
  }
}
