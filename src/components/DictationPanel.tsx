import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { matchScore, matchWords, type WordMatch } from '../lib/compare'
import { buildDictation, type DictationItem } from '../services/dictation'
import type { Goal } from '../services/scenarios'
import { getSpeakingId, SLOWEST_SPEECH_RATE, speak, stopSpeaking, ttsSupported, useIsSpeaking, useSpeechRate } from '../services/speech'
import { subscribeStats } from '../services/stats'
import { recordActivity } from '../services/habit'

interface Props {
  uid: string | null
  goal: Goal
  onClose: () => void
}

const primaryBtn =
  'min-h-12 w-full rounded-2xl bg-zinc-900 px-4 text-[15px] font-medium text-white transition-all duration-300 ease-out hover:bg-zinc-800 active:scale-[0.98] disabled:opacity-30 disabled:active:scale-100'

/** Ditado: ouvir uma frase, digitar o que entendeu e ver palavra a palavra o que faltou. */
export default function DictationPanel({ uid, goal, onClose }: Props) {
  const [items, setItems] = useState<DictationItem[] | null>(null)
  const [round, setRound] = useState(0)
  const [index, setIndex] = useState(0)
  const [scores, setScores] = useState<number[]>([])

  // monta a sessão com as correções do aluno (primeira leitura das estatísticas basta)
  useEffect(() => {
    let done = false
    const stop = subscribeStats(uid, (v) => {
      if (done) return
      done = true
      setItems(buildDictation(v.stats.corrections, goal))
      setIndex(0)
      setScores([])
    })
    return () => {
      done = true
      stop()
    }
  }, [uid, goal, round])

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

  const total = items?.length ?? 0
  const finished = items !== null && index >= total
  const avg = scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) : 0

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="dictation-title" className="fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-zinc-50 animate-in">
      <header className="sticky top-0 z-10 border-b border-zinc-900/5 bg-zinc-50/80 backdrop-blur-md pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex h-14 max-w-2xl items-center justify-between px-4">
          <div className="leading-tight">
            <h2 id="dictation-title" className="text-[17px] font-semibold tracking-tight">Ditado</h2>
            {items && !finished && (
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
        {total > 0 && (
          <div className="h-0.5 bg-zinc-900/5" aria-hidden>
            <div className="h-full bg-blue-500 transition-[width] duration-500 ease-out" style={{ width: `${(Math.min(index, total) / total) * 100}%` }} />
          </div>
        )}
      </header>

      <div className="mx-auto max-w-2xl space-y-3 px-4 pt-4 pb-[calc(2rem+env(safe-area-inset-bottom))]">
        {!ttsSupported ? (
          <p className="rounded-3xl bg-white p-6 text-center text-sm text-zinc-500 shadow-sm ring-1 ring-zinc-900/5">
            Este navegador não tem voz para ler as frases. Tente no Chrome, Edge ou Safari.
          </p>
        ) : items === null ? (
          <div className="flex justify-center pt-24" aria-live="polite">
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-200 border-t-blue-500" />
            <span className="sr-only">Carregando…</span>
          </div>
        ) : !finished ? (
          <DictationCard
            key={`${round}-${index}`}
            item={items[index]}
            last={index === total - 1}
            onNext={(score) => {
              setScores((s) => [...s, score])
              setIndex((i) => i + 1)
            }}
          />
        ) : (
          <div className="space-y-5 rounded-3xl bg-white p-6 text-center shadow-sm ring-1 ring-zinc-900/5 animate-in">
            <div>
              <p className="text-4xl font-semibold tracking-tight tabular-nums">{avg}%</p>
              <p className="mt-1 text-sm text-zinc-500">das palavras certas</p>
              <p className="mx-auto mt-3 max-w-xs text-sm leading-relaxed text-zinc-500">
                {avg >= 90
                  ? 'Ótimo ouvido! Experimente aumentar a velocidade da voz em Ajustes.'
                  : avg >= 60
                    ? 'Bom trabalho. Repetir o ditado todo dia acelera muito a escuta.'
                    : 'Normal no começo. Use "mais devagar" e ouça quantas vezes precisar.'}
              </p>
            </div>
            <div className="space-y-2">
              <button type="button" className={primaryBtn} onClick={() => setRound((r) => r + 1)}>
                Novo ditado
              </button>
              <button
                type="button"
                onClick={onClose}
                className="min-h-12 w-full rounded-2xl bg-zinc-100 px-4 text-[15px] font-medium text-zinc-700 transition-all duration-300 ease-out hover:bg-zinc-200 active:scale-[0.98]"
              >
                Voltar à conversa
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/* ---------------- Cartão ---------------- */

function PlayButton({ text, rate, label, primary, autoPlay }: { text: string; rate?: number; label: string; primary?: boolean; autoPlay?: boolean }) {
  const id = useId()
  const speaking = useIsSpeaking(id)
  useEffect(() => {
    if (autoPlay) speak(id, text, rate)
    return () => { if (getSpeakingId() === id) stopSpeaking() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])
  return (
    <button
      type="button"
      onClick={() => (speaking ? stopSpeaking() : speak(id, text, rate))}
      className={`flex min-h-12 flex-1 items-center justify-center gap-2 rounded-2xl px-3 text-[15px] font-medium transition-all duration-300 ease-out active:scale-[0.98] ${
        primary ? 'bg-blue-500 text-white hover:bg-blue-600' : 'bg-blue-50 text-blue-600 hover:bg-blue-100'
      }`}
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {speaking ? (
          <path d="M8 6v12M16 6v12" />
        ) : (
          <>
            <path d="M11 5 6 9H3v6h3l5 4V5z" fill="currentColor" fillOpacity={0.12} />
            <path d="M15.5 8.5a5 5 0 0 1 0 7" />
          </>
        )}
      </svg>
      {speaking ? 'Parar' : label}
    </button>
  )
}

function Words({ matches }: { matches: WordMatch[] }) {
  return (
    <p lang="en" className="text-[19px] font-medium leading-relaxed">
      {matches.map((w, i) => (
        <span key={i}>
          {i > 0 && ' '}
          <span className={w.ok ? 'text-emerald-700' : 'rounded-[4px] bg-rose-50 text-rose-600 underline decoration-rose-300 decoration-wavy underline-offset-4'}>
            {w.word}
          </span>
        </span>
      ))}
    </p>
  )
}

function DictationCard({ item, last, onNext }: { item: DictationItem; last: boolean; onNext: (score: number) => void }) {
  const rate = useSpeechRate()
  const [typed, setTyped] = useState('')
  const [result, setResult] = useState<WordMatch[] | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // "mais devagar" só faz sentido se a velocidade escolhida já não for a mínima
  const canSlow = rate > SLOWEST_SPEECH_RATE

  function check(e: FormEvent) {
    e.preventDefault()
    if (!typed.trim() || result) return
    setResult(matchWords(item.text, typed))
    recordActivity('listen')
  }

  const score = result ? matchScore(result) : 0
  const missed = result ? result.filter((w) => !w.ok).length : 0

  return (
    <div className="space-y-5 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-zinc-900/5 animate-in">
      <div className="space-y-1">
        <span className="inline-block rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-blue-600">
          {item.mine ? 'Frase das suas conversas' : 'Ouça e escreva'}
        </span>
        <p className="text-sm text-zinc-500">Ouça quantas vezes quiser e escreva exatamente o que ouviu.</p>
      </div>

      <div className="flex gap-2">
        <PlayButton text={item.text} label="Ouvir" primary autoPlay />
        {canSlow && <PlayButton text={item.text} rate={SLOWEST_SPEECH_RATE} label="Mais devagar" />}
      </div>

      <form onSubmit={check} className="space-y-2">
        <input
          ref={inputRef}
          lang="en"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          disabled={!!result}
          autoCapitalize="sentences"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="Write what you hear…"
          aria-label="O que você ouviu"
          className="min-h-12 w-full rounded-2xl bg-zinc-100 px-4 text-base outline-none ring-1 ring-transparent transition-all duration-300 ease-out focus:bg-white focus:ring-zinc-300 disabled:text-zinc-500"
        />
        {!result && (
          <button type="submit" disabled={!typed.trim()} className={primaryBtn}>
            Conferir
          </button>
        )}
      </form>

      {result && (
        <div className="space-y-4 animate-in" aria-live="polite">
          <div className={`space-y-2 rounded-2xl p-4 ${missed ? 'bg-amber-50' : 'bg-emerald-50'}`}>
            <p className={`text-sm font-semibold ${missed ? 'text-amber-900' : 'text-emerald-900'}`}>
              {missed === 0
                ? 'Perfeito! 🎉'
                : `${Math.round(score * 100)}% certo · ${missed} ${missed === 1 ? 'palavra' : 'palavras'} em vermelho`}
            </p>
            <Words matches={result} />
            {item.translation && <p lang="pt-BR" className="text-sm text-zinc-500">{item.translation}</p>}
          </div>
          <button type="button" className={primaryBtn} onClick={() => onNext(score)}>
            {last ? 'Ver resultado' : 'Próxima'}
          </button>
        </div>
      )}
    </div>
  )
}
