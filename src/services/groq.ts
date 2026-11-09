// Chamada direta à API do Groq (Chat Completions, formato OpenAI) a partir do navegador.
// A chave fica só no localStorage deste navegador.

const API_URL = 'https://api.groq.com/openai/v1/chat/completions'
// llama-3.3-70b-versatile foi desligado no tier gratuito em 16/08/2026;
// gpt-oss-120b é o modelo de produção atual recomendado pelo Groq como substituto.
export const MODEL = 'openai/gpt-oss-120b'
export const API_KEY_STORAGE = 'groq_api_key'
const LEGACY_KEYS = ['anthropic_api_key']

/* ---------------- Nível de fluência ---------------- */

export type Level = 'beginner' | 'intermediate' | 'advanced'

export const LEVELS: { id: Level; label: string }[] = [
  { id: 'beginner', label: 'Beginner' },
  { id: 'intermediate', label: 'Intermediate' },
  { id: 'advanced', label: 'Advanced' },
]

export const isLevel = (v: unknown): v is Level => LEVELS.some((l) => l.id === v)

const LEVEL_GUIDE: Record<Level, string> = {
  beginner: `- Use very short, simple sentences (about 10 words max each) and only common, everyday vocabulary. No idioms, no phrasal verbs, no slang.
- If a word in your reply might be hard, add a short Portuguese gloss in parentheses, e.g. "tired (cansado)".
- Write the feedback "correction" in Brazilian Portuguese so the learner fully understands it.
- Focus the correction on the single most important mistake. Score generously and stay very encouraging.`,
  intermediate: `- Use natural, everyday English at a normal conversational pace, with some common expressions.
- Write everything in English, including the correction.
- Correct the main mistakes (up to two) clearly and briefly; ignore tiny slips that don't affect meaning.`,
  advanced: `- Talk like a native speaker: use idiomatic expressions, phrasal verbs and rich, varied vocabulary.
- Write everything in English, including the correction.
- Be demanding: also point out subtle issues (unnatural collocations, register, articles, prepositions, weak word choices) and suggest more sophisticated vocabulary.
- Score strictly: only fully natural, native-like sentences get 9-10.`,
}

export function buildSystemPrompt(level: Level) {
  return `You are a friendly English tutor having a casual, real conversation with a learner whose native language is Brazilian Portuguese.

Learner level: ${level.toUpperCase()}
${LEVEL_GUIDE[level]}

Every time you answer you must (1) evaluate the learner's LAST message and (2) continue the conversation.
Respond ONLY with a JSON object in exactly this shape, no markdown:
{"feedback":{"score":<integer 1-10>,"correction":<string or null>,"native":<string>},"reply":<string>}

"feedback" — about the learner's last message only:
- "score": how natural and grammatically correct it is. 10 = sounds like a fluent native speaker; 7-9 = correct but slightly unnatural; 4-6 = understandable with clear mistakes; 1-3 = hard to understand.
- "correction": what went wrong (grammar point or word choice), quoting the wrong part and the fix, e.g. "\\"I go yesterday\\" → \\"I went yesterday\\": use the past simple for finished actions." Use null if there is nothing to correct.
- "native": how a native speaker would naturally say the same thing, keeping the learner's meaning. If it was already perfect, repeat it.
- If the learner wrote in Portuguese instead of English, use {"score":null,"correction":null,"native":"<natural English version>"}.

"reply" — your conversational message:
- Plain text, 2-3 short sentences, like a natural chat message. No markdown, lists, headings or corrections (corrections only go in "feedback").
- React to what the learner said and usually end with a simple follow-up question.
- Be warm and encouraging, never condescending.`
}

/* ---------------- Tipos ---------------- */

export type Role = 'user' | 'assistant'

export interface Feedback {
  /** 1-10, ou null quando o aluno escreveu em português */
  score: number | null
  correction: string | null
  native: string
}

export interface ChatMessage {
  role: Role
  content: string
  feedback?: Feedback | null
  /** modo escuta: texto oculto até o aluno responder ou revelar */
  hidden?: boolean
}

export interface TutorReply {
  reply: string
  feedback: Feedback | null
}

export class AIError extends Error {
  status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'AIError'
    this.status = status
  }
}

/* ---------------- API key ---------------- */

export function getApiKey(): string | null {
  try {
    // limpa chaves de versões anteriores do app
    LEGACY_KEYS.forEach((k) => localStorage.removeItem(k))
    return localStorage.getItem(API_KEY_STORAGE)
  } catch {
    return null
  }
}

export function setApiKey(key: string | null) {
  try {
    if (key) localStorage.setItem(API_KEY_STORAGE, key)
    else localStorage.removeItem(API_KEY_STORAGE)
  } catch {
    /* storage indisponível (modo privado) */
  }
}

/* ---------------- Parsing da resposta ---------------- */

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/** Lê o JSON do tutor; se vier fora do formato, usa o texto bruto como resposta. */
export function parseTutorReply(raw: string): TutorReply {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  try {
    const data = JSON.parse(start >= 0 && end > start ? raw.slice(start, end + 1) : raw)
    const reply = str(data?.reply)
    if (!reply) throw new Error('sem reply')
    const f = data?.feedback
    const native = str(f?.native)
    const n = Number(f?.score)
    const feedback: Feedback | null = native
      ? {
          score: f?.score == null || !Number.isFinite(n) ? null : Math.min(10, Math.max(1, Math.round(n))),
          correction: str(f?.correction),
          native,
        }
      : null
    return { reply, feedback }
  } catch {
    return { reply: raw.trim(), feedback: null }
  }
}

/** Mensagens do tutor voltam no mesmo formato JSON para o modelo manter o padrão. */
function toApiMessage({ role, content, feedback }: ChatMessage) {
  if (role === 'user') return { role, content }
  return { role, content: JSON.stringify({ feedback: feedback ?? null, reply: content }) }
}

/* ---------------- Chamada ---------------- */

export async function sendMessage(
  history: ChatMessage[],
  apiKey: string,
  level: Level,
  signal?: AbortSignal,
): Promise<TutorReply> {
  const res = await fetch(API_URL, {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'system', content: buildSystemPrompt(level) }, ...history.map(toApiMessage)],
      response_format: { type: 'json_object' },
      max_completion_tokens: 1024,
      // gpt-oss é um modelo de raciocínio: esforço baixo = respostas rápidas para chat
      reasoning_effort: 'low',
      include_reasoning: false,
    }),
  })

  if (!res.ok) {
    let msg = `Erro ${res.status}`
    try {
      const data = await res.json()
      // o modo JSON do Groq rejeita saídas inválidas, mas devolve o texto gerado: aproveitamos
      const failed = data?.error?.code === 'json_validate_failed' && str(data?.error?.failed_generation)
      if (failed) return parseTutorReply(failed)
      msg = data?.error?.message ?? msg
    } catch {
      /* corpo não-JSON */
    }
    if (res.status === 401) msg = 'API key inválida. Verifique e salve novamente.'
    if (res.status === 429) msg = 'Limite do plano gratuito atingido. Aguarde alguns segundos.'
    throw new AIError(msg, res.status)
  }

  const data = await res.json()
  const text: string = data?.choices?.[0]?.message?.content?.trim() ?? ''
  if (!text) throw new AIError('Resposta vazia do modelo. Tente de novo.')
  return parseTutorReply(text)
}
