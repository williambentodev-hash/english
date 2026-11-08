// Chamada direta à API do Groq (Chat Completions, formato OpenAI) a partir do navegador.
// A chave fica só no localStorage deste navegador.

const API_URL = 'https://api.groq.com/openai/v1/chat/completions'
// llama-3.3-70b-versatile foi desligado no tier gratuito em 16/08/2026;
// gpt-oss-120b é o modelo de produção atual recomendado pelo Groq como substituto.
export const MODEL = 'openai/gpt-oss-120b'
export const API_KEY_STORAGE = 'groq_api_key'
const LEGACY_KEYS = ['anthropic_api_key']

export const SYSTEM_PROMPT = `You are a friendly English tutor having a casual, real conversation with a language learner.

How to reply:
- Keep every reply short: 2-3 sentences, like a natural chat message.
- Keep the conversation flowing: react to what the learner said and usually end with a simple follow-up question.
- If the learner's last message has grammar, vocabulary or spelling mistakes, gently note them at the start of your reply inside square brackets, e.g. [Tip: "I go yesterday" → "I went yesterday"]. Keep it brief and kind; only correct real mistakes, and if there are none, add no brackets.
- Use clear, everyday English matched to the learner's level. Be warm and encouraging, never condescending.
- Plain text only: no markdown, lists or headings.`

export type Role = 'user' | 'assistant'
export interface ChatMessage {
  role: Role
  content: string
}

export class AIError extends Error {
  status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'AIError'
    this.status = status
  }
}

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
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...history.map(({ role, content }) => ({ role, content })),
      ],
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
  return text
}
