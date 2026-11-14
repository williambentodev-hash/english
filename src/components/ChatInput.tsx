import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent } from 'react'
import { appendTranscript } from '../lib/transcript'
import { useSpeechRecognition } from '../services/speech'

interface Props {
  disabled?: boolean
  onSend: (text: string) => void
}

// Pressionar por mais que isso = modo "segurar para falar"; menos = toque liga/desliga.
const HOLD_MS = 350
// Atrasos das barras do indicador, para a onda não subir toda junta.
const BAR_DELAYS = [0, 180, 90, 270, 45]

export default function ChatInput({ disabled, onSend }: Props) {
  const [text, setText] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)
  const baseText = useRef('') // texto que já estava no input antes de começar a falar
  const press = useRef<{ at: number; startedNow: boolean } | null>(null)
  const lastPointerUp = useRef(0) // o `click` logo após um toque/clique já foi tratado no pointerdown

  // a fala é costurada ao que já estava digitado (maiúscula só depois de . ! ?)
  const mic = useSpeechRecognition((spoken) => setText(appendTranscript(baseText.current, spoken)))

  const canSend = text.trim().length > 0 && !disabled

  // ajusta a altura também quando o texto vem do microfone
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`
  }, [text])

  function submit(e?: FormEvent) {
    e?.preventDefault()
    if (!canSend) return
    mic.stop()
    onSend(text.trim())
    setText('')
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter envia no desktop; Shift+Enter quebra linha
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }

  function startMic() {
    baseText.current = text.trim()
    mic.start()
  }

  function toggleMic() {
    if (mic.listening) mic.stop()
    else startMic()
  }

  // Mouse, toque e caneta passam pelo pointerdown: responde na hora (sem o
  // atraso do `click` no celular) e permite "segurar para falar".
  function onMicDown(e: PointerEvent<HTMLButtonElement>) {
    if (e.button !== 0 || !e.isPrimary) return
    e.preventDefault() // mantém o foco/teclado como estão
    try {
      e.currentTarget.setPointerCapture(e.pointerId) // o soltar chega mesmo fora do botão
    } catch { /* ponteiro já liberado */ }
    if (mic.listening) {
      mic.stop()
      press.current = { at: Date.now(), startedNow: false }
    } else {
      startMic()
      press.current = { at: Date.now(), startedNow: true }
    }
  }

  function onMicUp() {
    const p = press.current
    press.current = null
    if (!p) return
    lastPointerUp.current = Date.now()
    // segurou: soltar encerra a gravação; toque rápido: continua gravando até o próximo toque
    if (p?.startedNow && Date.now() - p.at >= HOLD_MS) mic.stop()
  }

  return (
    // --sidebar-w (definida no App) desloca a barra quando a sidebar fixa do desktop está aberta
    <div className="fixed right-0 bottom-0 left-[var(--sidebar-w,0px)] z-40 border-t border-zinc-900/5 bg-white/80 backdrop-blur-md transition-[left] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]">
      {mic.listening && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none absolute inset-x-0 bottom-full mb-2 flex justify-center animate-in"
        >
          <span className="flex items-center gap-2.5 rounded-full bg-white/90 py-1.5 pr-3.5 pl-3 text-xs shadow-sm ring-1 ring-zinc-900/5 backdrop-blur-md">
            {/* onda de voz: repousa baixinha no silêncio e se move quando há fala */}
            <span className="flex h-3.5 items-center gap-[3px]" aria-hidden>
              {BAR_DELAYS.map((delay, i) => (
                <span
                  key={i}
                  className={`h-full w-[3px] origin-center rounded-full bg-red-500 transition-transform duration-300 ease-out ${
                    mic.hearing ? 'animate-sound-bar' : 'scale-y-[0.3]'
                  }`}
                  style={{ animationDelay: `${delay}ms` }}
                />
              ))}
            </span>
            <span className="font-medium text-zinc-700">Ouvindo…</span>
            <span className="text-zinc-400">toque para encerrar</span>
          </span>
        </div>
      )}
      <form
        onSubmit={submit}
        className="mx-auto flex max-w-2xl items-end gap-2 px-3 pt-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))]"
      >
        <textarea
          ref={ref}
          rows={1}
          value={text}
          placeholder={mic.listening ? 'Listening…' : mic.error ?? 'Write in English…'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          className={`flex-1 min-h-11 max-h-32 resize-none rounded-3xl bg-zinc-100 px-4 py-2.5 text-base leading-6 outline-none ring-1 transition-all duration-300 ease-out focus:bg-white focus:ring-zinc-300 ${
            mic.listening ? 'bg-white ring-red-200' : mic.error ? 'ring-transparent placeholder:text-red-400' : 'ring-transparent'
          }`}
        />
        {mic.supported && (
          <button
            type="button"
            aria-label={mic.listening ? 'Parar gravação' : 'Falar (toque ou segure)'}
            aria-pressed={mic.listening}
            title={mic.listening ? 'Toque para encerrar' : 'Toque ou segure para falar'}
            onPointerDown={onMicDown}
            onPointerUp={onMicUp}
            onPointerCancel={onMicUp}
            onClick={() => {
              // o click de um toque/clique já foi tratado no pointerdown; sobra
              // o teclado (Enter/Espaço) e leitores de tela (TalkBack/VoiceOver)
              if (Date.now() - lastPointerUp.current > 800) toggleMic()
            }}
            onContextMenu={(e) => e.preventDefault()}
            className={`flex h-11 w-11 shrink-0 touch-none select-none items-center [-webkit-tap-highlight-color:transparent] [-webkit-touch-callout:none] justify-center rounded-full transition-all duration-300 ease-out active:scale-90 ${
              mic.listening
                ? 'bg-red-500 text-white animate-mic-pulse'
                : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700'
            }`}
          >
            {mic.listening ? (
              // quadrado de "parar", como no Gravador do iPhone
              <span className="h-3.5 w-3.5 rounded-[4px] bg-white" aria-hidden />
            ) : (
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
              </svg>
            )}
          </button>
        )}
        <button
          type="submit"
          disabled={!canSend}
          aria-label="Enviar"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blue-500 text-white shadow-sm transition-all duration-300 ease-out hover:bg-blue-600 active:scale-90 disabled:bg-zinc-300 disabled:shadow-none"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </button>
      </form>
    </div>
  )
}
