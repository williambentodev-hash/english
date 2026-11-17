import { scenariosFor, type Goal } from '../services/scenarios'

interface Props {
  goal: Goal
  /** id do cenário atual */
  value: string
  onChange: (id: string) => void
}

/** Escolha da situação a praticar, mostrada antes da primeira frase da conversa (faixa que rola de lado). */
export default function ScenarioPicker({ goal, value, onChange }: Props) {
  return (
    <section aria-labelledby="scenario-title" className="space-y-1.5 animate-in">
      <h2 id="scenario-title" className="px-1 text-[11px] font-medium uppercase tracking-wide text-zinc-400">
        O que você quer praticar?
      </h2>
      <div
        role="radiogroup"
        aria-labelledby="scenario-title"
        className="-mx-3 flex snap-x gap-2 overflow-x-auto px-3 pb-2 [scrollbar-width:thin]"
      >
        {scenariosFor(goal).map((s) => {
          const active = s.id === value
          return (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(s.id)}
              className={`flex w-40 shrink-0 snap-start flex-col gap-1 rounded-2xl px-3 py-2.5 text-left ring-1 ring-inset transition-all duration-300 ease-out active:scale-[0.98] ${
                active ? 'bg-blue-50 ring-blue-300' : 'bg-white ring-zinc-900/5 hover:bg-zinc-50'
              }`}
            >
              <span className="text-lg leading-none" aria-hidden>{s.emoji}</span>
              <span className={`text-[13.5px] font-medium leading-snug ${active ? 'text-blue-700' : 'text-zinc-800'}`}>
                {s.title}
              </span>
              <span className="text-xs leading-snug text-zinc-500">{s.hint}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
