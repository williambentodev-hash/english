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

/**
 * Reconhecimento de voz em inglês. `onTranscript` recebe o texto acumulado
 * da sessão atual (parcial enquanto o usuário fala, final ao terminar).
 */
export function useSpeechRecognition(onTranscript: (text: string) => void) {
  const [listening, setListening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const recRef = useRef<SpeechRecognitionLike | null>(null)
  const cbRef = useRef(onTranscript)
  cbRef.current = onTranscript

  const stop = useCallback(() => recRef.current?.stop(), [])

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor()
    if (!Ctor || recRef.current) return
    stopSpeaking() // não transcrever a própria voz do tutor
    setError(null)

    const rec = new Ctor()
    rec.lang = LANG
    rec.continuous = true
    rec.interimResults = true
    rec.onresult = (e) => {
      let text = ''
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript
      cbRef.current(text.trim())
    }
    rec.onerror = (e) => {
      if (e.error !== 'aborted' && e.error !== 'no-speech') {
        setError(STT_ERRORS[e.error] ?? 'Não foi possível ouvir. Tente de novo.')
      }
    }
    rec.onend = () => {
      recRef.current = null
      setListening(false)
    }
    recRef.current = rec
    try {
      rec.start()
      setListening(true)
    } catch {
      recRef.current = null
    }
  }, [])

  // encerra a captura se o componente desmontar
  useEffect(() => () => recRef.current?.abort(), [])

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
