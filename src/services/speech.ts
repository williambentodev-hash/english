// Recursos de áudio nativos do navegador:
// - Speech-to-Text via Web Speech API (webkitSpeechRecognition)
// - Text-to-Speech via window.speechSynthesis
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { appendTranscript } from '../lib/transcript'

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
  maxAlternatives: number
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
 * No desktop cada pausa gera um resultado novo, que é costurado ao anterior
 * por `appendTranscript` (sem a maiúscula falsa de "início de frase").
 */
function mergeResults(results: ArrayLike<SpeechRecognitionResultLike>) {
  let acc = ''
  for (let i = 0; i < results.length; i++) {
    const t = results[i][0].transcript.trim()
    if (!t) continue
    const a = acc.toLowerCase()
    const b = t.toLowerCase()
    if (!acc || b.startsWith(a)) acc = appendTranscript('', t)
    else if (!a.endsWith(b)) acc = appendTranscript(acc, t)
  }
  return collapseRepeats(acc)
}

// Sessão ativa (no máximo uma), para que o TTS possa cortar o microfone.
let abortActive: (() => void) | null = null

/** Para o reconhecimento imediatamente (usado quando o tutor começa a falar). */
export function abortListening() {
  abortActive?.()
}

// Erros em que não adianta reabrir o microfone.
const FATAL_ERRORS = new Set(['not-allowed', 'service-not-allowed', 'audio-capture', 'network', 'language-not-supported'])
// Proteção: encerra sozinho depois de muito tempo sem ouvir nada.
const IDLE_TIMEOUT_MS = 60_000
// Sessões que terminam quase na hora seguidas vezes indicam um problema: desiste.
const QUICK_END_MS = 1000
const MAX_QUICK_ENDS = 4
// Intervalo antes de reabrir a sessão: o Safari lança InvalidStateError se o
// `start()` vier colado no `onend` anterior.
const REOPEN_DELAY_MS = 120
// Por quanto tempo depois do último resultado a voz conta como "ouvida".
const HEARING_MS = 700

/**
 * Reconhecimento de voz em inglês. `onTranscript` recebe o texto acumulado
 * desde o início da gravação (parcial enquanto o usuário fala), já sem
 * palavras repetidas.
 *
 * O navegador encerra a sessão sozinho após alguns segundos de silêncio
 * (no celular, bem rápido). Para o usuário poder pausar e pensar, a sessão é
 * reaberta automaticamente, preservando o texto, até ele tocar no microfone
 * de novo, enviar a mensagem ou ficar 60 s em silêncio. Pausas nunca enviam
 * a mensagem nem inventam pontuação: o texto só é costurado.
 *
 * `hearing` fica true enquanto chegam resultados (o usuário está falando),
 * para o indicador visual reagir à voz.
 */
