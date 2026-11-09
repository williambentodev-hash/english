import { useEffect, useRef, useState } from 'react'
import { SPEECH_RATES, setSpeechRate, useSpeechRate, type SpeechRate } from '../services/speech'

const label = (r: SpeechRate) => `${r}×`
const HINT: Record<SpeechRate, string> = { 0.75: 'Lenta', 0.9: 'Pausada', 1: 'Normal' }

/** Botão compacto (estilo "1×" de podcasts) que abre um seletor da velocidade da fala. */
export default function SpeedPicker() {
  const rate = useSpeechRate()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  // fecha ao tocar fora ou com Esc
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const slowed = rate !== 1

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`Velocidade da voz: ${label(rate)}`}
        title="Velocidade da voz"
        className={`flex h-11 min-w-11 items-center justify-center rounded-full px-2 transition-all duration-300 ease-out active:scale-95 ${
          slowed || open ? 'bg-blue-50 text-blue-500' : 'text-zinc-500 hover:bg-zinc-100'
        }`}
      >
        <span className="text-[13px] font-semibold tabular-nums tracking-tight">{label(rate)}</span>
      </button>

      {open && (
        <div
          role="radiogroup"
          aria-label="Velocidade da voz"
          className="absolute right-0 top-full z-40 mt-1.5 w-44 origin-top-right rounded-2xl bg-white/90 p-1 shadow-lg ring-1 ring-zinc-900/5 backdrop-blur-md animate-in"
        >
          <p className="px-3 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-400">Velocidade da voz</p>
          {SPEECH_RATES.map((r) => {
            const active = r === rate
            return (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => { setSpeechRate(r); setOpen(false) }}
                className={`flex min-h-10 w-full items-center justify-between rounded-xl px-3 text-sm transition-colors duration-200 ${
                  active ? 'bg-blue-50 text-blue-600' : 'text-zinc-700 hover:bg-zinc-100'
                }`}
              >
                <span className="font-medium tabular-nums">{label(r)}</span>
                <span className={`text-xs ${active ? 'text-blue-500' : 'text-zinc-400'}`}>{HINT[r]}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
