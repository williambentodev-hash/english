// Pós-processamento do texto vindo do reconhecimento de voz (inglês).
//
// O reconhecedor devolve a fala em trechos: um por pausa (desktop) ou um por
// sessão reaberta (celular). Cada trecho chega "como se fosse uma frase nova":
// com a primeira letra maiúscula e sem pontuação. Juntá-los direto produz
// "I went to the store And then I Saw him". Aqui os trechos são costurados
// respeitando a pontuação natural.

// Palavras que continuam maiúsculas mesmo no meio da frase.
const ALWAYS_CAPITALIZED = new Set([
  'i', "i'm", "i'll", "i've", "i'd",
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'january', 'february', 'march', 'april', 'june', 'july', 'august',
  'september', 'october', 'november', 'december',
  'english', 'portuguese', 'spanish', 'french', 'german', 'italian', 'japanese', 'chinese',
  'brazil', 'brazilian', 'america', 'american', 'england', 'british', 'london', 'canada',
  'google', 'youtube', 'netflix', 'instagram', 'whatsapp', 'iphone', 'christmas', 'easter',
])
// "may" fica de fora de propósito: é muito mais comum como verbo.

const SENTENCE_END = /[.!?…]["')\]]*$/

/** Limpa espaços, quebras de linha e espaços antes de pontuação. */
function tidy(text: string) {
  return text
    .replace(/[\r\n]+/g, ' ') // a fala nunca deve criar quebras de linha
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.!?;:…])/g, '$1')
    .trim()
}

const upperFirst = (s: string) => s.replace(/^(\P{L}*)(\p{L})/u, (_, pre: string, c: string) => pre + c.toUpperCase())
const lowerFirst = (s: string) => s.replace(/^(\P{L}*)(\p{L})/u, (_, pre: string, c: string) => pre + c.toLowerCase())

/** Pronome "i" sozinho → "I"; maiúscula depois de ponto final dentro do trecho. */
function fixInner(text: string) {
  return text
    .replace(/\bi\b(?=$|[\s',!?;:])/g, 'I')
    .replace(/([.!?…]["')\]]*\s+)(\p{Ll})/gu, (_, sep: string, c: string) => sep + c.toUpperCase())
}

/** A primeira palavra do trecho deve continuar maiúscula no meio da frase? */
function keepsCapital(segment: string) {
  const word = segment.match(/^\P{L}*([\p{L}']+)/u)?.[1] ?? ''
  if (word.length > 1 && word === word.toUpperCase()) return true // sigla: "USA", "OK"
  return ALWAYS_CAPITALIZED.has(word.toLowerCase())
}

/**
 * Acrescenta um trecho de fala ao texto anterior.
 * - Depois de "." "!" "?" o trecho começa com maiúscula.
 * - Sem pontuação no fim do anterior, a pausa não vira frase nova: a
 *   maiúscula inserida pelo reconhecedor é desfeita.
 * - Nenhuma pontuação é inventada, então pausas não "fecham" a frase.
 */
export function appendTranscript(previous: string, segment: string) {
  const next = fixInner(tidy(segment))
  const prev = previous.replace(/\s+$/, '')
  if (!next) return prev
  if (!prev.trim()) return upperFirst(next)
  const startsNewSentence = SENTENCE_END.test(prev)
  const adjusted = startsNewSentence ? upperFirst(next) : keepsCapital(next) ? next : lowerFirst(next)
  // vírgula/ponto ditados no começo do trecho grudam no texto anterior
  return /^[,.!?;:…]/.test(adjusted) ? prev + adjusted : `${prev} ${adjusted}`
}

/** Junta vários trechos em um texto só, já normalizado. */
export function joinTranscript(segments: readonly string[]) {
  return segments.reduce(appendTranscript, '')
}
