import { useEffect, useId, useRef, useState } from 'react'
import { fmtInterval, MASTERED_BOX, nextIntervalDays, PRODUCE_FROM_BOX, schedule } from '../lib/srs'
import { getSpeakingId, speak, stopSpeaking, ttsSupported, useIsSpeaking, useSpeechRecognition } from '../services/speech'
import { dueWords, recordReview, useVocabulary, type VocabEntry } from '../services/vocabulary'
import { recordActivity } from '../services/habit'

interface Props {
  uid: string | null
  onClose: () => void
  /** sem palavras pendentes: leva o aluno a conversar e salvar palavras */
  onStartChat: () => void
}

/** máximo de palavras por sessão: revisões curtas e diárias fixam mais que uma maratona */
const SESSION_MAX = 20

const primaryBtn =
  'min-h-12 w-full rounded-2xl bg-zinc-900 px-4 text-[15px] font-medium text-white transition-all duration-300 ease-out hover:bg-zinc-800 active:scale-[0.98]'

const norm = (s: string) => s.toLowerCase().replace(/[’‘]/g, "'").replace(/[^\p{L}\p{N}' ]/gu, ' ').replace(/\s+/g, ' ').trim()

/** Revisão espaçada: um cartão por vez, o aluno lembra a resposta e diz se acertou. */
export default function ReviewPanel({ uid, onClose, onStartChat }: Props) {
  const { entries } = useVocabulary(uid)
  // fila congelada ao abrir: a lista em tempo real muda a cada resposta gravada
  const [queue, setQueue] = useState<VocabEntry[] | null>(null)
  const [pos, setPos] = useState(0)
  const [firstTry, setFirstTry] = useState({ right: 0, total: 0 })
  const missed = useRef(new Set<string>())

  useEffect(() => {
    if (queue === null && entries !== null) setQueue(dueWords(entries).slice(0, SESSION_MAX))
  }, [entries, queue])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
      stopSpeaking()
    }
  }, [onClose])

  function answer(entry: VocabEntry, correct: boolean) {
    const next = schedule(entry, correct)
    recordReview(uid, entry.id, next).catch((e) => console.warn('[review] falha ao gravar', e))
    recordActivity('vocab')
    if (!missed.current.has(entry.id)) {
      setFirstTry((s) => ({ right: s.right + (correct ? 1 : 0), total: s.total + 1 }))
    }
    if (!correct) {
      missed.current.add(entry.id)
      // errou: volta no fim da sessão, já na caixa 0
      setQueue((q) => (q ? [...q, { ...entry, ...next }] : q))
    }
    setPos((p) => p + 1)
  }

  const total = queue?.length ?? 0
  const current = queue && pos < total ? queue[pos] : null
  // palavras únicas da sessão (as repetidas por erro não contam de novo)
  const unique = queue ? new Set(queue.map((e) => e.id)).size : 0

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="review-title" className="fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-zinc-50 animate-in">
      <header className="sticky top-0 z-10 border-b border-zinc-900/5 bg-zinc-50/80 backdrop-blur-md pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex h-14 max-w-2xl items-center justify-between px-4">
          <div className="leading-tight">
            <h2 id="review-title" className="text-[17px] font-semibold tracking-tight">Revisão do vocabulário</h2>
            {current && (
              <p className="text-xs text-zinc-500" aria-live="polite">
                {Math.min(pos + 1, total)} de {total}
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
        {total > 0 && (
          <div className="h-0.5 bg-zinc-900/5" aria-hidden>
            <div className="h-full bg-blue-500 transition-[width] duration-500 ease-out" style={{ width: `${(Math.min(pos, total) / total) * 100}%` }} />
          </div>
        )}
      </header>

      <div className="mx-auto max-w-2xl space-y-3 px-4 pt-4 pb-[calc(2rem+env(safe-area-inset-bottom))]">
        {queue === null ? (
          <div className="flex justify-center pt-24" aria-live="polite">
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-200 border-t-blue-500" />
            <span className="sr-only">Carregando…</span>
          </div>
        ) : total === 0 ? (
          <div className="space-y-5 rounded-3xl bg-white p-6 text-center shadow-sm ring-1 ring-zinc-900/5">
            <div>
              <p className="text-3xl" aria-hidden>✅</p>
              <p className="mt-3 text-[15px] font-semibold">Nada para revisar agora</p>
              <p className="mx-auto mt-1 max-w-xs text-sm leading-relaxed text-zinc-500">
                {(entries?.length ?? 0) === 0
                  ? 'Toque nas palavras das mensagens do tutor e salve as que quiser aprender. Elas aparecem aqui para revisar.'
                  : 'Suas palavras voltam aqui no dia certo de revisar. Enquanto isso, converse e salve palavras novas.'}
              </p>
            </div>
            <button type="button" className={primaryBtn} onClick={onStartChat}>
              Conversar com o tutor
            </button>
          </div>
        ) : current ? (
          <Flashcard key={`${pos}-${current.id}`} entry={current} onAnswer={(ok) => answer(current, ok)} />
        ) : (
          <div className="space-y-5 rounded-3xl bg-white p-6 text-center shadow-sm ring-1 ring-zinc-900/5 animate-in">
            <div>
              <p className="text-4xl font-semibold tracking-tight tabular-nums">
                {firstTry.right}/{unique}
              </p>
              <p className="mt-1 text-sm text-zinc-500">de primeira · revisão de hoje concluída 🎉</p>
              <p className="mx-auto mt-3 max-w-xs text-sm leading-relaxed text-zinc-500">
                Cada palavra volta no dia certo: quanto mais você acerta, mais tempo ela demora para voltar.
              </p>
            </div>
            <button type="button" className={primaryBtn} onClick={onClose}>
              Concluir
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/* ---------------- Cartão ---------------- */

function ListenButton({ text, autoPlay }: { text: string; autoPlay?: boolean }) {
  const id = useId()
  const speaking = useIsSpeaking(id)
  useEffect(() => {
    if (autoPlay) speak(id, text)
    return () => { if (getSpeakingId() === id) stopSpeaking() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])
  if (!ttsSupported) return null
  return (
    <button
      type="button"
      onClick={() => (speaking ? stopSpeaking() : speak(id, text))}
      aria-label={speaking ? 'Parar' : `Ouvir ${text}`}
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-all duration-300 ease-out active:scale-90 ${
        speaking ? 'bg-blue-50 text-blue-500' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200'
      }`}
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M11 5 6 9H3v6h3l5 4V5z" fill="currentColor" fillOpacity={0.12} />
        <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
      </svg>
    </button>
  )
}

/** Frase de contexto com o termo destacado, ou trocado por uma lacuna. */
function Context({ text, term, blank }: { text: string; term: string; blank?: boolean }) {
  const i = text.toLowerCase().indexOf(term.toLowerCase())
  if (i < 0) return blank ? null : <p lang="en" className="text-[15px] leading-snug text-zinc-500">{text}</p>
  return (
    <p lang="en" className="text-[15px] leading-snug text-zinc-500">
      {text.slice(0, i)}
      {blank ? (
        <span className="mx-0.5 inline-block w-16 border-b-2 border-zinc-300 align-baseline" aria-label="lacuna" />
      ) : (
        <strong className="font-semibold text-zinc-800">{text.slice(i, i + term.length)}</strong>
      )}
      {text.slice(i + term.length)}
    </p>
  )
}

/** Microfone para dizer a palavra: mostra o que foi entendido e se bate com a resposta. */
function SayIt({ term }: { term: string }) {
  const [heard, setHeard] = useState('')
  const mic = useSpeechRecognition(setHeard)
  if (!mic.supported) return null
  const hit = heard && ` ${norm(heard)} `.includes(` ${norm(term)} `)
  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => (mic.listening ? mic.stop() : (setHeard(''), mic.start()))}
        aria-pressed={mic.listening}
        className={`flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl text-[15px] font-medium transition-all duration-300 ease-out active:scale-[0.98] ${
          mic.listening ? 'bg-red-500 text-white' : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'
        }`}
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
        </svg>
        {mic.listening ? 'Ouvindo… toque para parar' : 'Dizer em voz alta'}
      </button>
      {mic.error && <p className="text-center text-sm text-red-600">{mic.error}</p>}
      {heard && (
        <p className="text-center text-sm" aria-live="polite">
          <span className="text-zinc-500">Entendi: </span>
          <span lang="en" className="font-medium text-zinc-800">“{heard}”</span>
          {hit && <span className="ml-1 text-emerald-600"> ✓</span>}
        </p>
      )}
    </div>
  )
}

function Flashcard({ entry, onAnswer }: { entry: VocabEntry; onAnswer: (correct: boolean) => void }) {
  const [revealed, setRevealed] = useState(false)
  // caixas iniciais: reconhecer (inglês → português); depois: produzir (português → inglês, falando)
  const produce = entry.box >= PRODUCE_FROM_BOX
  const days = nextIntervalDays(entry)

  return (
    <div className="space-y-5 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-zinc-900/5 animate-in">
      <span className="inline-block rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-blue-600">
        {produce ? 'Como se diz em inglês?' : 'O que significa?'}
      </span>

      {produce ? (
        <div className="space-y-3">
          <p lang="pt-BR" className="text-[26px] font-semibold leading-tight tracking-tight">{entry.translation}</p>
          {entry.context && <Context text={entry.context} term={entry.term} blank={!revealed} />}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p lang="en" className="min-w-0 break-words text-[26px] font-semibold leading-tight tracking-tight">{entry.term}</p>
            <ListenButton text={entry.term} autoPlay />
          </div>
          {entry.context && <Context text={entry.context} term={entry.term} />}
        </div>
      )}

      {!revealed ? (
        <div className="space-y-2">
          {produce && <SayIt term={entry.term} />}
          <button type="button" className={primaryBtn} onClick={() => setRevealed(true)}>
            Mostrar resposta
          </button>
        </div>
      ) : (
        <div className="space-y-4 animate-in">
          <div className="flex items-center justify-between gap-3 rounded-2xl bg-zinc-50 p-4 ring-1 ring-zinc-900/5">
            <div className="min-w-0">
              {produce ? (
                <p lang="en" className="break-words text-xl font-semibold tracking-tight">{entry.term}</p>
              ) : (
                <p lang="pt-BR" className="text-xl font-semibold tracking-tight text-blue-600">{entry.translation}</p>
              )}
              {entry.base && <p className="mt-0.5 text-xs text-zinc-400">forma base: <span lang="en">{entry.base}</span></p>}
            </div>
            {produce && <ListenButton text={entry.term} autoPlay />}
          </div>
          <p className="text-center text-sm text-zinc-500">Você lembrou?</p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => onAnswer(false)}
              className="flex min-h-14 flex-col items-center justify-center rounded-2xl bg-rose-50 px-3 text-rose-700 ring-1 ring-rose-200/70 transition-all duration-300 ease-out hover:bg-rose-100 active:scale-[0.98]"
            >
              <span className="text-[15px] font-semibold">Não lembrei</span>
              <span className="text-xs text-rose-500">revisa de novo hoje</span>
            </button>
            <button
              type="button"
              onClick={() => onAnswer(true)}
              className="flex min-h-14 flex-col items-center justify-center rounded-2xl bg-emerald-50 px-3 text-emerald-700 ring-1 ring-emerald-200/70 transition-all duration-300 ease-out hover:bg-emerald-100 active:scale-[0.98]"
            >
              <span className="text-[15px] font-semibold">Lembrei</span>
              <span className="text-xs text-emerald-600">
                {entry.box + 1 >= MASTERED_BOX ? 'vira aprendida 🎓' : `volta ${fmtInterval(days)}`}
              </span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
