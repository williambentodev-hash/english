import { useEffect, type ReactNode } from 'react'
import SegmentedControl from './SegmentedControl'
import { StreakFlame } from './DailyGoalCard'
import {
  addDays,
  dayKey,
  FREEZE_EVERY,
  GOAL_PRESETS,
  MAX_FREEZES,
  MAX_TARGET,
  setDailyGoal,
  SKILLS,
  skillMet,
  type DailyGoal,
  type HabitView,
  type Skill,
} from '../services/habit'

interface Props {
  view: HabitView
  onClose: () => void
}

const WEEKDAY = new Intl.DateTimeFormat('pt-BR', { weekday: 'narrow' })
const dateOf = (key: string) => {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

const CUSTOM = 'custom'
const presetOf = (goal: DailyGoal) =>
  GOAL_PRESETS.find((p) => (Object.keys(goal) as Skill[]).every((s) => p.goal[s] === goal[s]))?.id ?? CUSTOM

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-zinc-900/5">
      <h3 className="text-[13px] font-medium text-zinc-500">{title}</h3>
      <div className="mt-2">{children}</div>
    </section>
  )
}

function Stepper({ value, onChange, step }: { value: number; onChange: (v: number) => void; step: number }) {
  const btn =
    'flex h-9 w-9 items-center justify-center rounded-full bg-zinc-100 text-lg font-medium text-zinc-700 transition-all duration-200 ease-out hover:bg-zinc-200 active:scale-90 disabled:opacity-30'
  return (
    <div className="flex items-center gap-1.5">
      <button type="button" className={btn} disabled={value <= 0} onClick={() => onChange(Math.max(0, value - step))} aria-label="Diminuir">
        −
      </button>
      <span className="w-8 text-center text-[15px] font-semibold tabular-nums" aria-live="polite">
        {value || '—'}
      </span>
      <button type="button" className={btn} disabled={value >= MAX_TARGET} onClick={() => onChange(Math.min(MAX_TARGET, value + step))} aria-label="Aumentar">
        +
      </button>
    </div>
  )
}

