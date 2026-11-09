import { useEffect, useId, type ReactNode } from 'react'
import type { ChatMessage, Feedback } from '../services/groq'
import { getSpeakingId, speak, stopSpeaking, ttsSupported, useIsSpeaking } from '../services/speech'

function SoundBars({ className = 'h-4' }: { className?: string }) {
  return (
    <span className={`flex items-center gap-[3px] ${className}`} aria-hidden>
      {[0, 200, 400].map((d) => (
        <span
          key={d}
          className="h-full w-[3px] rounded-full bg-current animate-sound-bar"
          style={{ animationDelay: `${d}ms` }}
        />
      ))}
    </span>
  )
}

function ListenButton({ text, autoPlay, small }: { text: string; autoPlay?: boolean; small?: boolean }) {
  const id = useId()
  const speaking = useIsSpeaking(id)

  // para a leitura se a mensagem sair da tela (ex.: "Nova" conversa)
  useEffect(() => () => { if (getSpeakingId() === id) stopSpeaking() }, [id])

  // modo escuta: a mensagem nova já chega falando (só na montagem)
  useEffect(() => {
    if (autoPlay) speak(id, text)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <button
      type="button"
      onClick={() => (speaking ? stopSpeaking() : speak(id, text))}
      aria-label={speaking ? 'Parar leitura' : 'Ouvir'}
      title={speaking ? 'Parar' : 'Ouvir'}
      className={`flex shrink-0 items-center justify-center rounded-full transition-all duration-300 ease-out active:scale-90 ${
        small ? 'h-8 w-8' : 'h-9 w-9'
      } ${speaking ? 'bg-blue-50 text-blue-500' : 'text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600'}`}
    >
      {speaking ? (
        <SoundBars className={small ? 'h-3.5' : 'h-4'} />
      ) : (
        <svg viewBox="0 0 24 24" className={small ? 'h-4 w-4' : 'h-[18px] w-[18px]'} fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M11 5 6 9H3v6h3l5 4V5z" fill="currentColor" fillOpacity={0.12} />
          <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
        </svg>
      )}
    </button>
  )
}

/* ---------------- Score e correção ---------------- */

function scoreTone(score: number) {
  if (score >= 8) return { badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200/70', bar: 'bg-emerald-500', label: score >= 9 ? 'Excelente' : 'Muito bom' }
  if (score >= 5) return { badge: 'bg-amber-50 text-amber-700 ring-amber-200/70', bar: 'bg-amber-400', label: 'Quase lá' }
  return { badge: 'bg-rose-50 text-rose-700 ring-rose-200/70', bar: 'bg-rose-400', label: 'Vamos ajustar' }
}

function Section({ label, accent, children }: { label: string; accent: string; children: ReactNode }) {
  return (
    <div className={`border-l-2 pl-2.5 ${accent}`}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">{label}</p>
      <div className="mt-0.5 text-[13.5px] leading-snug text-zinc-700">{children}</div>
    </div>
  )
}

function FeedbackCard({ feedback }: { feedback: Feedback }) {
  const { score, correction, native } = feedback
  const tone = score != null ? scoreTone(score) : null

  return (
    <div className="w-full max-w-[85%] space-y-2.5 rounded-2xl bg-white/60 p-3 ring-1 ring-zinc-900/5 sm:max-w-[70%]">
      {tone && score != null ? (
        <div className="flex items-center gap-2.5">
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ring-1 ${tone.badge}`}>
            {score}/10
          </span>
          <span className="text-xs font-medium text-zinc-500">{tone.label}</span>
          <span className="ml-auto h-1 w-16 overflow-hidden rounded-full bg-zinc-900/5" aria-hidden>
            <span className={`block h-full rounded-full ${tone.bar}`} style={{ width: `${score * 10}%` }} />
          </span>
        </div>
      ) : (
        <p className="text-xs font-medium text-zinc-500">Tente escrever em inglês 🙂</p>
      )}

      {correction && (
        <Section label="Onde errou" accent="border-amber-300">{correction}</Section>
      )}

      <Section label={score == null ? 'Em inglês' : 'Versão nativa'} accent="border-blue-300">
        <div className="flex items-start justify-between gap-1">
          <span className="pt-1.5">“{native}”</span>
          {ttsSupported && <ListenButton text={native} small />}
        </div>
      </Section>
    </div>
  )
}

/* ---------------- Modo escuta ---------------- */

function HiddenContent({ onReveal }: { onReveal?: () => void }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2.5 text-zinc-400">
        <span className="flex h-5 items-center gap-[3px]" aria-hidden>
          {[40, 75, 55, 100, 65, 85, 45, 70, 35, 60].map((h, i) => (
            <span key={i} className="w-[3px] rounded-full bg-zinc-300" style={{ height: `${h}%` }} />
          ))}
        </span>
        <span className="text-sm">Ouça e responda</span>
      </div>
      {onReveal && (
        <button
          type="button"
          onClick={onReveal}
          className="text-sm font-medium text-blue-500 transition-colors hover:text-blue-600"
        >
          Revelar texto
        </button>
      )}
    </div>
  )
}

/* ---------------- Bolha ---------------- */

interface Props {
  message: ChatMessage
  onReveal?: () => void
}

export default function MessageBubble({ message, onReveal }: Props) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end animate-in">
        <div className="max-w-[80%] whitespace-pre-wrap break-words rounded-3xl rounded-br-lg bg-blue-500 px-4 py-2.5 text-[15px] leading-relaxed text-white shadow-sm sm:max-w-[70%]">
          {message.content}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-start gap-1.5 animate-in">
      {message.feedback && <FeedbackCard feedback={message.feedback} />}
      <div className="flex w-full items-end gap-1">
        <div className="max-w-[80%] whitespace-pre-wrap break-words rounded-3xl rounded-bl-lg bg-white px-4 py-2.5 text-[15px] leading-relaxed text-zinc-900 shadow-sm ring-1 ring-zinc-900/5 sm:max-w-[70%]">
          {message.hidden ? <HiddenContent onReveal={onReveal} /> : message.content}
        </div>
        {ttsSupported && <ListenButton text={message.content} autoPlay={message.hidden} />}
      </div>
    </div>
  )
}

export function TypingIndicator() {
  return (
    <div className="flex justify-start animate-in" aria-label="Tutor digitando">
      <div className="flex items-center gap-1 rounded-3xl rounded-bl-lg bg-white px-4 py-3.5 shadow-sm ring-1 ring-zinc-900/5">
        {[0, 150, 300].map((d) => (
          <span
            key={d}
            className="h-2 w-2 rounded-full bg-zinc-400 animate-typing"
            style={{ animationDelay: `${d}ms` }}
          />
        ))}
      </div>
    </div>
  )
}
