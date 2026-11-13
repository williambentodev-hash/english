// Histórico de conversas no localStorage — usado só quando o Firebase não está configurado.
import { isLevel, type Level } from './tutor'
import { sessionStart, toFeedback, type ChatSummary, type ChatTurn, type PhraseRecord } from './db'

const STORAGE = 'tutor_chats_v1'
export const CHATS_CHANGED = 'tutor-chats-changed'
const MAX_CHATS = 100
const MAX_TURNS = 400

interface LocalChat extends ChatSummary {
  turns: ChatTurn[]
}

const isTurn = (t: any): t is ChatTurn =>
  t && ['id', 'at', 'said', 'reply'].every((k) => typeof t[k] === 'string')

function load(): LocalChat[] {
  try {
    const arr = JSON.parse(localStorage.getItem(STORAGE) ?? '[]')
    if (!Array.isArray(arr)) return []
    return arr
      .filter((c) => c && typeof c.id === 'string' && typeof c.updatedAt === 'string' && isLevel(c.level))
      .map((c) => {
        const turns: ChatTurn[] = (Array.isArray(c.turns) ? c.turns : []).filter(isTurn).map((t: any) => ({
          ...t,
          feedback: toFeedback(t.feedback),
          translation: typeof t.translation === 'string' ? t.translation : null,
        }))
        return {
          id: c.id,
          title: typeof c.title === 'string' ? c.title : null,
          createdAt: typeof c.createdAt === 'string' ? c.createdAt : c.updatedAt,
          updatedAt: c.updatedAt,
          level: c.level as Level,
          count: turns.length,
          turns,
        }
      })
  } catch {
    return []
  }
}

function save(chats: LocalChat[]) {
  try {
    const sorted = [...chats].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, MAX_CHATS)
    localStorage.setItem(STORAGE, JSON.stringify(sorted))
  } catch {
    /* modo privado / storage cheio */
  }
  window.dispatchEvent(new Event(CHATS_CHANGED))
}

export function appendLocalTurn(r: PhraseRecord) {
  const chats = load()
  let chat = chats.find((c) => c.id === r.sessionId)
  if (!chat) {
    chat = {
      id: r.sessionId,
      title: r.title ?? null,
      createdAt: sessionStart(r.sessionId, r.at),
      updatedAt: r.at,
      level: r.level,
      count: 0,
      turns: [],
    }
    chats.push(chat)
  }
  chat.turns = [
    ...chat.turns,
    { id: r.id, at: r.at, said: r.said, reply: r.reply, feedback: r.feedback, translation: r.translation ?? null },
  ].slice(-MAX_TURNS)
  chat.count = chat.turns.length
  chat.updatedAt = r.at
  chat.level = r.level
  if (!chat.title && r.title) chat.title = r.title
  save(chats)
}

export const loadLocalChats = (): ChatSummary[] =>
  load()
    .map(({ turns: _t, ...summary }) => summary)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))

export const loadLocalChat = (id: string): ChatTurn[] => load().find((c) => c.id === id)?.turns ?? []

export function deleteLocalChat(id: string) {
  save(load().filter((c) => c.id !== id))
}