export function useSpeechRecognition(onTranscript: (text: string) => void) {
  const [listening, setListening] = useState(false)
  const [hearing, setHearing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const recRef = useRef<SpeechRecognitionLike | null>(null)
  const wantRef = useRef(false) // o usuário quer continuar gravando?
  const committedRef = useRef('') // texto de sessões anteriores desta gravação
  const sessionTextRef = useRef('') // texto da sessão atual
  const quickEnds = useRef(0)
  const endTimer = useRef<number | undefined>(undefined)
  const idleTimer = useRef<number | undefined>(undefined)
  const reopenTimer = useRef<number | undefined>(undefined)
  const hearingTimer = useRef<number | undefined>(undefined)
  const cbRef = useRef(onTranscript)
  cbRef.current = onTranscript

  const clearTimers = useCallback(() => {
    window.clearTimeout(endTimer.current)
    window.clearTimeout(idleTimer.current)
    window.clearTimeout(reopenTimer.current)
    window.clearTimeout(hearingTimer.current)
  }, [])

  const detach = useCallback((rec: SpeechRecognitionLike | null) => {
    if (!rec) return
    rec.onresult = null
    rec.onerror = null
    rec.onend = null
    if (recRef.current === rec) recRef.current = null
  }, [])

  /** Encerra a gravação de vez e zera o estado. */
  const finish = useCallback(() => {
    wantRef.current = false
    clearTimers()
    const rec = recRef.current
    detach(rec)
    rec?.abort()
    abortActive = null
    setListening(false)
    setHearing(false)
  }, [clearTimers, detach])

  const armIdle = useCallback(() => {
    window.clearTimeout(idleTimer.current)
    idleTimer.current = window.setTimeout(() => {
      wantRef.current = false
      recRef.current?.stop()
    }, IDLE_TIMEOUT_MS)
  }, [])

  /** Abre uma sessão do reconhecedor (a primeira ou uma reabertura). */
  const openSession = useCallback(() => {
    const Ctor = getRecognitionCtor()
    if (!Ctor) return finish()
    const rec = new Ctor()
    const startedAt = Date.now()
    sessionTextRef.current = ''
    rec.lang = LANG
    // continuous: uma pausa curta não encerra a sessão (no desktop);
    // interimResults: o texto aparece enquanto a pessoa fala, sem esperar a pausa.
    rec.continuous = true
    rec.interimResults = true
    rec.maxAlternatives = 1
    rec.onresult = (e) => {
      if (recRef.current !== rec) return
      sessionTextRef.current = mergeResults(e.results)
      quickEnds.current = 0
      armIdle()
      setHearing(true)
      window.clearTimeout(hearingTimer.current)
      hearingTimer.current = window.setTimeout(() => setHearing(false), HEARING_MS)
      cbRef.current(collapseRepeats(appendTranscript(committedRef.current, sessionTextRef.current)))
    }
    rec.onerror = (e) => {
      if (FATAL_ERRORS.has(e.error)) {
        wantRef.current = false
        setError(STT_ERRORS[e.error] ?? 'Não foi possível ouvir. Tente de novo.')
      }
      // 'no-speech' e 'aborted' são normais durante pausas: a sessão é reaberta
    }
    rec.onend = () => {
      if (recRef.current !== rec) return
      detach(rec)
      committedRef.current = appendTranscript(committedRef.current, sessionTextRef.current)
      sessionTextRef.current = ''
      quickEnds.current = Date.now() - startedAt < QUICK_END_MS ? quickEnds.current + 1 : 0
      if (!wantRef.current || quickEnds.current >= MAX_QUICK_ENDS) return finish()
      // pausa natural: reabre em seguida, mantendo o indicador "Ouvindo…"
      window.clearTimeout(reopenTimer.current)
      reopenTimer.current = window.setTimeout(() => {
        if (wantRef.current) openSession()
        else finish()
      }, REOPEN_DELAY_MS)
    }
    recRef.current = rec
    try {
      rec.start()
    } catch {
      finish()
    }
  }, [armIdle, detach, finish])

  const stop = useCallback(() => {
    const rec = recRef.current
    wantRef.current = false
    if (!rec) return finish()
    rec.stop() // deixa o navegador entregar o último trecho antes do `onend`
    // alguns navegadores móveis nem sempre disparam `onend`: força a limpeza
    window.clearTimeout(endTimer.current)
    endTimer.current = window.setTimeout(() => {
      if (recRef.current === rec) finish()
    }, 1500)
  }, [finish])

  const start = useCallback(() => {
    if (!getRecognitionCtor() || wantRef.current) return
    // Toque acidental enquanto o tutor fala: só interrompe a leitura, sem abrir
    // o microfone — senão ele capta o eco do alto-falante do celular.
    if (speakingId !== null) {
      stopSpeaking()
      return
    }
    setError(null)
    abortActive?.() // garante uma única gravação por vez
    wantRef.current = true
    committedRef.current = ''
    quickEnds.current = 0
    abortActive = finish
    setListening(true)
    armIdle()
    openSession()
  }, [armIdle, finish, openSession])

  // App em segundo plano (troca de aba, tela bloqueada): o navegador corta o
  // microfone e as reaberturas falhariam em sequência. Encerra de forma limpa.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden' && wantRef.current) stop()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [stop])

  // encerra a captura e libera a instância se o componente desmontar
  useEffect(() => () => {
    if (abortActive === finish) abortActive = null
    wantRef.current = false
    clearTimers()
    const rec = recRef.current
    detach(rec)
    rec?.abort()
  }, [clearTimers, detach, finish])

  return { supported: sttSupported, listening, hearing, error, start, stop }
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
export const isSpeechRate = (v: unknown): v is SpeechRate => SPEECH_RATES.includes(v as SpeechRate)

let speechRate: SpeechRate = (() => {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(RATE_KEY) ?? 'null')
    return isSpeechRate(v) ? v : 1
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
