import { useMemo, useState } from 'react'
import SegmentedControl from './SegmentedControl'
import { addDays, dayKey, SKILLS, type HabitView, type Skill } from '../services/habit'

interface Props {
  view: HabitView
  /** abre a atividade de cada habilidade (ditado, exercícios, revisão, conversa) */
  actions: Partial<Record<Skill, () => void>>
}

const RANGES = [
  { id: 7, label: '7 dias' },
  { id: 30, label: '30 dias' },
] as const
type Range = (typeof RANGES)[number]['id']

const WEEKDAY = new Intl.DateTimeFormat('pt-BR', { weekday: 'narrow' })
const dateOf = (key: string) => {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}
const fmtDay = (key: string) =>
  dateOf(key).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '')

/** Barras diárias de uma habilidade, com a meta atual como linha tracejada. */
function DailyBars({ days, values, target, label, unit }: { days: string[]; values: number[]; target: number; label: string; unit: string }) {
  const max = Math.max(1, target, ...values)
  const today = dayKey()
  const dense = days.length > 10
  return (
    <div>
      <div className="relative flex h-20 items-end gap-[3px]" role="img" aria-label={`${label}: ${values.reduce((a, b) => a + b, 0)} ${unit} nos últimos ${days.length} dias`}>
        {target > 0 && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 border-t border-dashed border-zinc-300"
            style={{ bottom: `${(target / max) * 100}%` }}
          />
        )}
        {values.map((v, i) => {
          const met = target > 0 && v >= target
          return (
            <span
              key={days[i]}
              title={`${fmtDay(days[i])}: ${v} ${unit}`}
              className={`flex-1 rounded-t-[4px] transition-[height] duration-500 ease-out ${
                v === 0 ? 'bg-zinc-100' : met ? 'bg-emerald-500' : 'bg-blue-500'
              } ${days[i] === today ? 'opacity-100' : 'opacity-90'}`}
              style={{ height: v === 0 ? 3 : `${Math.max(8, (v / max) * 100)}%` }}
            />
          )
        })}
      </div>
      {dense ? (
        <div className="mt-1 flex justify-between text-[10px] text-zinc-400">
          <span>{fmtDay(days[0])}</span>
          <span>hoje</span>
        </div>
      ) : (
        <div className="mt-1 flex gap-[3px] text-center text-[10px] text-zinc-400" aria-hidden>
          {days.map((d) => (
            <span key={d} className={`flex-1 ${d === today ? 'font-semibold text-zinc-600' : ''}`}>
              {WEEKDAY.format(dateOf(d))}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/** Evolução por habilidade (Escrita, Fala, Escuta, Vocabulário) a partir do registro diário da meta. */
export default function SkillProgress({ view, actions }: Props) {
  const [range, setRange] = useState<Range>(7)
  const { habit } = view

  const data = useMemo(() => {
    const today = dayKey()
    const days = Array.from({ length: range }, (_, i) => addDays(today, i - range + 1))
    const prevDays = Array.from({ length: range }, (_, i) => addDays(today, i - 2 * range + 1))
    const count = (d: string, s: Skill) => habit.log[d]?.c[s] ?? 0
    const skills = SKILLS.map((s) => {
      const values = days.map((d) => count(d, s.id))
      const total = values.reduce((a, b) => a + b, 0)
      const prev = prevDays.reduce((n, d) => n + count(d, s.id), 0)
      const target = habit.goal[s.id]
      const metDays = target > 0 ? values.filter((v) => v >= target).length : 0
      const activeDays = values.filter((v) => v > 0).length
      // quanto da meta do período foi feito (habilidades fora da meta usam só os dias ativos)
      const share = target > 0 ? total / (target * range) : activeDays / range
      return { ...s, values, total, prev, target, metDays, activeDays, share }
    })
    const activeDays = days.filter((d) => SKILLS.some((s) => count(d, s.id) > 0)).length
    const goalDays = days.filter((d) => habit.log[d]?.done).length
    const everActive = Object.values(habit.log).some((e) => Object.values(e.c).some((n) => (n ?? 0) > 0))
    return { days, skills, activeDays, goalDays, everActive }
  }, [habit, range])

  if (!data.everActive) {
    return (
      <div className="flex flex-col items-center px-6 pt-20 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-2xl shadow-sm ring-1 ring-zinc-900/5">📊</div>
        <p className="mt-4 text-[15px] font-semibold">Nada praticado ainda</p>
        <p className="mt-1 max-w-xs text-sm leading-relaxed text-zinc-500">
          Converse, faça ditados, exercícios e revisões: cada habilidade ganha o seu gráfico aqui.
        </p>
      </div>
    )
  }

  // habilidade mais atrasada em relação à meta: sugestão de foco
  const weakest = [...data.skills].filter((s) => s.target > 0).sort((a, b) => a.share - b.share)[0]
  const weakAction = weakest && actions[weakest.id]

  return (
    <div className="space-y-3">
      <SegmentedControl label="Período" options={RANGES} value={range} onChange={setRange} />

      <div className="grid grid-cols-2 gap-3">
        <section className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-zinc-900/5">
          <h3 className="text-[13px] font-medium text-zinc-500">Dias praticados</h3>
          <p className="mt-1 text-[34px] font-semibold leading-none tracking-tight tabular-nums">
            {data.activeDays}
            <span className="text-base font-medium text-zinc-400">/{range}</span>
          </p>
          <p className="mt-1.5 text-xs text-zinc-400">
            meta cumprida em {data.goalDays} {data.goalDays === 1 ? 'dia' : 'dias'}
          </p>
        </section>
        <section className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-zinc-900/5">
          <h3 className="text-[13px] font-medium text-zinc-500">Equilíbrio</h3>
          <ul className="mt-2 space-y-1.5" aria-label="Parte da meta feita por habilidade">
            {data.skills.map((s) => (
              <li key={s.id} className="flex items-center gap-2 text-xs">
                <span aria-hidden className="w-4 text-center">{s.emoji}</span>
                <span className="sr-only">{s.label}</span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-100">
                  <span
                    className={`block h-full rounded-full ${s.share >= 1 ? 'bg-emerald-500' : 'bg-blue-500'}`}
                    style={{ width: `${Math.min(100, s.share * 100)}%` }}
                  />
                </span>
                <span className="w-8 text-right tabular-nums text-zinc-500">{Math.round(Math.min(s.share, 9.99) * 100)}%</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {weakest && weakest.share < 1 && (
        <div className="flex items-center gap-3 rounded-3xl bg-blue-50 p-4 ring-1 ring-blue-100">
          <span className="text-2xl" aria-hidden>{weakest.emoji}</span>
          <p className="min-w-0 flex-1 text-[13.5px] leading-snug text-blue-900">
            <span className="font-semibold">{weakest.label}</span> é a habilidade mais atrasada no período.
            <span className="block text-xs text-blue-700/80">{weakest.how}.</span>
          </p>
          {weakAction && (
            <button
              type="button"
              onClick={weakAction}
              className="min-h-11 shrink-0 rounded-full bg-blue-500 px-4 text-sm font-semibold text-white transition-all duration-300 ease-out hover:bg-blue-600 active:scale-95"
            >
              Praticar
            </button>
          )}
        </div>
      )}

      {data.skills.map((s) => {
        const diff = s.total - s.prev
        const pct = s.prev ? Math.round((diff / s.prev) * 100) : null
        const action = actions[s.id]
        return (
          <section key={s.id} className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-zinc-900/5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="flex items-center gap-1.5 text-[15px] font-semibold tracking-tight">
                  <span aria-hidden>{s.emoji}</span>
                  {s.label}
                </h3>
                <p className="mt-0.5 text-xs text-zinc-500">
                  <span className="text-[22px] font-semibold tabular-nums text-zinc-900">{s.total}</span> {s.unit}
                </p>
              </div>
              <div className="shrink-0 text-right text-xs">
                {s.prev === 0 && s.total === 0 ? null : pct === null ? (
                  <p className="font-medium text-emerald-600">novo no período</p>
                ) : (
                  <p className={`font-medium tabular-nums ${diff > 0 ? 'text-emerald-600' : diff < 0 ? 'text-rose-500' : 'text-zinc-500'}`}>
                    {diff > 0 ? '↑' : diff < 0 ? '↓' : '='} {Math.abs(pct)}%
                  </p>
                )}
                <p className="text-zinc-400">vs. {range} dias antes</p>
              </div>
            </div>

            <div className="mt-3">
              <DailyBars days={data.days} values={s.values} target={s.target} label={s.label} unit={s.unit} />
            </div>

            <div className="mt-2 flex items-center justify-between gap-3">
              <p className="text-xs text-zinc-400">
                {s.target > 0
                  ? `Meta de ${s.target}/dia cumprida em ${s.metDays} de ${range} dias`
                  : `Fora da meta diária · ativo em ${s.activeDays} ${s.activeDays === 1 ? 'dia' : 'dias'}`}
              </p>
              {action && (
                <button
                  type="button"
                  onClick={action}
                  className="min-h-9 shrink-0 rounded-full px-3 text-xs font-semibold text-blue-500 transition-all duration-300 ease-out hover:bg-blue-50 active:scale-95"
                >
                  Praticar ›
                </button>
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}
