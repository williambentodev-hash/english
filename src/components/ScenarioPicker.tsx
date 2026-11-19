import { scenariosFor, type Goal } from '../services/scenarios'

interface Props {
  goal: Goal
  /** id do cenário atual */
  value: string
  onChange: (id: string) => void
}

/** Escolha da situação a praticar, mostrada antes da primeira frase da conversa (chips que rolam de lado). */
export default function ScenarioPicker({ goal, value, onChange }: Props) {
  const current = scenariosFor(goal).find((s) => s.id === value)
  return (
    <section aria-labelledby="scenario-title" className="space-y-1.5 animate-in">
      <h2 id="scenario-title" className="px-1 text-[11px] font-medium uppercase tracking-wide text-zinc-400">
        O que você quer praticar?
      </h2>
      <div
        role="radiogroup"
        aria-labelledby="scenario-title"
        className="-mx-3 flex snap-x gap-1.5 overflow-x-auto px-3 pb-1 [scrollbar-width:none]"
      >
        {scenariosFor(goal).map((s) => {
          const active = s.id === value
          return (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={active}
              title={s.hint}
              onClick={() => onChange(s.id)}
              className={`flex h-9 shrink-0 snap-start items-center gap-1.5 rounded-full px-3 text-[13px] font-medium whitespace-nowrap ring-1 ring-inset transition-all duration-300 ease-out active:scale-95 ${
                active ? 'bg-blue-500 text-white ring-blue-500' : 'bg-white text-zinc-700 ring-zinc-900/10 hover:bg-zinc-50'
              }`}
            >
              <span aria-hidden>{s.emoji}</span>
              {s.title}
            </button>
          )
        })}
      </div>
      {current && <p className="px-1 text-xs text-zinc-500">{current.hint}</p>}
    </section>
  )
}
