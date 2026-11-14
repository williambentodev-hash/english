import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  checkExercise,
  errorTagLabel,
  generateExercises,
  type CheckResult,
  type Exercise,
  type Level,
  type WeakSpot,
} from '../services/tutor'

interface Props {
  level: Level
  /** erros recorrentes do aluno: ponto de partida do agente quando o servidor ainda não tem histórico */
  weakSpots: WeakSpot[]
  onClose: () => void
}

type Load = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; exercises: Exercise[] }

const primaryBtn =
  'min-h-12 w-full rounded-2xl bg-zinc-900 px-4 text-[15px] font-medium text-white transition-all duration-300 ease-out hover:bg-zinc-800 active:scale-[0.98] disabled:opacity-30 disabled:active:scale-100'
const secondaryBtn =
  'min-h-12 w-full rounded-2xl bg-zinc-100 px-4 text-[15px] font-medium text-zinc-700 transition-all duration-300 ease-out hover:bg-zinc-200 active:scale-[0.98]'

/** Exercícios gerados pelo agente do back-end a partir dos erros do aluno, um por vez. */
export default function ExercisesPanel({ level, weakSpots, onClose }: Props) {
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [index, setIndex] = useState(0)
  const [score, setScore] = useState(0)
  // pedido já feito para esta tentativa (o StrictMode roda o efeito duas vezes em desenvolvimento)
  const requested = useRef(-1)

  useEffect(() => {
    if (requested.current === attempt) return
    requested.current = attempt
    setLoad({ status: 'loading' })
    setIndex(0)
    setScore(0)
    generateExercises(level, weakSpots).then(
      (exercises) =>
        setLoad(exercises.length ? { status: 'ready', exercises } : { status: 'error', message: 'Nenhum exercício gerado. Tente de novo.' }),
      (e) => setLoad({ status: 'error', message: e instanceof Error ? e.message : 'Não foi possível gerar os exercícios.' }),
    )
    // nível e erros são lidos no momento do pedido; só uma nova tentativa refaz
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt])

  const total = load.status === 'ready' ? load.exercises.length : 0
  const finished = load.status === 'ready' && index >= total

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="exercises-title"
      className="fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-zinc-50 animate-in"
    >
      <header className="sticky top-0 z-10 border-b border-zinc-900/5 bg-zinc-50/80 backdrop-blur-md pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex h-14 max-w-2xl items-center justify-between px-4">
          <div className="leading-tight">
            <h2 id="exercises-title" className="text-[17px] font-semibold tracking-tight">Exercícios</h2>
            {load.status === 'ready' && !finished && (
              <p className="text-xs text-zinc-500" aria-live="polite">
                {index + 1} de {total}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            autoFocus
            className="min-h-11 rounded-full px-3 text-[15px] font-semibold text-blue-500 transition-all duration-300 ease-out hover:bg-zinc-100 active:scale-95"
          >
            Fechar
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-2xl space-y-3 px-4 pt-4 pb-[calc(2rem+env(safe-area-inset-bottom))]">
        {load.status === 'loading' && (
          <div className="rounded-3xl bg-white p-8 text-center shadow-sm ring-1 ring-zinc-900/5" aria-live="polite">
            <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-[3px] border-zinc-200 border-t-blue-500" aria-hidden />
            <p className="text-[15px] font-medium text-zinc-800">Analisando seus erros…</p>
            <p className="mt-1 text-sm text-zinc-500">O tutor está montando exercícios sobre os seus pontos fracos. Leva alguns segundos.</p>
          </div>
        )}

        {load.status === 'error' && (
          <div className="space-y-4 rounded-3xl bg-white p-6 text-center shadow-sm ring-1 ring-zinc-900/5">
            <p className="text-[15px] text-red-600">{load.message}</p>
            <button type="button" className={primaryBtn} onClick={() => setAttempt((n) => n + 1)}>
              Tentar de novo
            </button>
          </div>
        )}

        {load.status === 'ready' && !finished && (
          <ExerciseCard
            key={`${attempt}-${index}`}
            exercise={load.exercises[index]}
            last={index === total - 1}
            onDone={(correct) => {
              if (correct) setScore((s) => s + 1)
              setIndex((i) => i + 1)
            }}
          />
        )}

        {finished && (
          <div className="space-y-5 rounded-3xl bg-white p-6 text-center shadow-sm ring-1 ring-zinc-900/5 animate-in">
            <div>
              <p className="text-4xl font-semibold tracking-tight text-zinc-900">
                {score}/{total}
              </p>
              <p className="mt-1 text-sm text-zinc-500">
                {score === total ? 'Tudo certo! 🎉' : score >= total / 2 ? 'Bom trabalho. Continue praticando!' : 'Vale repetir: é assim que fixa.'}
              </p>
            </div>
            <div className="space-y-2">
              <button type="button" className={primaryBtn} onClick={() => setAttempt((n) => n + 1)}>
                Gerar novos exercícios
              </button>
              <button type="button" className={secondaryBtn} onClick={onClose}>
                Voltar à conversa
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/** Mostra a frase com a lacuna destacada. */
function Prompt({ text }: { text: string }) {
  const parts = text.split(/_{3,}/)
  return (
    <p lang="en" className="text-[19px] font-medium leading-snug text-zinc-900">
      {parts.map((part, i) => (
        <span key={i}>
          {part}
          {i < parts.length - 1 && <span className="mx-1 inline-block w-14 border-b-2 border-zinc-300 align-baseline" aria-label="lacuna" />}
        </span>
      ))}
    </p>
  )
}

function ExerciseCard({ exercise, last, onDone }: { exercise: Exercise; last: boolean; onDone: (correct: boolean) => void }) {
  const [picked, setPicked] = useState<string | null>(null)
  const [typed, setTyped] = useState('')
  const [checking, setChecking] = useState(false)
  const [checkError, setCheckError] = useState<string | null>(null)
  const [result, setResult] = useState<CheckResult | null>(null)

  function pick(option: string) {
    if (result) return
    setPicked(option)
    setResult({ correct: option === exercise.answer, feedback: null })
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const answer = typed.trim()
    if (!answer || checking || result) return
    setChecking(true)
    setCheckError(null)
    try {
      setResult(await checkExercise(exercise, answer))
    } catch (err) {
      setCheckError(err instanceof Error ? err.message : 'Não foi possível corrigir.')
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="space-y-5 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-zinc-900/5 animate-in">
      <div className="space-y-3">
        <span className="inline-block rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-blue-600">
          {errorTagLabel(exercise.tag)}
        </span>
        <p className="text-sm text-zinc-500">{exercise.instruction}</p>
        <Prompt text={exercise.prompt} />
      </div>

      {exercise.type === 'choice' ? (
        <div className="space-y-2" role="group" aria-label="Alternativas">
          {exercise.options.map((option) => {
            const isAnswer = option === exercise.answer
            const state = !result
              ? 'bg-zinc-100 text-zinc-800 hover:bg-zinc-200 active:scale-[0.98]'
              : isAnswer
                ? 'bg-green-50 text-green-800 ring-1 ring-green-300'
                : option === picked
                  ? 'bg-red-50 text-red-700 ring-1 ring-red-200'
                  : 'bg-zinc-100 text-zinc-400'
            return (
              <button
                key={option}
                type="button"
                lang="en"
                disabled={!!result}
                onClick={() => pick(option)}
                className={`flex min-h-12 w-full items-center justify-between rounded-2xl px-4 text-left text-[15px] font-medium transition-all duration-300 ease-out ${state}`}
              >
                {option}
                {result && isAnswer && <span aria-label="correta">✓</span>}
                {result && !isAnswer && option === picked && <span aria-label="incorreta">✕</span>}
              </button>
            )
          })}
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-2">
          <input
            lang="en"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            disabled={checking || !!result}
            autoCapitalize="sentences"
            autoComplete="off"
            spellCheck={false}
            placeholder="Escreva a frase correta"
            aria-label="Sua resposta"
            className="min-h-12 w-full rounded-2xl bg-zinc-100 px-4 text-base outline-none ring-1 ring-transparent transition-all duration-300 ease-out focus:bg-white focus:ring-zinc-300 disabled:text-zinc-500"
          />
          {!result && (
            <button type="submit" disabled={!typed.trim() || checking} className={primaryBtn}>
              {checking ? 'Corrigindo…' : 'Conferir'}
            </button>
          )}
          {checkError && (
            <p className="text-center text-sm text-red-600" role="alert">
              {checkError}
            </p>
          )}
        </form>
      )}

      {result && (
        <div className="space-y-4 animate-in" aria-live="polite">
          <div className={`space-y-1.5 rounded-2xl p-4 text-sm leading-relaxed ${result.correct ? 'bg-green-50 text-green-900' : 'bg-amber-50 text-amber-900'}`}>
            <p className="font-semibold">{result.correct ? 'Correto!' : 'Ainda não.'}</p>
            {result.feedback && <p>{result.feedback}</p>}
            {(!result.correct || exercise.type === 'rewrite') && (
              <p>
                Resposta: <span lang="en" className="font-medium">{exercise.answer}</span>
              </p>
            )}
            <p>{exercise.explanation}</p>
          </div>
          <button type="button" className={primaryBtn} onClick={() => onDone(result.correct)}>
            {last ? 'Ver resultado' : 'Próximo'}
          </button>
        </div>
      )}
    </div>
  )
}
