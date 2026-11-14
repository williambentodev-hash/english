import { useEffect, type ReactNode } from 'react'
import SegmentedControl from './SegmentedControl'
import { LEVELS, type Level } from '../services/tutor'
import { SPEECH_RATES, setSpeechRate, ttsSupported, useSpeechRate } from '../services/speech'

interface Props {
  level: Level
  onLevelChange: (level: Level) => void
  blind: boolean
  onBlindChange: (blind: boolean) => void
  onClose: () => void
}

// do mais rápido para o mais lento, como pedido no layout (1×, 0.9×, 0.75×)
const RATE_OPTIONS = [...SPEECH_RATES].reverse().map((r) => ({ id: r, label: `${r}×` }))

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="px-1 text-[11px] font-medium uppercase tracking-wide text-zinc-400">{title}</h3>
      {children}
      {hint && <p className="px-1 text-xs leading-relaxed text-zinc-500">{hint}</p>}
    </section>
  )
}

/** Painel de ajustes (bottom sheet no celular, cartão centralizado no desktop). */
export default function SettingsModal({ level, onLevelChange, blind, onBlindChange, onClose }: Props) {
  const rate = useSpeechRate()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-zinc-900/20 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur-sm animate-in sm:items-center"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="w-full max-w-sm space-y-6 rounded-3xl bg-white/90 p-6 shadow-sm ring-1 ring-zinc-900/5 backdrop-blur-md"
      >
        <div className="flex items-center justify-between">
          <h2 id="settings-title" className="text-lg font-semibold tracking-tight">Ajustes</h2>
          <button
            type="button"
            onClick={onClose}
            className="-mr-2 min-h-11 rounded-full px-3 text-sm font-medium text-blue-500 transition-all duration-300 ease-out hover:bg-zinc-100 active:scale-95"
          >
            OK
          </button>
        </div>

        <Section title="Nível de fluência">
          <SegmentedControl label="Nível de fluência" options={LEVELS} value={level} onChange={onLevelChange} />
        </Section>

        {ttsSupported && (
          <Section title="Velocidade da voz">
            <SegmentedControl label="Velocidade da voz" options={RATE_OPTIONS} value={rate} onChange={setSpeechRate} />
          </Section>
        )}

        {ttsSupported && (
          <Section title="Áudio" hint="As respostas chegam só em áudio. Responda para ver o texto.">
            <label className="flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-2xl bg-zinc-100 px-4">
              <span className="flex items-center gap-2.5 text-sm font-medium text-zinc-800">
                <svg viewBox="0 0 24 24" className="h-5 w-5 text-zinc-500" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M3 14v-2a9 9 0 0 1 18 0v2" />
                  <rect x="3" y="14" width="4.5" height="6.5" rx="2" />
                  <rect x="16.5" y="14" width="4.5" height="6.5" rx="2" />
                </svg>
                Modo escuta
              </span>
              <input
                type="checkbox"
                role="switch"
                checked={blind}
                onChange={(e) => onBlindChange(e.target.checked)}
                className="peer sr-only"
              />
              <span
                aria-hidden
                className="relative h-[31px] w-[51px] shrink-0 rounded-full bg-zinc-300 transition-colors duration-300 ease-out peer-checked:bg-green-500 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-blue-500 after:absolute after:left-0.5 after:top-0.5 after:h-[27px] after:w-[27px] after:rounded-full after:bg-white after:shadow after:transition-transform after:duration-300 after:ease-out peer-checked:after:translate-x-5"
              />
            </label>
          </Section>
        )}

      </div>
    </div>
  )
}
