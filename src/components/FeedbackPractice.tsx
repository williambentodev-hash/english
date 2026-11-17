// Prática em cima de uma correção do tutor:
// - RepeatPractice: o aluno repete a versão nativa em voz alta e vê palavra a palavra o que saiu.
// - RetryPractice: o aluno reescreve a frase corrigida de memória (a versão nativa fica escondida).
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { matchScore, matchWords } from '../lib/compare'
import { stopSpeaking, useSpeechRecognition } from '../services/speech'
import { checkRewrite, type CheckResult } from '../services/tutor'

const smallBtn =
  'flex min-h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-all duration-300 ease-out active:scale-95'

const MicIcon = () => (
  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
  </svg>
)

/* ---------------- Repetir em voz alta ---------------- */

/**
 * Abre o microfone ao montar. As palavras da frase acendem em verde conforme são reconhecidas;
 * quando a gravação termina, as que faltaram ficam em vermelho.
 */
export function RepeatPractice({ native, onDone }: { native: string; onDone: () => void }) {
  const [heard, setHeard] = useState('')
  const [tries, setTries] = useState(0)
  const [began, setBegan] = useState(false)
  const mic = useSpeechRecognition(setHeard)
  const matches = matchWords(native, heard)
  const all = matches.every((w) => w.ok)
  const score = Math.round(matchScore(matches) * 100)
  const startRef = useRef(mic.start)
  startRef.current = mic.start

  // abre o microfone a cada tentativa (a primeira começa sozinha, ao entrar no modo)
  useEffect(() => {
    setHeard('')
    // se o tutor estiver falando, o microfone captaria o alto-falante: corta a fala antes
    stopSpeaking()
    startRef.current()
    setBegan(true)
  }, [tries])

  // disse todas as palavras: encerra sem esperar o silêncio
  const stop = mic.stop
  useEffect(() => {
    if (all && heard && mic.listening) stop()
  }, [all, heard, mic.listening, stop])

  const finished = !mic.listening && !!heard

  return (
    <div className="space-y-2 animate-in">
      <p lang="en" className="text-[13.5px] leading-snug" aria-label={native}>
        “
        {matches.map((w, i) => (
          <span key={i}>
            {i > 0 && ' '}
            <span
              className={`rounded-[4px] transition-colors duration-300 ${
                w.ok ? 'text-emerald-700' : finished ? 'bg-rose-50 text-rose-600 underline decoration-rose-300 decoration-wavy underline-offset-4' : 'text-zinc-400'
              }`}
            >
              {w.word}
            </span>
          </span>
        ))}
        ”
      </p>

      <div aria-live="polite" className="text-xs leading-snug text-zinc-500">
        {mic.error ? (
          <span className="text-red-600">{mic.error}</span>
        ) : mic.listening || !began ? (
          <span className="flex items-center gap-1.5 font-medium text-red-500">
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" aria-hidden />
            {heard ? 'Ouvindo…' : 'Fale a frase em voz alta'}
          </span>
        ) : finished ? (
          all ? (
            <span className="font-medium text-emerald-700">Perfeito, todas as palavras saíram! 🎉</span>
          ) : (
            <span>
              {score}% das palavras · as em vermelho não foram entendidas. Ouça de novo e repita.
            </span>
          )
        ) : (
          'Nada foi ouvido. Tente de novo.'
        )}
        {heard && !mic.error && (
          <span className="mt-0.5 block">
            Entendi: <span lang="en" className="text-zinc-700">“{heard}”</span>
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {mic.listening ? (
          <button type="button" onClick={mic.stop} className={`${smallBtn} bg-red-500 text-white`}>
            <span className="h-2.5 w-2.5 rounded-[3px] bg-white" aria-hidden />
            Parar
          </button>
        ) : (
          <button type="button" onClick={() => setTries((t) => t + 1)} className={`${smallBtn} bg-blue-50 text-blue-600 hover:bg-blue-100`}>
            <MicIcon />
            Repetir de novo
          </button>
        )}
        <button type="button" onClick={onDone} className={`${smallBtn} text-zinc-500 hover:bg-zinc-100`}>
          Fechar
        </button>
      </div>
    </div>
  )
}

/* ---------------- Tentar de novo (escrita) ---------------- */

/**
 * A versão nativa fica escondida e o aluno reescreve a própria frase já corrigida. A resposta é
 * conferida no servidor, que aceita variações corretas (não precisa ser igual à versão nativa).
 */
export function RetryPractice({ said, native, onDone }: { said: string; native: string; onDone: () => void }) {
  const [text, setText] = useState('')
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<CheckResult | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true })
  }, [])

  async function submit(e: FormEvent) {
    e.preventDefault()
    const answer = text.trim()
    if (!answer || checking) return
    setChecking(true)
    setError(null)
    try {
      setResult(await checkRewrite(said, native, answer))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível conferir agora.')
    } finally {
      setChecking(false)
    }
  }

  function again() {
    setResult(null)
    setText('')
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  return (
    <div className="space-y-2 animate-in">
      <p className="text-xs leading-snug text-zinc-500">
        Sem olhar a correção, escreva de novo a sua frase do jeito certo:
      </p>
      <p lang="en" className="text-[13px] leading-snug text-zinc-400 line-through decoration-zinc-300">{said}</p>
      <form onSubmit={submit} className="flex items-center gap-1.5">
        <input
          ref={inputRef}
          lang="en"
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={checking || !!result}
          maxLength={500}
          autoCapitalize="sentences"
          autoComplete="off"
          spellCheck={false}
          aria-label="Sua frase corrigida"
          placeholder="Write it again…"
          className="min-h-10 min-w-0 flex-1 rounded-full bg-zinc-100 px-3.5 text-[15px] outline-none ring-1 ring-transparent transition-all duration-300 ease-out focus:bg-white focus:ring-zinc-300 disabled:text-zinc-500"
        />
        {!result && (
          <button
            type="submit"
            disabled={!text.trim() || checking}
            className="min-h-10 shrink-0 rounded-full bg-zinc-900 px-3.5 text-xs font-medium text-white transition-all duration-300 ease-out hover:bg-zinc-800 active:scale-95 disabled:opacity-30"
          >
            {checking ? 'Conferindo…' : 'Conferir'}
          </button>
        )}
      </form>
      {error && <p className="text-xs text-red-600" role="alert">{error}</p>}

      {result && (
        <div aria-live="polite" className={`space-y-1 rounded-xl p-2.5 text-xs leading-snug animate-in ${result.correct ? 'bg-emerald-50 text-emerald-900' : 'bg-amber-50 text-amber-900'}`}>
          <p className="font-semibold">{result.correct ? 'Isso aí! Agora ficou certo. ✓' : 'Ainda não.'}</p>
          {result.feedback && <p>{result.feedback}</p>}
          <p>
            Versão nativa: <span lang="en" className="font-medium">{native}</span>
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {result && !result.correct && (
          <button type="button" onClick={again} className={`${smallBtn} bg-blue-50 text-blue-600 hover:bg-blue-100`}>
            Tentar outra vez
          </button>
        )}
        <button type="button" onClick={onDone} className={`${smallBtn} text-zinc-500 hover:bg-zinc-100`}>
          {result ? 'Fechar' : 'Mostrar correção'}
        </button>
      </div>
    </div>
  )
}

export { MicIcon, smallBtn }
