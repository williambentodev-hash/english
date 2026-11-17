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

/** Meta de hoje na tela inicial: uma barra por habilidade e a ofensiva. */
export default function DailyGoalCard({ view, actions, onOpenStreak }: Props) {
  const { habit, today, streak } = view
  const skills = SKILLS.filter((s) => habit.goal[s.id] > 0)
  const doneCount = skills.filter((s) => skillMet(habit.goal, today, s.id)).length

  return (
    <section aria-labelledby="goal-title" className="space-y-3 rounded-3xl bg-white p-4 shadow-sm ring-1 ring-zinc-900/5 animate-in">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 id="goal-title" className="text-[15px] font-semibold tracking-tight">
            {streak.todayDone ? 'Meta de hoje cumprida! 🎉' : 'Meta de hoje'}
          </h2>
          <p className="text-xs text-zinc-500">
            {streak.todayDone
              ? 'Pode continuar praticando: tudo conta.'
              : `${doneCount} de ${skills.length} ${skills.length === 1 ? 'habilidade' : 'habilidades'} · complete todas para manter a ofensiva`}
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenStreak}
          aria-label={`Ofensiva de ${streak.current} ${streak.current === 1 ? 'dia' : 'dias'}. Ver detalhes e ajustar a meta`}
          className="flex min-h-11 shrink-0 items-center gap-1 rounded-full bg-orange-50 px-3 text-[15px] ring-1 ring-orange-200/60 transition-all duration-300 ease-out hover:bg-orange-100 active:scale-95"
        >
          <StreakFlame days={streak.current} lit={streak.todayDone} />
        </button>
      </div>

      <ul className="grid grid-cols-2 gap-2">
        {skills.map((s) => {
          const target = habit.goal[s.id]
          const n = today[s.id] ?? 0
          const cleared = s.id === 'vocab' && isVocabCleared() && n < target
          const met = skillMet(habit.goal, today, s.id)
          const pct = met ? 100 : Math.min(100, (n / target) * 100)
          const action = actions[s.id]
          const body = (
            <>
              <span className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium text-zinc-800">
                  <span aria-hidden>{s.emoji}</span>
                  <span className="truncate">{s.label}</span>
                </span>
                <span className={`text-xs tabular-nums ${met ? 'font-semibold text-emerald-600' : 'text-zinc-500'}`}>
                  {met ? '✓' : `${n}/${target}`}
                </span>
              </span>
              <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-zinc-100" aria-hidden>
                <span
                  className={`block h-full rounded-full transition-[width] duration-500 ease-out ${met ? 'bg-emerald-500' : 'bg-blue-500'}`}
                  style={{ width: `${pct}%` }}
                />
              </span>
              <span className="mt-1.5 block text-[11px] leading-snug text-zinc-400">
                {cleared ? 'Nada pendente para revisar hoje' : s.how}
              </span>
            </>
          )
          return (
            <li key={s.id}>
              {action ? (
                <button
                  type="button"
                  onClick={action}
                  className="block h-full w-full rounded-2xl bg-zinc-50 p-3 text-left ring-1 ring-zinc-900/5 transition-all duration-300 ease-out hover:bg-zinc-100 active:scale-[0.98]"
                >
                  {body}
                </button>
              ) : (
                <div className="h-full rounded-2xl bg-zinc-50 p-3 ring-1 ring-zinc-900/5">{body}</div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
