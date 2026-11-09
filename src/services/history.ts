// Histórico de conversas (chats anteriores).
// - Firebase + usuário: coleções `chats` e `chat_messages` (gravadas junto com as estatísticas em
//   recordPhraseRemote), mescladas com a fila offline ainda não enviada.
// - Sem Firebase: localStorage (services/chatStore.ts).
import { useEffect, useState } from 'react'
import { firebaseReady } from '../lib/firebase'
import {
  deleteChatRemote,
  endChatRemote,
  loadChatRemote,
  sessionStart,
  subscribeChatsRemote,
  type ChatSummary,
  type ChatTurn,
  type PhraseRecord,
} from './db'
import { CHATS_CHANGED, deleteLocalChat, loadLocalChat, loadLocalChats } from './chatStore'
import { detachPendingChat, onStatsChanged, pendingChatPhrases } from './stats'

export type { ChatSummary, ChatTurn }

const TITLE_MAX = 60

/** Título da conversa a partir da primeira frase do aluno. */
export function chatTitle(text: string) {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > TITLE_MAX ? `${t.slice(0, TITLE_MAX - 1).trimEnd()}…` : t
}

const cloud = (uid: string | null): uid is string => !!uid && firebaseReady()

const toTurn = (p: PhraseRecord): ChatTurn => ({
  id: p.id,
  at: p.at,
  said: p.said,
  reply: p.reply,
  feedback: p.feedback,
  translation: p.translation ?? null,
})

/** Conversas que só existem na fila offline (ou com frases ainda não enviadas). */
function pendingSummaries(uid: string | null): Map<string, ChatSummary & { latest: PhraseRecord[] }> {
  const out = new Map<string, ChatSummary & { latest: PhraseRecord[] }>()
  for (const p of pendingChatPhrases(uid)) {
    let c = out.get(p.sessionId)
    if (!c) {
      c = {
        id: p.sessionId,
        title: null,
        createdAt: sessionStart(p.sessionId, p.at),
        updatedAt: p.at,
        level: p.level,
        count: 0,
        latest: [],
      }
      out.set(p.sessionId, c)
    }
    c.title ??= p.title ?? null
    c.count += 1
    c.latest.push(p)
    if (p.at > c.updatedAt) {
      c.updatedAt = p.at
      c.level = p.level
    }
  }
  return out
}

function merge(remote: ChatSummary[], uid: string | null): ChatSummary[] {
  const pending = pendingSummaries(uid)
  const byId = new Map(remote.map((c) => [c.id, { ...c }]))
  for (const [id, p] of pending) {
    const r = byId.get(id)
    if (!r) {
      const { latest: _l, ...summary } = p
      byId.set(id, summary)
      continue
    }
    // frases da fila mais novas que a última atividade na nuvem ainda não foram contadas
    const unsynced = p.latest.filter((x) => x.at > r.updatedAt)
    if (!unsynced.length) continue
    r.count += unsynced.length
    r.updatedAt = unsynced[unsynced.length - 1].at
    r.title ??= p.title
  }
  return [...byId.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

/** Lista de conversas em tempo real (`chats` é null enquanto carrega). */
export function useChatHistory(uid: string | null) {
  const [chats, setChats] = useState<ChatSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setChats(null)
    setError(null)

    if (!firebaseReady()) {
      const sync = () => setChats(loadLocalChats())
      sync()
      const onStorage = (e: StorageEvent) => e.key === 'tutor_chats_v1' && sync()
      window.addEventListener(CHATS_CHANGED, sync)
      window.addEventListener('storage', onStorage)
      return () => {
        window.removeEventListener(CHATS_CHANGED, sync)
        window.removeEventListener('storage', onStorage)
      }
    }

    let remote: ChatSummary[] = []
    const emit = () => setChats(merge(remote, uid))
    const stopPending = onStatsChanged(emit)
    if (!cloud(uid)) {
      emit()
      return stopPending
    }
    const stopRemote = subscribeChatsRemote(
      uid,
      (data) => {
        remote = data
        setError(null)
        emit()
      },
      (e) => {
        console.warn('[history] falha ao carregar o histórico', e)
        setError('Não foi possível carregar o histórico.')
        emit()
      },
    )
    return () => {
      stopRemote()
      stopPending()
    }
  }, [uid])

  return { chats, error }
}

/** Todas as trocas de uma conversa (nuvem + fila offline), em ordem. */
export async function loadChat(uid: string | null, sessionId: string): Promise<ChatTurn[]> {
  if (!firebaseReady()) return loadLocalChat(sessionId)
  const byId = new Map<string, ChatTurn>()
  if (cloud(uid)) for (const t of await loadChatRemote(uid, sessionId)) byId.set(t.id, t)
  for (const p of pendingChatPhrases(uid)) if (p.sessionId === sessionId && !byId.has(p.id)) byId.set(p.id, toTurn(p))
  return [...byId.values()].sort((a, b) => a.at.localeCompare(b.at))
}

/** Encerra a sessão (ao começar outra conversa). Não bloqueia: a escrita fica no cache se offline. */
export function endChat(uid: string | null, sessionId: string) {
  if (!cloud(uid)) return
  endChatRemote(uid, sessionId).catch((e) => console.warn('[history] falha ao encerrar a sessão', e))
}

/** Remove a conversa do histórico (estatísticas e correções são mantidas). */
export async function deleteChat(uid: string | null, sessionId: string) {
  if (!firebaseReady()) return deleteLocalChat(sessionId)
  detachPendingChat(sessionId)
  if (cloud(uid)) await deleteChatRemote(uid, sessionId)
}
