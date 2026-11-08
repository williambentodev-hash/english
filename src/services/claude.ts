// Chamada direta à API da Anthropic a partir do navegador.
// ATENÇÃO: a chave fica no localStorage do usuário e trafega do browser.
// Adequado para uso pessoal (cada usuário usa a própria key), não para uma key compartilhada.

const API_URL = 'https://api.anthropic.com/v1/messages'
const API_VERSION = '2026-10-21'
// claude-3-5-haiku foi aposentado; Haiku 5.5 é o Haiku atual.
export const MODEL = 'claude-haiku-5-5'
export const API_KEY_STORAGE = 'anthropic_api_key'

export const SYSTEM_PROMPT = `You are a friendly English tutor having a casual, real conversation with a language learner.

How to reply:
- Keep every reply short: 2-3 sentences, like a natural chat message.
- Keep the conversation going: react to what the learner said and usually end with a simple follow-up question.
- If the learner's last message has grammar, vocabulary or spelling mistakes, start your reply with the corrections inside square brackets, e.g. [Correction: "I go yesterday" → "I went yesterday"]. Only correct real mistakes; if there are none, add no brackets.
- Use clear, everyday English matched to the learner's level. Be warm and encouraging, never condescending.`

export type Role = 'user' | 'assistant'
export interface ChatMessage {
  role: Role
  content: string
}

export class ClaudeError extends Error {
  status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'ClaudeError'
    this.status = status
  }
}

export function getApiKey(): string | null {
  try {
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

export async function sendMessage(
  history: ChatMessage[],
  apiKey: string,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch(API_URL, {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': API_VERSION,
      // Equivalente ao `dangerouslyAllowBrowser: true` do SDK: habilita CORS para chamadas do browser.
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      // Chat curto e rápido: esforço baixo.
      output_config: { effort: 'low' },
      messages: history.map(({ role, content }) => ({ role, content })),
    }),
  })

  if (!res.ok) {
    let msg = `Erro ${res.status}`
    try {
      const data = await res.json()
      msg = data?.error?.message ?? msg
    } catch {
      /* corpo não-JSON */
    }
    if (res.status === 401) msg = 'API key inválida. Verifique e salve novamente.'
    if (res.status === 429) msg = 'Muitas requisições. Aguarde alguns segundos.'
    throw new ClaudeError(msg, res.status)
  }

  const data = await res.json()
  if (data.stop_reason === 'refusal') {
    throw new ClaudeError('O modelo recusou essa mensagem. Tente reformular.')
  }
  // A resposta pode conter blocos de "thinking"; pegamos só os de texto.
  const text = (data.content ?? [])
    .filter((b: { type: string }) => b.type === 'text')
    .map((b: { text: string }) => b.text)
    .join('')
    .trim()
  if (!text) throw new ClaudeError('Resposta vazia do modelo.')
  return text
}
