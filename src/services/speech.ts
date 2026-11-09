// Recursos de áudio nativos do navegador:
// - Speech-to-Text via Web Speech API (webkitSpeechRecognition)
// - Text-to-Speech via window.speechSynthesis
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'

const LANG = 'en-US'

/* ---------------- Speech-to-Text ---------------- */

// Tipos mínimos: a Web Speech API ainda não faz parte do lib DOM do TypeScript.
interface SpeechRecognitionAlternativeLike { transcript: string }
interface SpeechRecognitionResultLike { isFinal: boolean; 0: SpeechRecognitionAlternativeLike }
interface SpeechRecognitionEventLike { results: ArrayLike<SpeechRecognitionResultLike> }
interface SpeechRecognitionErrorEventLike { error: string }
interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((e: SpeechRecognitionEventLike) => void) | null
  onerror: ((e: SpeechRecognitionErrorEventLike) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return w.webkitSpeechRecognition ?? w.SpeechRecognition ?? null
}

export const sttSupported = getRecognitionCtor() !== null

const STT_ERRORS: Record<string, string> = {
  'not-allowed': 'Permita o acesso ao microfone',
  'service-not-allowed': 'Permita o acesso ao microfone',
  'audio-capture': 'Nenhum microfone encontrado',
  network: 'Sem conexão para reconhecer a voz',
}

const norm = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '')

/**
 * Remove repetições consecutivas idênticas de palavras (eco/stuttering do
 * reconhecimento no celular): "hello hello my my name" → "hello my name".
 */
export function collapseRepeats(text: string) {
  const out: string[] = []
  for (const word of text.split(/\s+/)) {
    if (!word) continue
    const prev = out[out.length - 1]
    if (prev !== undefined && norm(prev) === norm(word) && norm(word) !== '') continue
    out.push(word)
  }
  return out.join(' ')
}

/**
 * Junta os resultados da sessão. No Chrome para Android cada resultado costuma
 * repetir o texto anterior inteiro ("hello" → "hello my" → "hello my name"),
 * então concatenar tudo duplica as palavras. Aqui, se o novo trecho já contém
 * o acumulado, ele o substitui; se já está contido no final, é ignorado.
 */
function mergeResults(results: ArrayLike<SpeechRecognitionResultLike>) {
  let acc = ''
  for (let i = 0; i < results.length; i++) {
    const t = results[i][0].transcript.trim()
    if (!t) continue
    const a = acc.toLowerCase()
    const b = t.toLowerCase()
    if (!acc || b.startsWith(a)) acc = t
    else if (!a.endsWith(b)) acc = `${acc} ${t}`
  }
  return collapseRepeats(acc)
}

// Instância ativa (no máximo uma), para que o TTS possa cortar o microfone.
let activeRec: SpeechRecognitionLike | null = null

/** Para o reconhecimento imediatamente (usado quando o tutor começa a falar). */
export function abortListening() {
  activeRec?.abort()
}

/**
 * Reconhecimento de voz em inglês. `onTranscript` recebe o texto acumulado
 * da sessão atual (parcial enquanto o usuário fala, final ao terminar),
 * já sem palavras repetidas.
 */
