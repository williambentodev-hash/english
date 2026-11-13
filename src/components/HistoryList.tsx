import { useMemo, useState } from 'react'
import { LEVELS } from '../services/tutor'
import type { ChatSummary } from '../services/history'

interface Props {
  chats: ChatSummary[] | null
  error: string | null
  /** conversa aberta na tela principal */
  currentId: string
  /** id da conversa sendo carregada */
  loadingId: string | null
  onSelect: (id: string) => void
  onDelete: (id: string) => Promise<void>
}

const DAY = 86_400_000
const levelLabel = (id: string) => LEVELS.find((l) => l.id === id)?.label ?? id

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

/** Grupos no estilo do app Notas: Hoje, Ontem, 7 dias, 30 dias e depois por mês. */
function groupLabel(iso: string, today: number) {
  const day = startOfDay(new Date(iso))
  const diff = Math.round((today - day) / DAY)
  if (diff <= 0) return 'Hoje'
  if (diff === 1) return 'Ontem'
  if (diff < 7) return 'Últimos 7 dias'
  if (diff < 30) return 'Últimos 30 dias'
  const d = new Date(iso)
  const label = d.toLocaleDateString('pt-BR', {
    month: 'long',
    ...(d.getFullYear() !== new Date(today).getFullYear() ? { year: 'numeric' } : {}),
  })
  return label[0].toUpperCase() + label.slice(1)
}

function when(iso: string, today: number) {
  const d = new Date(iso)
  const diff = Math.round((today - startOfDay(d)) / DAY)
  if (diff <= 0) return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  if (diff < 7) return d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '')
}

const fallbackTitle = (c: ChatSummary) =>
  `Conversa de ${new Date(c.createdAt).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' })}`

const normalize = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** Busca + conversas anteriores agrupadas por data (conteúdo da seção "Histórico" da sidebar). */
export default function HistoryList({ chats, error, currentId, loadingId, onSelect, onDelete }: Props) {
  const [search, setSearch] = useState('')
  const [confirming, setConfirming] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  const groups = useMemo(() => {
    const today = startOfDay(new Date())
    const q = normalize(search.trim())
    const list = (chats ?? []).filter((c) => !q || normalize(c.title ?? fallbackTitle(c)).includes(q))
    const out: { label: string; items: ChatSummary[] }[] = []
    for (const c of list) {
      const label = groupLabel(c.updatedAt, today)
      const g = out[out.length - 1]
      if (g?.label === label) g.items.push(c)
      else out.push({ label, items: [c] })
    }
    return { today, out, total: list.length }
  }, [chats, search])

  async function remove(id: string) {
    setDeleting(id)
    try {
      await onDelete(id)
    } finally {
      setDeleting(null)
      setConfirming(null)
    }
  }

  return (
    <>
      <div className="sticky top-0 z-10 bg-zinc-50/90 px-3 pb-1 backdrop-blur-xl">
        <label className="flex h-9 items-center gap-2 rounded-xl bg-zinc-900/5 px-3 text-zinc-400 focus-within:ring-2 focus-within:ring-blue-500/40">
          <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar"
            aria-label="Buscar conversas"
            className="min-w-0 flex-1 bg-transparent text-[15px] text-zinc-900 outline-none placeholder:text-zinc-400"
          />
        </label>
      </div>

      <nav className="px-3 pb-3" aria-label="Conversas anteriores">
        {error && <p className="mx-1 mt-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}

        {chats === null ? (
          <div className="space-y-2 pt-2" aria-label="Carregando">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded-xl bg-zinc-900/5" />
            ))}
          </div>
        ) : groups.total === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-sm font-medium text-zinc-700">{search ? 'Nenhum resultado' : 'Nenhuma conversa ainda'}</p>
            <p className="mt-1 text-xs leading-relaxed text-zinc-500">
              {search ? 'Tente outra palavra.' : 'Suas conversas aparecem aqui depois da primeira frase.'}
            </p>
          </div>
        ) : (
          groups.out.map((g) => (
            <section key={g.label} className="pt-2.5">
              <h4 className="px-3 pb-1 text-[11px] font-medium text-zinc-400">{g.label}</h4>
              <ul className="space-y-0.5">
                {g.items.map((c) => {
                  const active = c.id === currentId
                  const isConfirming = confirming === c.id
                  return (
                    <li key={c.id} className="group relative">
                      <button
                        type="button"
                        onClick={() => onSelect(c.id)}
                        disabled={loadingId !== null}
                        aria-current={active ? 'true' : undefined}
                        className={`flex min-h-12 w-full flex-col justify-center rounded-xl py-1.5 pl-3 pr-11 text-left transition-all duration-200 ease-out active:scale-[0.98] disabled:cursor-wait ${
                          active ? 'bg-blue-500/10' : 'hover:bg-zinc-900/5'
                        }`}
                      >
                        <span className={`truncate text-sm ${active ? 'font-semibold text-blue-600' : 'font-medium text-zinc-800'}`}>
                          {c.title ?? fallbackTitle(c)}
                        </span>
                        <span className="mt-0.5 truncate text-[11px] text-zinc-500">
                          {when(c.updatedAt, groups.today)} · {c.count} {c.count === 1 ? 'frase' : 'frases'} · {levelLabel(c.level)}
                        </span>
                      </button>

                      <div className="absolute inset-y-0 right-1 flex items-center">
                        {loadingId === c.id ? (
                          <span className="mr-2.5 h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-blue-500" aria-label="Carregando" />
                        ) : isConfirming ? (
                          <button
                            type="button"
                            onClick={() => remove(c.id)}
                            onBlur={() => deleting !== c.id && setConfirming(null)}
                            autoFocus
                            disabled={deleting === c.id}
                            className="min-h-8 rounded-full bg-red-500 px-3 text-xs font-medium text-white transition-all duration-200 ease-out active:scale-95 disabled:opacity-60 animate-in"
                          >
                            {deleting === c.id ? 'Apagando…' : 'Apagar'}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirming(c.id)}
                            aria-label={`Apagar "${c.title ?? fallbackTitle(c)}"`}
                            className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-400 transition-all duration-200 ease-out hover:bg-zinc-900/5 hover:text-red-500 focus-visible:opacity-100 active:scale-95 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"
                          >
                            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                              <path d="M3 6h18" />
                              <path d="M8 6V4h8v2" />
                              <path d="M19 6l-1 14H6L5 6" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))
        )}
      </nav>
    </>
  )
}
