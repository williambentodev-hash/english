import { useRef, type KeyboardEvent } from 'react'

interface Option<T> {
  id: T
  label: string
}

interface Props<T extends string | number> {
  label: string
  options: readonly Option<T>[]
  value: T
  onChange: (value: T) => void
}

/** Controle segmentado estilo iOS (radiogroup acessível, navegação com setas). */
export default function SegmentedControl<T extends string | number>({ label, options, value, onChange }: Props<T>) {
  const index = Math.max(0, options.findIndex((o) => o.id === value))
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const n = options.length

  function onKeyDown(e: KeyboardEvent) {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const next = (index + step + n) % n
    onChange(options[next].id)
    refs.current[next]?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className="relative grid w-full rounded-full bg-zinc-900/[0.06] p-0.5"
      style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}
    >
      <span
        aria-hidden
        className="absolute inset-y-0.5 left-0.5 rounded-full bg-white shadow-sm ring-1 ring-zinc-900/5 transition-transform duration-300 ease-out"
        style={{ width: `calc((100% - 4px) / ${n})`, transform: `translateX(${index * 100}%)` }}
      />
      {options.map((o, i) => {
        const active = o.id === value
        return (
          <button
            key={String(o.id)}
            ref={(el) => { refs.current[i] = el }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(o.id)}
            className={`relative z-10 min-h-9 truncate rounded-full px-1 text-[13px] font-medium tracking-tight transition-colors duration-300 ease-out focus-visible:outline-2 focus-visible:outline-blue-500 ${
              active ? 'text-zinc-900' : 'text-zinc-500 hover:text-zinc-700'
            }`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