/** Ofensiva, últimos 7 dias, progresso de hoje e configuração da meta diária. */
export default function StreakPanel({ view, onClose }: Props) {
  const { habit, today, streak } = view
  const todayKey = dayKey()
  const week = Array.from({ length: 7 }, (_, i) => addDays(todayKey, i - 6))
  const preset = presetOf(habit.goal)
  const activeSkills = SKILLS.filter((s) => habit.goal[s.id] > 0).length

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  function setTarget(s: Skill, v: number) {
    const next = { ...habit.goal, [s]: v }
    // pelo menos uma habilidade precisa continuar na meta
    if (Object.values(next).every((n) => n === 0)) return
    setDailyGoal(next)
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="streak-title" className="fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-zinc-50 animate-in">
      <header className="sticky top-0 z-10 border-b border-zinc-900/5 bg-zinc-50/80 backdrop-blur-md pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex h-14 max-w-2xl items-center justify-between px-4">
          <h2 id="streak-title" className="text-[17px] font-semibold tracking-tight">Meta diária</h2>
          <button
            onClick={onClose}
            autoFocus
            className="min-h-11 rounded-full px-3 text-[15px] font-semibold text-blue-500 transition-all duration-300 ease-out hover:bg-zinc-100 active:scale-95"
          >
            OK
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-2xl space-y-3 px-4 pt-4 pb-[calc(2rem+env(safe-area-inset-bottom))]">
        {/* ofensiva */}
        <section className="rounded-3xl bg-white p-5 text-center shadow-sm ring-1 ring-zinc-900/5">
          <StreakFlame days={streak.current} lit={streak.todayDone} className="text-5xl" />
          <p className="mt-1 text-[15px] font-semibold">
            {streak.current === 1 ? '1 dia de ofensiva' : `${streak.current} dias de ofensiva`}
          </p>
          <p className="mt-0.5 text-sm text-zinc-500">
            {streak.todayDone
              ? 'Meta de hoje cumprida. Volte amanhã para continuar!'
              : streak.current > 0
                ? 'Cumpra a meta de hoje para não perder a ofensiva.'
                : 'Cumpra a meta de hoje para começar uma ofensiva.'}
          </p>

          <ol className="mt-4 grid grid-cols-7 gap-1" aria-label="Últimos 7 dias">
            {week.map((d) => {
              const done = !!habit.log[d]?.done
              const frozen = streak.frozen.has(d)
              const isToday = d === todayKey
              const label = done ? 'meta cumprida' : frozen ? 'protegido' : isToday ? 'hoje, em andamento' : 'sem meta'
              return (
                <li key={d} className="flex flex-col items-center gap-1" aria-label={`${dateOf(d).toLocaleDateString('pt-BR')}: ${label}`}>
                  <span className="text-[11px] uppercase text-zinc-400">{WEEKDAY.format(dateOf(d))}</span>
                  <span
                    className={`flex h-9 w-9 items-center justify-center rounded-full text-sm ${
                      done ? 'bg-orange-500 text-white' : frozen ? 'bg-sky-100' : 'bg-zinc-100 text-zinc-300'
                    } ${isToday ? 'ring-2 ring-orange-300 ring-offset-2' : ''}`}
                    aria-hidden
                  >
                    {done ? '✓' : frozen ? '🧊' : '·'}
                  </span>
                </li>
              )
            })}
          </ol>

          <div className="mt-4 grid grid-cols-2 gap-2 text-left">
            <div className="rounded-2xl bg-zinc-50 p-3">
              <p className="text-xs text-zinc-500">Recorde</p>
              <p className="text-lg font-semibold tabular-nums">
                {streak.best} {streak.best === 1 ? 'dia' : 'dias'}
              </p>
            </div>
            <div className="rounded-2xl bg-zinc-50 p-3">
              <p className="text-xs text-zinc-500">Proteções</p>
              <p className="text-lg font-semibold tabular-nums">
                {streak.freezes > 0 ? '🧊'.repeat(streak.freezes) : '—'}
                <span className="ml-1 text-xs font-normal text-zinc-400">de {MAX_FREEZES}</span>
              </p>
            </div>
          </div>
          <p className="mt-2 text-left text-xs leading-relaxed text-zinc-500">
            A cada {FREEZE_EVERY} dias seguidos você ganha uma proteção. Se perder um dia, ela é usada sozinha e a ofensiva continua.
          </p>
        </section>

        {/* hoje */}
        <Card title="Hoje">
          <ul className="divide-y divide-zinc-900/5">
            {SKILLS.filter((s) => habit.goal[s.id] > 0).map((s) => {
              const n = today[s.id] ?? 0
              const met = skillMet(habit.goal, today, s.id)
              return (
                <li key={s.id} className="flex items-center gap-3 py-2.5">
                  <span className="text-lg" aria-hidden>{s.emoji}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-zinc-800">{s.label}</span>
                    <span className="block text-xs text-zinc-500">{s.how}</span>
                  </span>
                  <span className={`text-sm tabular-nums ${met ? 'font-semibold text-emerald-600' : 'text-zinc-500'}`}>
                    {met ? '✓ ' : ''}
                    {n}/{habit.goal[s.id]}
                  </span>
                </li>
              )
            })}
          </ul>
        </Card>

        {/* configurar a meta */}
        <Card title="Sua meta">
          <SegmentedControl
            label="Intensidade da meta"
            value={preset}
            onChange={(id) => {
              const p = GOAL_PRESETS.find((x) => x.id === id)
              if (p) setDailyGoal(p.goal)
            }}
            options={[
              ...GOAL_PRESETS.map((p) => ({ id: p.id, label: p.label })),
              ...(preset === CUSTOM ? [{ id: CUSTOM, label: 'Própria' }] : []),
            ]}
          />
          <p className="mt-2 text-xs text-zinc-500">
            {GOAL_PRESETS.find((p) => p.id === preset)?.hint ?? 'Meta personalizada'} por dia · ajuste cada habilidade abaixo (— desliga)
          </p>
          <ul className="mt-2 divide-y divide-zinc-900/5">
            {SKILLS.map((s) => (
              <li key={s.id} className="flex items-center gap-3 py-2.5">
                <span className="text-lg" aria-hidden>{s.emoji}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-zinc-800">{s.label}</span>
                  <span className="block text-xs text-zinc-500">{habit.goal[s.id] ? s.unit : 'fora da meta'}</span>
                </span>
                <Stepper
                  value={habit.goal[s.id]}
                  step={s.id === 'vocab' ? 5 : 1}
                  onChange={(v) => (v === 0 && activeSkills === 1 && habit.goal[s.id] > 0 ? undefined : setTarget(s.id, v))}
                />
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs leading-relaxed text-zinc-500">
            Para aprender rápido, mantenha as 4 habilidades na meta. Mudar a meta não altera os dias que já passaram.
          </p>
        </Card>
      </div>
    </div>
  )
}
