import { useEffect, useId, useMemo, useState } from 'react'
import SegmentedControl from './SegmentedControl'
import { getSpeakingId, speak, stopSpeaking, ttsSupported, useIsSpeaking } from '../services/speech'
import { removeTerm, saveTerm, setLearned, useVocabulary, type VocabEntry } from '../services/vocabulary'

type Filter = 'all' | 'learning' | 'learned'

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '')

const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')

/** Frase de contexto com o termo em destaque. */
function Context({ text, term }: { text: string; term: string }) {
  const i = text.toLowerCase().indexOf(term.toLowerCase())
  if (i < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, i)}
      <strong className="font-semibold text-zinc-700">{text.slice(i, i + term.length)}</strong>
      {text.slice(i + term.length)}
    </>
  )
}

function SpeakButton({ text }: { text: string }) {
  const id = useId()
  const speaking = useIsSpeaking(id)
  useEffect(() => () => { if (getSpeakingId() === id) stopSpeaking() }, [id])
  return (
    <button
      type="button"
      onClick={() => (speaking ? stopSpeaking() : speak(id, text))}
      aria-label={speaking ? 'Parar' : `Ouvir ${text}`}
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors ${
        speaking ? 'bg-blue-50 text-blue-500' : 'text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600'
      }`}
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M11 5 6 9H3v6h3l5 4V5z" fill="currentColor" fillOpacity={0.12} />
        <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      </svg>
    </button>
  )
}

function WordCard({ entry, onToggle, onRemove }: { entry: VocabEntry; onToggle: () => void; onRemove: () => void }) {
  const { term, translation, base, context, date, learned } = entry
  return (
    <li className={`rounded-3xl bg-white p-4 shadow-sm ring-1 ring-zinc-900/5 transition-opacity duration-300 animate-in ${learned ? 'opacity-70' : ''}`}>
      <div className="flex items-start gap-1">
        <div className="min-w-0 flex-1">
          <p lang="en" className="break-words text-[17px] font-semibold leading-snug tracking-tight">
            {term}
            {base && <span className="ml-1.5 text-xs font-normal text-zinc-400">de {base}</span>}
          </p>
          <p lang="pt-BR" className="mt-0.5 text-[15px] leading-snug text-blue-600">{translation}</p>
        </div>
        {ttsSupported && <SpeakButton text={term} />}
      </div>

      {context && (
        <p lang="en" className="mt-2.5 border-l-2 border-zinc-200 pl-2.5 text-[13.5px] leading-snug text-zinc-500">
          <Context text={context} term={term} />
        </p>
      )}

      <div className="mt-3 flex items-center gap-1">
        <span className="text-[11px] text-zinc-400">{fmtDate(date)}</span>
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={learned}
          className={`ml-auto flex min-h-8 items-center gap-1 rounded-full px-2.5 text-xs font-medium transition-all duration-300 ease-out active:scale-95 ${
            learned ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/70' : 'text-zinc-500 hover:bg-zinc-100'
          }`}
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="m5 12 5 5L20 7" />
          </svg>
          {learned ? 'Aprendida' : 'Marcar como aprendida'}
        </button>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remover ${term}`}
          title="Remover"
          className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-500"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
          </svg>
        </button>
      </div>
    </li>
  )
}

export default function VocabularyList({ uid }: { uid: string | null }) {
  const { entries, error } = useVocabulary(uid)
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [removed, setRemoved] = useState<VocabEntry | null>(null)

  // "Desfazer" some depois de alguns segundos
  useEffect(() => {
    if (!removed) return
    const t = setTimeout(() => setRemoved(null), 5000)
    return () => clearTimeout(t)
  }, [removed])

  const all = entries ?? []
  const learnedCount = all.filter((e) => e.learned).length

  const visible = useMemo(() => {
    const q = normalize(search.trim())
    return all.filter(
      (e) =>
        (filter === 'all' || (filter === 'learned') === e.learned) &&
        (!q || normalize(e.term).includes(q) || normalize(e.translation).includes(q)),
    )
  }, [all, filter, search])

  const fail = (what: string) => (e: unknown) => {
    console.warn(`[vocabulary] falha ao ${what}`, e)
    alert('Não foi possível concluir. Tente novamente.')
  }

  function remove(e: VocabEntry) {
    setRemoved(e)
    removeTerm(uid, e.id).catch(fail('remover'))
  }

  function undo() {
    if (!removed) return
    saveTerm(uid, removed).catch(fail('restaurar'))
    setRemoved(null)
  }

  const toast = removed && (
    <div
      role="status"
      className="fixed inset-x-0 bottom-[calc(1.5rem+env(safe-area-inset-bottom))] z-20 mx-auto flex w-fit items-center gap-3 rounded-full bg-zinc-900/90 py-2 pl-4 pr-2 text-sm text-white shadow-lg backdrop-blur-md animate-in"
    >
      <span>
        “<span lang="en">{removed.term}</span>” removida
      </span>
      <button type="button" onClick={undo} className="min-h-8 rounded-full px-3 font-semibold text-blue-300 transition-colors hover:bg-white/10">
        Desfazer
      </button>
    </div>
  )

  if (entries === null) {
    return (
      <div className="flex justify-center pt-24" aria-live="polite">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-200 border-t-blue-500" />
        <span className="sr-only">Carregando…</span>
      </div>
    )
  }

  if (all.length === 0) {
    return (
      <div className="flex flex-col items-center px-6 pt-20 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-2xl shadow-sm ring-1 ring-zinc-900/5">📚</div>
        <p className="mt-4 text-[15px] font-semibold">Nenhuma palavra salva</p>
        <p className="mt-1 max-w-xs text-sm leading-relaxed text-zinc-500">
          {error ?? 'Toque em qualquer palavra nas mensagens do tutor (ou selecione um termo) para ver a tradução e salvá-la aqui.'}
        </p>
        {toast}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <SegmentedControl<Filter>
        label="Filtrar vocabulário"
        value={filter}
        onChange={setFilter}
        options={[
          { id: 'all', label: `Todas · ${all.length}` },
          { id: 'learning', label: `Aprendendo · ${all.length - learnedCount}` },
          { id: 'learned', label: `Aprendidas · ${learnedCount}` },
        ]}
      />

      <label className="relative block">
        <span className="sr-only">Buscar palavra</span>
        <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar em inglês ou português"
          className="min-h-11 w-full rounded-full bg-white pl-10 pr-4 text-[15px] shadow-sm ring-1 ring-zinc-900/5 outline-none transition-shadow placeholder:text-zinc-400 focus:ring-2 focus:ring-blue-500/40"
        />
      </label>

      {visible.length === 0 ? (
        <p className="py-10 text-center text-sm text-zinc-400">
          {search ? 'Nenhuma palavra encontrada.' : filter === 'learned' ? 'Nenhuma palavra aprendida ainda.' : 'Tudo aprendido! 🎉'}
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {visible.map((e) => (
            <WordCard
              key={e.id}
              entry={e}
              onToggle={() => setLearned(uid, e.id, !e.learned).catch(fail('atualizar'))}
              onRemove={() => remove(e)}
            />
          ))}
        </ul>
      )}

      {toast}
    </div>
  )
}
