// Conversa com o tutor pelo nosso back-end (pasta backend/), que guarda a chave do LLM,
// monta o prompt, valida o login do Firebase e devolve a resposta já no formato do app.
import { authErrorMessage, waitForUser } from './auth'

/** URL do back-end (VITE_API_URL), sem barra no final. */
const BACKEND_URL = (import.meta.env.VITE_API_URL ?? '').trim().replace(/\/+$/, '') || null

// versões anteriores do app guardavam a chave do LLM do usuário no navegador: não fica mais lá
try {
  for (const k of ['groq_api_key', 'anthropic_api_key']) localStorage.removeItem(k)
} catch {
  /* storage indisponível (modo privado) */
}

/* ---------------- Nível de fluência ---------------- */

export type Level = 'beginner' | 'intermediate' | 'advanced'

export const LEVELS: { id: Level; label: string }[] = [
  { id: 'beginner', label: 'Beginner' },
  { id: 'intermediate', label: 'Intermediate' },
  { id: 'advanced', label: 'Advanced' },
]

export const isLevel = (v: unknown): v is Level => LEVELS.some((l) => l.id === v)

/* ---------------- Categorias de erro ---------------- */

// Lista fixa: o tutor classifica cada correção com estes ids, o que permite contar os erros recorrentes.
// Os mesmos ids existem no back-end (backend/app/tags.py).
export const ERROR_TAGS = [
  { id: 'verb_tense', label: 'Tempo verbal' },
  { id: 'verb_form', label: 'Conjugação verbal' },
  { id: 'article', label: 'Artigos (a, an, the)' },
  { id: 'preposition', label: 'Preposições (in, on, at, of…)' },
  { id: 'plural', label: 'Plural e quantidade' },
  { id: 'pronoun', label: 'Pronomes' },
  { id: 'word_order', label: 'Ordem das palavras' },
  { id: 'word_choice', label: 'Escolha de palavras' },
  { id: 'spelling', label: 'Ortografia' },
  { id: 'other', label: 'Outros' },
] as const

export type ErrorTag = (typeof ERROR_TAGS)[number]['id']

const TAG_IDS: readonly string[] = ERROR_TAGS.map((t) => t.id)
const MAX_TAGS = 3

export const errorTagLabel = (tag: ErrorTag) => ERROR_TAGS.find((t) => t.id === tag)?.label ?? tag

/** Só categorias conhecidas, sem repetição (dados antigos podem trazer qualquer coisa). */
export function parseTags(v: unknown): ErrorTag[] {
  if (!Array.isArray(v)) return []
  const valid = v.filter((t): t is ErrorTag => typeof t === 'string' && TAG_IDS.includes(t))
  return [...new Set(valid)].slice(0, MAX_TAGS)
}

/** Categoria de erro e quantas vezes apareceu nas correções recentes. */
export interface WeakSpot {
  tag: ErrorTag
  count: number
}

/* ---------------- Tipos ---------------- */

export type Role = 'user' | 'assistant'

export interface Feedback {
  /** 1-10, ou null quando o aluno escreveu em português */
  score: number | null
  correction: string | null
  /** categorias dos erros corrigidos (ausente em feedbacks antigos) */
  tags?: ErrorTag[]
  native: string
}

export interface ChatMessage {
  role: Role
  content: string
  feedback?: Feedback | null
  /** tradução para o português (só mensagens do tutor) */
  translation?: string | null
  /** modo escuta: texto oculto até o aluno responder ou revelar */
  hidden?: boolean
}

export interface TutorReply {
  reply: string
  feedback: Feedback | null
  translation: string | null
}

export class AIError extends Error {
  status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'AIError'
    this.status = status
  }
}

/* ---------------- Back-end ---------------- */

/** Chamada autenticada ao back-end com o ID token do Firebase do usuário atual (POST, ou DELETE sem corpo). */
async function callBackend<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  if (!BACKEND_URL) throw new AIError('Servidor não configurado: defina VITE_API_URL.')
  // espera o login automático (convidado) terminar; se falhou, mostra o motivo
  const user = await waitForUser().catch((e) => {
    throw new AIError(e instanceof Error ? e.message : authErrorMessage(e))
  })
  // o SDK renova o token sozinho quando está perto de expirar
  const token = await user.getIdToken()
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method: body === undefined ? 'DELETE' : 'POST',
    signal,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) {
    let msg = `Erro ${res.status}`
    try {
      // as mensagens de erro do back-end já vêm prontas para o usuário
      const data = await res.json()
      if (typeof data?.detail === 'string') msg = data.detail
    } catch {
      /* corpo não-JSON */
    }
    throw new AIError(msg, res.status)
  }
  return res.json()
}

/* ---------------- Conversa ---------------- */

export function sendMessage(
  history: ChatMessage[],
  level: Level,
  /** erros recorrentes do aluno: o tutor puxa a prática para eles e avisa quando se repetem */
  weakSpots: WeakSpot[] = [],
  signal?: AbortSignal,
): Promise<TutorReply> {
  return callBackend<TutorReply>(
    '/api/chat',
    {
      level,
      weak_spots: weakSpots,
      messages: history.map(({ role, content, feedback, translation }) => ({
        role,
        content,
        feedback: feedback ?? null,
        translation: translation ?? null,
      })),
    },
    signal,
  )
}

/**
 * Apaga a memória de erros que o servidor guarda sobre o usuário (os erros antigos que o tutor
 * usa para avisar quando um se repete). Chamada quando o usuário zera o progresso.
 */
export function forgetMistakes(): Promise<{ deleted: number }> {
  return callBackend<{ deleted: number }>('/api/memory')
}

/* ---------------- Tradução rápida de termo (Vocabulário) ---------------- */

export interface TermTranslation {
  /** tradução para o português no sentido usado na frase */
  translation: string
  /** forma de dicionário em inglês (ex.: "went" → "go"), quando diferente do termo */
  base: string | null
}

const termCache = new Map<string, Promise<TermTranslation>>()

/** Traduz um termo em inglês para o português considerando a frase onde apareceu. */
export function translateTerm(term: string, context: string): Promise<TermTranslation> {
  const key = `${term.toLowerCase()}|${context}`
  const cached = termCache.get(key)
  if (cached) return cached

  const p = callBackend<TermTranslation>('/api/translate', { term, context })
  termCache.set(key, p)
  // erros não ficam em cache: permite tentar de novo
  p.catch(() => termCache.delete(key))
  return p
}