export function useSpeechRecognition(onTranscript: (text: string) => void) {
  const [listening, setListening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const recRef = useRef<SpeechRecognitionLike | null>(null)
  const endTimer = useRef<number | undefined>(undefined)
  const cbRef = useRef(onTranscript)
  cbRef.current = onTranscript

  /** Solta a instância: remove handlers, cancela timers e zera o estado. */
  const cleanup = useCallback((rec: SpeechRecognitionLike | null) => {
    window.clearTimeout(endTimer.current)
    if (rec) {
      rec.onresult = null
      rec.onerror = null
      rec.onend = null
    }
    if (recRef.current === rec) recRef.current = null
    if (activeRec === rec) activeRec = null
    setListening(false)
  }, [])

  const stop = useCallback(() => {
    const rec = recRef.current
    if (!rec) return
    rec.stop()
    // alguns navegadores móveis nem sempre disparam `onend`: força a limpeza
    window.clearTimeout(endTimer.current)
    endTimer.current = window.setTimeout(() => {
      if (recRef.current !== rec) return
      rec.abort()
      cleanup(rec)
    }, 1500)
  }, [cleanup])

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor()
    if (!Ctor || recRef.current) return
    // Toque acidental enquanto o tutor fala: só interrompe a leitura, sem abrir
    // o microfone — senão ele capta o eco do alto-falante do celular.
    if (speakingId !== null) {
      stopSpeaking()
      return
    }
    setError(null)

    const rec = new Ctor()
    rec.lang = LANG
    rec.continuous = true
    rec.interimResults = true
    rec.onresult = (e) => {
      if (recRef.current !== rec) return
      cbRef.current(mergeResults(e.results))
    }
    rec.onerror = (e) => {
      if (e.error !== 'aborted' && e.error !== 'no-speech') {
        setError(STT_ERRORS[e.error] ?? 'Não foi possível ouvir. Tente de novo.')
      }
    }
    rec.onend = () => cleanup(rec)
    recRef.current = rec
    activeRec = rec
    try {
      rec.start()
      setListening(true)
    } catch {
      cleanup(rec)
    }
  }, [cleanup])

  // encerra a captura e libera a instância se o componente desmontar
  useEffect(() => () => {
    const rec = recRef.current
    rec?.abort()
    cleanup(rec)
  }, [cleanup])

  return { supported: sttSupported, listening, error, start, stop }
}

/* ---------------- Text-to-Speech ---------------- */

export const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window

let speakingId: string | null = null
const listeners = new Set<() => void>()
function setSpeakingId(id: string | null) {
  speakingId = id
  listeners.forEach((l) => l())
}

/*
 * Seleção de voz: dá uma nota a cada voz em inglês e usa a melhor.
 * As vozes neurais gratuitas variam por plataforma:
 *  - Edge (desktop/Android): "Microsoft Aria/Jenny/Guy Online (Natural)"
 *  - Chrome: "Google US English" / "Google UK English Female"
 *  - iOS/macOS: "Ava (Premium)", "Samantha (Enhanced)", "Zoe", "Evan"...
 *  - Android: vozes "Google" com qualidade alta ("en-us-x-...-network")
 */
const QUALITY_KEYWORDS: [RegExp, number][] = [
  [/\bnatural\b/i, 100],
  [/\bneural\b/i, 90],
  [/\bpremium\b/i, 85],
  [/\benhanced\b/i, 75],
  [/\bonline\b/i, 30],
  [/network/i, 25], // vozes do Android que usam o servidor do Google
  [/^google (us|uk) english/i, 60],
  [/\bgoogle\b/i, 20],
]

// Vozes de boa qualidade conhecidas pelo nome (Apple, Microsoft e outras).
const GOOD_NAMES =
  /\b(ava|samantha|allison|susan|zoe|evan|nathan|joelle|noelle|tom|serena|daniel|kate|oliver|stephanie|aria|jenny|guy|michelle|ana|christopher|eric|roger|steffan|emma|brian|andrew|libby|sonia|ryan|siri)\b/i

// Vozes "de efeito" do macOS e sintetizadores antigos — soam muito robóticas.
const BAD_NAMES =
  /\b(albert|bad news|bahh|bells|boing|bubbles|cellos|deranged|fred|good news|hysterical|jester|junior|organ|pipe organ|ralph|superstar|trinoids|whisper|wobble|zarvox|grandma|grandpa|eddy|flo|reed|rocko|sandy|shelley|espeak)\b/i

function langScore(lang: string) {
  const l = lang.replace('_', '-').toLowerCase()
  if (l === 'en-us') return 40
  if (l === 'en-gb') return 30
  if (l.startsWith('en')) return 5
  return -Infinity
}

function scoreVoice(v: SpeechSynthesisVoice) {
  let score = langScore(v.lang)
  for (const [re, pts] of QUALITY_KEYWORDS) if (re.test(v.name)) score += pts
  if (GOOD_NAMES.test(v.name)) score += 40
  if (BAD_NAMES.test(v.name)) score -= 200
  // as vozes SAPI antigas do Windows (David, Zira, Mark) são as mais robóticas
  if (/microsoft (david|zira|mark|hazel|george)\b/i.test(v.name) && !/natural|online/i.test(v.name)) score -= 30
  if (v.default) score += 5
  return score
}

