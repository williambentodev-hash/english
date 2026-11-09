import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { translateTerm, type TermTranslation } from '../services/groq'
import { getSpeakingId, speak, stopSpeaking, ttsSupported, useIsSpeaking } from '../services/speech'
import { MAX_TERM_WORDS, countWords, removeTerm, saveTerm, type VocabEntry } from '../services/vocabulary'

/** Termo escolhido pelo aluno numa mensagem do tutor. */
export interface TermSelection {
  term: string
  /** frase onde o termo apareceu */
  context: string
  /** posição na tela do termo tocado/selecionado */
  rect: DOMRect
  /** identifica o texto de origem (para destacar a palavra ativa) */
  source: string
  /** índice do termo no texto de origem; -1 quando veio de uma seleção livre */
  offset: number
}

interface Props {
  selection: TermSelection
  uid: string | null
  apiKey: string | null
  /** entrada já salva para este termo, se houver */
  saved: VocabEntry | undefined
  onClose: () => void
}

const WIDTH = 248
const GAP = 8
const MARGIN = 12

type State = { status: 'loading' } | { status: 'ok'; data: TermTranslation } | { status: 'error'; message: string }

export default function WordPopover({ selection, uid, apiKey, saved, onClose }: Props) {
  const { term, context, rect } = selection
  const ref = useRef<HTMLDivElement>(null)
  const speakId = useId()
  const speaking = useIsSpeaking(speakId)
  const tooLong = countWords(term) > MAX_TERM_WORDS
  const [state, setState] = useState<State>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const [saveError, setSaveError] = useState(false)

  // tradução: usa a salva, se houver; senão pergunta ao modelo (com cache em memória)
  useEffect(() => {
    if (tooLong) return
    if (saved) return setState({ status: 'ok', data: { translation: saved.translation, base: saved.base } })
    if (!apiKey) return setState({ status: 'error', message: 'Configure a API key para traduzir.' })
    let alive = true
    setState({ status: 'loading' })
    translateTerm(term, context, apiKey).then(
      (data) => alive && setState({ status: 'ok', data }),
      (e) => alive && setState({ status: 'error', message: e instanceof Error ? e.message : 'Falha ao traduzir.' }),
    )
    return () => { alive = false }
    // `saved` só importa na abertura: salvar não deve refazer a tradução
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term, context, apiKey, attempt, tooLong])

  // posiciona abaixo do termo (ou acima, se não couber) sem sair da tela
  useLayoutEffect(() => {
    const h = ref.current?.offsetHeight ?? 0
    const vw = window.innerWidth
    const vh = window.innerHeight
    const left = Math.min(Math.max(rect.left + rect.width / 2 - WIDTH / 2, MARGIN), vw - WIDTH - MARGIN)
    const below = rect.bottom + GAP
    const top = below + h + MARGIN > vh && rect.top - GAP - h > MARGIN ? rect.top - GAP - h : below
    setPos({ top, left })
  }, [rect, state])

  // fecha com Esc, toque fora, rolagem ou redimensionamento
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const close = () => onClose()
    window.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown, true)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [onClose])

  // para a pronúncia ao fechar
  useEffect(() => () => { if (getSpeakingId() === speakId) stopSpeaking() }, [speakId])

  function save() {
    if (state.status !== 'ok') return
    setSaveError(false)
    // offline o Firestore enfileira a escrita; o estado "salvo" vem da lista em tempo real
    saveTerm(uid, { term, context, ...state.data }).catch((e) => {
      console.warn('[vocabulary] falha ao salvar', e)
      setSaveError(true)
    })
  }

  function unsave() {
    if (!saved) return
    removeTerm(uid, saved.id).catch((e) => console.warn('[vocabulary] falha ao remover', e))
  }

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={`Tradução de ${term}`}
      className="fixed z-40 rounded-2xl bg-white/95 p-3 shadow-lg ring-1 ring-zinc-900/10 backdrop-blur-md animate-in"
      style={{ width: WIDTH, top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
    >
      <div className="flex items-start gap-1">
        <div className="min-w-0 flex-1">
          <p lang="en" className="break-words text-[15px] font-semibold leading-snug tracking-tight">{term}</p>
          {state.status === 'ok' && state.data.base && (
            <p className="text-[11px] text-zinc-400">
              de <span lang="en" className="font-medium text-zinc-500">{state.data.base}</span>
            </p>
          )}
        </div>
        {ttsSupported && !tooLong && (
          <button
            type="button"
            onClick={() => (speaking ? stopSpeaking() : speak(speakId, term))}
            aria-label={speaking ? 'Parar' : `Ouvir ${term}`}
            className={`-mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors ${
              speaking ? 'bg-blue-50 text-blue-500' : 'text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600'
            }`}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M11 5 6 9H3v6h3l5 4V5z" fill="currentColor" fillOpacity={0.12} />
              <path d="M15.5 8.5a5 5 0 0 1 0 7" />
            </svg>
          </button>
        )}
      </div>

      <div className="mt-1.5 min-h-6 text-[14px] leading-snug" aria-live="polite">
        {tooLong ? (
          <p className="text-zinc-500">Selecione até {MAX_TERM_WORDS} palavras para salvar um termo.</p>
        ) : state.status === 'loading' ? (
          <span className="block h-4 w-28 animate-pulse rounded-full bg-zinc-200/80" aria-label="Traduzindo…" />
        ) : state.status === 'error' ? (
          <p className="text-red-500">
            {state.message}{' '}
            {apiKey && (
              <button type="button" onClick={() => setAttempt((n) => n + 1)} className="font-medium text-blue-500 hover:text-blue-600">
                Tentar de novo
              </button>
            )}
          </p>
        ) : (
          <p lang="pt-BR" className="text-zinc-700">{state.data.translation}</p>
        )}
      </div>

      {!tooLong &&
        (saved ? (
          <div className="mt-2.5 flex items-center justify-between gap-2">
            <span className="flex items-center gap-1 text-[13px] font-medium text-emerald-600">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="m5 12 5 5L20 7" />
              </svg>
              Salvo no Vocabulário
            </span>
            <button type="button" onClick={unsave} className="min-h-8 rounded-full px-2 text-[13px] text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600">
              Remover
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={save}
            disabled={state.status !== 'ok'}
            className="mt-2.5 flex min-h-9 w-full items-center justify-center gap-1.5 rounded-full bg-blue-500 text-[13px] font-semibold text-white transition-all duration-300 ease-out hover:bg-blue-600 active:scale-[0.98] disabled:opacity-40"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M6 3h12v18l-6-4-6 4z" />
            </svg>
            Salvar no Vocabulário
          </button>
        ))}
      {saveError && <p className="mt-1.5 text-center text-xs text-red-500">Não foi possível salvar. Tente de novo.</p>}
    </div>
  )
}
