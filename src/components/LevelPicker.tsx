import { useRef, type KeyboardEvent } from 'react'
import { LEVELS, type Level } from '../services/groq'

interface Props {
  value: Level
  onChange: (level: Level) => void
}

/** Controle segmentado estilo iOS para o nível de fluência. */
export default function LevelPicker({ value, onChange }: Props) {
  const index = Math.max(0, LEVELS.findIndex((l) => l.id === value))
  const refs = useRef<(HTMLButtonElement | null)[]>([])

  function onKeyDown(e: KeyboardEvent) {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const next = (index + step + LEVELS.length) % LEVELS.length
    onChange(LEVELS[next].id)
    refs.current[next]?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-label="Nível de fluência"
      onKeyDown={onKeyDown}
      className="relative grid w-full max-w-sm grid-cols-3 rounded-full bg-zinc-900/[0.06] p-0.5"
    >
      <span
        aria-hidden
        className="absolute inset-y-0.5 left-0.5 w-[calc((100%-4px)/3)] rounded-full bg-white shadow-sm ring-1 ring-zinc-900/5 transition-transform duration-300 ease-out"
        style={{ transform: `translateX(${index * 100}%)` }}
      />
      {LEVELS.map((l, i) => {
        const active = l.id === value
        return (
          <button
            key={l.id}
            ref={(el) => { refs.current[i] = el }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(l.id)}
            className={`relative z-10 min-h-8 rounded-full text-[13px] font-medium tracking-tight transition-colors duration-300 ease-out focus-visible:outline-2 focus-visible:outline-blue-500 ${
              active ? 'text-zinc-900' : 'text-zinc-500 hover:text-zinc-700'
            }`}
          >
            {l.label}
          </button>
        )
      })}
    </div>
  )
}
