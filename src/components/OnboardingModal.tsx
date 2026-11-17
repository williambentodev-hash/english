import { useState, type FormEvent, type ReactNode } from 'react'
import type { Level } from '../services/tutor'
import { MAX_PROFESSION, type Goal } from '../services/scenarios'

interface Props {
  level: Level
  goal: Goal
  profession: string
  onDone: (choice: { level: Level; goal: Goal; profession: string }) => void
}

const LEVEL_CHOICES: { id: Level; title: string; hint: string }[] = [
  { id: 'beginner', title: 'Iniciante', hint: 'Entendo palavras e frases simples.' },
  { id: 'intermediate', title: 'Intermediário', hint: 'Consigo conversar, mas com erros e pausas.' },
  { id: 'advanced', title: 'Avançado', hint: 'Converso bem e quero soar mais natural.' },
]

const GOAL_CHOICES: { id: Goal; title: string; hint: string }[] = [
  { id: 'work', title: 'Para o trabalho', hint: 'Reuniões, explicar ideias, falar com clientes.' },
  { id: 'general', title: 'Para o dia a dia', hint: 'Conversas, viagens, situações comuns.' },
]

function Choice({ active, title, hint, onClick }: { active: boolean; title: string; hint: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={`flex min-h-14 w-full items-center gap-3 rounded-2xl px-4 py-2.5 text-left ring-1 transition-all duration-300 ease-out active:scale-[0.98] ${
        active ? 'bg-blue-50 ring-blue-300' : 'bg-zinc-100 ring-transparent hover:bg-zinc-200/70'
      }`}
    >
      <span className="min-w-0 flex-1">
        <span className={`block text-[15px] font-medium ${active ? 'text-blue-700' : 'text-zinc-800'}`}>{title}</span>
        <span className="block text-[13px] leading-snug text-zinc-500">{hint}</span>
      </span>
      <span
        aria-hidden
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ring-1 transition-colors duration-300 ${
          active ? 'bg-blue-500 ring-blue-500' : 'bg-white ring-zinc-300'
        }`}
      >
        {active && <span className="h-2 w-2 rounded-full bg-white" />}
      </span>
    </button>
  )
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-2">
      <legend className="px-1 pb-2 text-[15px] font-semibold tracking-tight text-zinc-900">{label}</legend>
      <div role="radiogroup" aria-label={label} className="space-y-2">
        {children}
      </div>
    </fieldset>
  )
}

/** Boas-vindas: o aluno escolhe o nível e o foco antes da primeira conversa. */
export default function OnboardingModal({ level, goal, profession, onDone }: Props) {
  const [pickedLevel, setPickedLevel] = useState<Level>(level)
  const [pickedGoal, setPickedGoal] = useState<Goal>(goal)
  const [job, setJob] = useState(profession)

  function submit(e: FormEvent) {
    e.preventDefault()
    onDone({ level: pickedLevel, goal: pickedGoal, profession: job.trim() })
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center overflow-y-auto bg-zinc-900/30 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur-sm animate-in sm:items-center">
      <form
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        className="w-full max-w-md space-y-6 rounded-3xl bg-white p-6 shadow-sm ring-1 ring-zinc-900/5"
      >
        <div>
          <h2 id="onboarding-title" className="text-xl font-semibold tracking-tight">Vamos ajustar o tutor para você</h2>
          <p className="mt-1 text-sm leading-relaxed text-zinc-500">
            Duas perguntas rápidas. Dá para mudar depois em Ajustes.
          </p>
        </div>

        <Group label="Qual é o seu nível de inglês?">
          {LEVEL_CHOICES.map((c) => (
            <Choice key={c.id} active={pickedLevel === c.id} title={c.title} hint={c.hint} onClick={() => setPickedLevel(c.id)} />
          ))}
        </Group>

        <Group label="Para que você quer o inglês?">
          {GOAL_CHOICES.map((c) => (
            <Choice key={c.id} active={pickedGoal === c.id} title={c.title} hint={c.hint} onClick={() => setPickedGoal(c.id)} />
          ))}
        </Group>

        {pickedGoal === 'work' && (
          <label className="block space-y-2 animate-in">
            <span className="block px-1 text-[15px] font-semibold tracking-tight text-zinc-900">Qual é a sua profissão?</span>
            <input
              value={job}
              onChange={(e) => setJob(e.target.value)}
              maxLength={MAX_PROFESSION}
              autoComplete="organization-title"
              placeholder="Ex.: arquiteto de soluções"
              className="min-h-12 w-full rounded-2xl bg-zinc-100 px-4 text-base outline-none ring-1 ring-transparent transition-all duration-300 ease-out placeholder:text-zinc-400 focus:bg-white focus:ring-zinc-300"
            />
            <span className="block px-1 text-xs leading-relaxed text-zinc-500">
              O tutor usa isso para puxar a conversa e o vocabulário para a sua área.
            </span>
          </label>
        )}

        <button
          type="submit"
          className="min-h-12 w-full rounded-2xl bg-zinc-900 px-4 text-[15px] font-medium text-white transition-all duration-300 ease-out hover:bg-zinc-800 active:scale-[0.98]"
        >
          Começar
        </button>
      </form>
    </div>
  )
}