/* Velocidade da fala, escolhida pelo usuário e salva no localStorage. */
export const SPEECH_RATES = [0.75, 0.9, 1] as const
export type SpeechRate = (typeof SPEECH_RATES)[number]
const RATE_KEY = 'tutor_speech_rate'
const isRate = (v: unknown): v is SpeechRate => SPEECH_RATES.includes(v as SpeechRate)

let speechRate: SpeechRate = (() => {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(RATE_KEY) ?? 'null')
    return isRate(v) ? v : 1
  } catch {
    return 1
  }
})()
const rateListeners = new Set<() => void>()

export function setSpeechRate(rate: SpeechRate) {
  speechRate = rate
  try { localStorage.setItem(RATE_KEY, JSON.stringify(rate)) } catch { /* modo privado */ }
  rateListeners.forEach((l) => l())
}

export function useSpeechRate() {
  return useSyncExternalStore(
    (l) => { rateListeners.add(l); return () => rateListeners.delete(l) },
    () => speechRate,
  )
}

let cachedVoice: SpeechSynthesisVoice | null | undefined

function pickVoice(): SpeechSynthesisVoice | undefined {
  if (cachedVoice !== undefined) return cachedVoice ?? undefined
  const ranked = window.speechSynthesis
    .getVoices()
    .map((v) => ({ v, s: scoreVoice(v) }))
    .filter((x) => x.s > -Infinity)
    .sort((a, b) => b.s - a.s)
  // só guarda em cache quando a lista já carregou (ela pode vir vazia no início)
  if (ranked.length) cachedVoice = ranked[0].v
  return ranked[0]?.v
}

if (ttsSupported) {
  // em alguns navegadores a lista de vozes carrega de forma assíncrona
  window.speechSynthesis.getVoices()
  window.speechSynthesis.addEventListener?.('voiceschanged', () => {
    cachedVoice = undefined
    pickVoice()
  })
}

/**
 * Divide o texto em frases de até ~180 caracteres. Além de criar pausas naturais,
 * evita o bug do Chrome em que as vozes online param de falar depois de ~15 s.
 */
function splitIntoChunks(text: string, max = 180) {
  const sentences = text.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [text]
  const chunks: string[] = []
  let current = ''
  for (const s of sentences) {
    if (current && (current + s).length > max) {
      chunks.push(current.trim())
      current = ''
    }
    current += s
  }
  if (current.trim()) chunks.push(current.trim())
  return chunks
}

/** Remove as dicas entre colchetes e emojis, que soam estranhos lidos em voz alta. */
export function toSpeakable(text: string) {
  const clean = (s: string) => s.replace(/\p{Extended_Pictographic}️?/gu, '').replace(/\s+/g, ' ').trim()
  const main = clean(text.replace(/\[[^\]]*\]/g, ' '))
  return main || clean(text.replace(/[[\]]/g, ''))
}

export function speak(id: string, text: string) {
  if (!ttsSupported) return
  abortListening() // nunca ouvir o próprio alto-falante
  const synth = window.speechSynthesis
  synth.cancel()
  const voice = pickVoice()
  const chunks = splitIntoChunks(toSpeakable(text))
  if (!chunks.length) return
  const done = () => { if (speakingId === id) setSpeakingId(null) }
  setSpeakingId(id)
  chunks.forEach((chunk, i) => {
    const u = new SpeechSynthesisUtterance(chunk)
    if (voice) u.voice = voice
    u.lang = voice?.lang ?? LANG
    u.rate = speechRate // 0.75 = mais lento e pausado (treino de listening), 1 = normal
    u.pitch = 1.0
    if (i === chunks.length - 1) u.onend = done
    u.onerror = done
    synth.speak(u)
  })
}

export function stopSpeaking() {
  if (!ttsSupported) return
  window.speechSynthesis.cancel()
  setSpeakingId(null)
}

export const getSpeakingId = () => speakingId

/** true enquanto a mensagem `id` está sendo lida. */
export function useIsSpeaking(id: string) {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l) },
    () => speakingId === id,
  )
}
