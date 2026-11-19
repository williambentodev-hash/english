import { isVocabCleared, SKILLS, skillMet, type HabitView, type Skill } from '../services/habit'

interface Props {
  view: HabitView
  /** abre a atividade da habilidade (ditado, revisão...); ausente = praticada na própria conversa */
  actions: Partial<Record<Skill, () => void>>
  onOpenStreak: () => void
}

export function StreakFlame({ days, lit, className = '' }: { days: number; lit: boolean; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 font-semibold tabular-nums ${lit ? 'text-orange-500' : 'text-zinc-400'} ${className}`}>
      <span aria-hidden className={lit ? '' : 'grayscale opacity-60'}>🔥</span>
      {days}
    </span>
  )
}

/** Anel de progresso pequeno com o emoji da habilidade no centro. */
function Ring({ pct, met, emoji }: { pct: number; met: boolean; emoji: string }) {
  const r = 15
  const c = 2 * Math.PI * r
  return (
    <span className="relative flex h-9 w-9 items-center justify-center">
      <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx="18" cy="18" r={r} fill="none" strokeWidth="3" className="stroke-zinc-100" />
        <circle
          cx="18"
          cy="18"
          r={r}
          fill="none"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct / 100)}
          className={`transition-[stroke-dashoffset] duration-500 ease-out ${met ? 'stroke-emerald-500' : 'stroke-blue-500'}`}
        />
      </svg>
      <span className="text-[15px] leading-none" aria-hidden>{emoji}</span>
    </span>
  )
}

/** Meta de hoje na tela inicial: faixa compacta com um anel por habilidade. */
export default function DailyGoalCard({ view, actions, onOpenStreak }: Props) {
  const { habit, today, streak } = view
  const skills = SKILLS.filter((s) => habit.goal[s.id] > 0)
  const doneCount = skills.filter((s) => skillMet(habit.goal, today, s.id)).length

  return (
    <section aria-labelledby="goal-title" className="flex items-center gap-2 rounded-2xl bg-white py-2 pr-2 pl-3.5 shadow-sm ring-1 ring-zinc-900/5 animate-in">
      <button
        type="button"
        onClick={onOpenStreak}
        className="min-w-0 flex-1 rounded-xl py-1 text-left transition-opacity duration-200 hover:opacity-70"
        aria-label={`Meta de hoje: ${doneCount} de ${skills.length} habilidades. Ver detalhes e ajustar a meta`}
      >
        <h2 id="goal-title" className="truncate text-[13.5px] font-semibold tracking-tight">
          {streak.todayDone ? 'Meta cumprida 🎉' : 'Meta de hoje'}
        </h2>
        <p className="truncate text-xs text-zinc-500 tabular-nums">
          {doneCount}/{skills.length} {skills.length === 1 ? 'habilidade' : 'habilidades'} ›
        </p>
      </button>
      <ul className="flex shrink-0 items-center gap-0.5">
        {skills.map((s) => {
          const target = habit.goal[s.id]
          const n = today[s.id] ?? 0
          const cleared = s.id === 'vocab' && isVocabCleared() && n < target
          const met = skillMet(habit.goal, today, s.id)
          const pct = met ? 100 : Math.min(100, (n / target) * 100)
          const label = `${s.label}: ${met ? 'cumprida' : `${n} de ${target}`}${cleared ? ' (nada pendente)' : ''}`
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={actions[s.id] ?? onOpenStreak}
                aria-label={label}
                title={`${label} · ${s.how}`}
                className="flex h-11 w-11 items-center justify-center rounded-full transition-all duration-200 ease-out hover:bg-zinc-50 active:scale-90"
              >
                <Ring pct={pct} met={met} emoji={s.emoji} />
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
