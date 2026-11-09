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

// Vozes que soam mais naturais, em ordem de preferência (Safari/iOS, Chrome, Edge).
const PREFERRED_VOICES = ['Samantha', 'Google US English', 'Microsoft Aria', 'Microsoft Jenny', 'Ava', 'Allison']

function pickVoice(): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices()
  const us = voices.filter((v) => v.lang.replace('_', '-') === LANG)
  for (const name of PREFERRED_VOICES) {
    const v = us.find((v) => v.name.includes(name))
    if (v) return v
  }
  return us.find((v) => v.localService) ?? us[0] ?? voices.find((v) => v.lang.startsWith('en'))
}

if (ttsSupported) {
  // em alguns navegadores a lista de vozes carrega de forma assíncrona
  window.speechSynthesis.getVoices()
  window.speechSynthesis.addEventListener?.('voiceschanged', () => window.speechSynthesis.getVoices())
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
  const u = new SpeechSynthesisUtterance(toSpeakable(text))
  u.lang = LANG
  u.rate = 0.95 // um pouco mais devagar, ajuda quem está aprendendo
  const voice = pickVoice()
  if (voice) u.voice = voice
  const done = () => { if (speakingId === id) setSpeakingId(null) }
  u.onend = done
  u.onerror = done
  setSpeakingId(id)
  synth.speak(u)
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
