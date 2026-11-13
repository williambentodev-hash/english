import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { errorTagLabel, LEVELS, type ErrorTag, type Level, type WeakSpot } from '../services/groq'
import SegmentedControl from './SegmentedControl'
import VocabularyList from './VocabularyList'
import {
  countErrorTags,
  resetStats,
  sessionAverage,
  subscribeStats,
  type SessionStat,
  type Stats,
  type StatsView,
} from '../services/stats'

const CHART_SESSIONS = 12
const CORRECTIONS_PAGE = 15
const levelLabel = (l: Level) => LEVELS.find((x) => x.id === l)?.label ?? l

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '')

const fmtScore = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

function scoreLabel(avg: number) {
  if (avg >= 9) return 'Excelente'
  if (avg >= 8) return 'Muito bom'
  if (avg >= 5) return 'Quase lá'
  return 'Vamos ajustar'
}

/* ---------------- Cartões ---------------- */

function Card({ title, children, className = '' }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-3xl bg-white p-4 shadow-sm ring-1 ring-zinc-900/5 ${className}`}>
      <h3 className="text-[13px] font-medium text-zinc-500">{title}</h3>
      <div className="mt-1">{children}</div>
    </section>
  )
}

function StatTile({ title, value, sub }: { title: string; value: string; sub: string }) {
  return (
    <Card title={title}>
      <p className="text-[34px] font-semibold leading-none tracking-tight tabular-nums">{value}</p>
      <p className="mt-1.5 text-xs text-zinc-400">{sub}</p>
    </Card>
  )
}

/* ---------------- Gráfico de evolução ---------------- */

interface Point {
  s: SessionStat
  avg: number
}

function ScoreChart({ points }: { points: Point[] }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [active, setActive] = useState<number | null>(null)

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const H = 150
  const pad = { top: 12, right: 12, bottom: 22, left: 22 }
  const innerW = Math.max(0, width - pad.left - pad.right)
  const innerH = H - pad.top - pad.bottom
  const x = (i: number) => pad.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW)
  const y = (v: number) => pad.top + innerH - (v / 10) * innerH

  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.avg)}`).join(' ')
  const area = points.length > 1 ? `${line} L${x(points.length - 1)},${y(0)} L${x(0)},${y(0)} Z` : ''

  function onMove(clientX: number) {
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect || !points.length) return
    const rel = clientX - rect.left
    let best = 0
    points.forEach((_, i) => {
      if (Math.abs(x(i) - rel) < Math.abs(x(best) - rel)) best = i
    })
    setActive(best)
  }

  const a = active != null ? points[active] : null

  return (
    <div
      ref={wrapRef}
      className="relative touch-pan-y select-none"
      style={{ height: H }}
      onPointerMove={(e) => onMove(e.clientX)}
      onPointerDown={(e) => onMove(e.clientX)}
      onPointerLeave={() => setActive(null)}
    >
      {width > 0 && (
        <svg width={width} height={H} role="img" aria-label="Média de pontuação por conversa" className="block">
          <defs>
            <linearGradient id="score-area" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.14} />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
            </linearGradient>
          </defs>

          {[0, 5, 10].map((v) => (
            <g key={v}>
              <line x1={pad.left} x2={width - pad.right} y1={y(v)} y2={y(v)} stroke="#e4e4e7" strokeWidth={1} strokeDasharray={v ? '2 4' : undefined} />
              <text x={pad.left - 8} y={y(v)} dy="0.32em" textAnchor="end" className="fill-zinc-400 text-[10px] tabular-nums">
                {v}
              </text>
            </g>
          ))}

          {area && <path d={area} fill="url(#score-area)" />}
          {points.length > 1 && (
            <path d={line} fill="none" stroke="#3b82f6" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          )}

          {a && active != null && (
            <line x1={x(active)} x2={x(active)} y1={pad.top} y2={y(0)} stroke="#a1a1aa" strokeWidth={1} />
          )}

          {points.map((p, i) => (
            <circle
              key={p.s.id + p.s.level}
              cx={x(i)}
              cy={y(p.avg)}
              r={active === i ? 5.5 : 4}
              fill="#3b82f6"
              stroke="#fff"
              strokeWidth={2}
              className="transition-[r] duration-200"
            />
          ))}

          <text x={x(0)} y={H - 6} textAnchor={points.length > 1 ? 'start' : 'middle'} className="fill-zinc-400 text-[10px]">
            {fmtDate(points[0].s.date)}
          </text>
          {points.length > 1 && (
            <text x={x(points.length - 1)} y={H - 6} textAnchor="end" className="fill-zinc-400 text-[10px]">
              {fmtDate(points[points.length - 1].s.date)}
            </text>
          )}
        </svg>
      )}

      {a && active != null && (
        <div
          className="pointer-events-none absolute top-0 z-10 w-max -translate-x-1/2 rounded-xl bg-zinc-900/90 px-2.5 py-1.5 text-[11px] leading-tight text-white shadow-sm backdrop-blur-md"
          style={{ left: Math.min(Math.max(x(active), 60), width - 60) }}
        >
          <p className="font-semibold tabular-nums">{fmtScore(a.avg)} / 10</p>
          <p className="text-zinc-300">
            {fmtDate(a.s.date)} · {a.s.phrases} {a.s.phrases === 1 ? 'frase' : 'frases'} · {levelLabel(a.s.level)}
          </p>
        </div>
      )}

      {/* versão em tabela para leitores de tela */}
      <table className="sr-only">
        <caption>Média de pontuação nas últimas conversas</caption>
        <thead>
          <tr><th>Data</th><th>Nível</th><th>Frases</th><th>Média</th></tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.s.id + p.s.level}>
              <td>{fmtDate(p.s.date)}</td>
              <td>{levelLabel(p.s.level)}</td>
              <td>{p.s.phrases}</td>
              <td>{fmtScore(p.avg)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ---------------- Erros mais frequentes ---------------- */

/** Categorias de erro por frequência; tocar em uma filtra a lista de correções abaixo. */
function FrequentErrors({
  spots,
  active,
  onSelect,
}: {
  spots: WeakSpot[]
  active: ErrorTag | null
  onSelect: (tag: ErrorTag | null) => void
}) {
  const max = spots[0]?.count ?? 1
  return (
    <ul className="mt-2 space-y-1">
      {spots.map(({ tag, count }) => {
        const on = active === tag
        return (
          <li key={tag}>
            <button
              onClick={() => onSelect(on ? null : tag)}
              aria-pressed={on}
              title={on ? 'Mostrar todas as correções' : 'Ver as correções desta categoria'}
              className={`block min-h-11 w-full rounded-2xl px-2.5 py-2 text-left transition-all duration-300 ease-out active:scale-[0.99] ${
                on ? 'bg-blue-50' : 'hover:bg-zinc-50'
              }`}
            >
              <span className="flex items-baseline justify-between gap-3 text-[13.5px]">
                <span className={on ? 'font-medium text-blue-600' : 'text-zinc-700'}>{errorTagLabel(tag)}</span>
                <span className="text-xs text-zinc-400 tabular-nums">
                  {count} {count === 1 ? 'vez' : 'vezes'}
                </span>
              </span>
              <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-zinc-100" aria-hidden>
                <span className="block h-full rounded-full bg-blue-500" style={{ width: `${(count / max) * 100}%` }} />
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/* ---------------- Status da sincronização ---------------- */

function SyncStatus({ view, cloudUser }: { view: StatsView; cloudUser: boolean }) {
  const { source, pending } = view
  const waiting = pending > 0 ? ` · ${pending} ${pending === 1 ? 'frase aguardando' : 'frases aguardando'} envio` : ''
  const [dot, text] =
    !cloudUser
      ? ['bg-zinc-300', 'Salvo só neste aparelho' + waiting]
      : source === 'cloud'
        ? pending
          ? ['bg-amber-400', 'Sincronizando' + waiting]
          : ['bg-emerald-500', 'Sincronizado na nuvem · tempo real']
        : ['bg-amber-400', 'Offline · mostrando dados salvos neste aparelho' + waiting]
  return (
    <p className="flex items-center justify-center gap-1.5 text-[11px] text-zinc-400" aria-live="polite">
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden />
      {text}
    </p>
  )
}

/* ---------------- Painel ---------------- */

const NO_STATS: Stats = { sessions: [], corrections: [] }

export type DashboardTab = 'progress' | 'vocabulary'

const TABS = [
  { id: 'progress', label: 'Evolução' },
  { id: 'vocabulary', label: 'Vocabulário' },
] as const

interface DashboardProps {
  uid: string | null
  /** aba aberta ao entrar (Evolução ou Vocabulário) */
  initialTab?: DashboardTab
  onClose: () => void
}

export default function ProgressDashboard({ uid, initialTab = 'progress', onClose }: DashboardProps) {
  const [tab, setTab] = useState<DashboardTab>(initialTab)
  const [view, setView] = useState<StatsView | null>(null)
  const [busy, setBusy] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [tagFilter, setTagFilter] = useState<ErrorTag | null>(null)

  // tempo real: Firestore + fila offline + localStorage
  useEffect(() => {
    setView(null)
    return subscribeStats(uid, setView)
  }, [uid])
  const stats = view?.stats ?? null

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

  const data = stats ?? NO_STATS

  const { totalPhrases, overall, points } = useMemo(() => {
    const totalPhrases = data.sessions.reduce((n, s) => n + s.phrases, 0)
    const scored = data.sessions.reduce((n, s) => n + s.scored, 0)
    const sum = data.sessions.reduce((n, s) => n + s.scoreSum, 0)
    const points = data.sessions
      .map((s) => ({ s, avg: sessionAverage(s) }))
      .filter((p): p is Point => p.avg != null)
      .slice(-CHART_SESSIONS)
    return { totalPhrases, overall: scored ? sum / scored : null, points }
  }, [data])

  const conversations = new Set(data.sessions.map((s) => s.id)).size

  // erros por categoria; o filtro some sozinho se a categoria deixar de existir (ex.: histórico apagado)
  const spots = useMemo(() => countErrorTags(data.corrections), [data])
  const activeTag = tagFilter && spots.some((s) => s.tag === tagFilter) ? tagFilter : null
  const corrections = useMemo(
    () => (activeTag ? data.corrections.filter((c) => c.tags?.includes(activeTag)) : data.corrections),
    [data, activeTag],
  )

  // tendência: média das últimas 3 conversas vs. as 3 anteriores
  const trend = useMemo(() => {
    if (points.length < 4) return null
    const avg = (arr: Point[]) => arr.reduce((n, p) => n + p.avg, 0) / arr.length
    const recent = points.slice(-3)
    const before = points.slice(-6, -3)
    return avg(recent) - avg(before)
  }, [points])

  async function reset() {
    const where = uid ? 'da sua conta' : 'deste navegador'
    if (!confirm(`Apagar todo o histórico de evolução ${where}?`)) return
    setBusy(true)
    try {
      await resetStats(uid)
    } catch (e) {
      console.warn('[stats] falha ao apagar', e)
      alert('Não foi possível apagar o histórico. Tente novamente.')
    } finally {
      setBusy(false)
    }
  }

  const loading = stats === null
  const empty = data.sessions.length === 0

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="progress-title"
      className="fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-zinc-50 animate-in"
    >
      <header className="sticky top-0 z-10 border-b border-zinc-900/5 bg-zinc-50/80 backdrop-blur-md pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex h-14 max-w-2xl items-center justify-between px-4">
          <h2 id="progress-title" className="text-[17px] font-semibold tracking-tight">Seu progresso</h2>
          <button
            onClick={onClose}
            autoFocus
            className="min-h-11 rounded-full px-3 text-[15px] font-semibold text-blue-500 transition-all duration-300 ease-out hover:bg-zinc-100 active:scale-95"
          >
            OK
          </button>
        </div>
        <div className="mx-auto max-w-2xl px-4 pb-3">
          <SegmentedControl label="Seção" options={TABS} value={tab} onChange={setTab} />
        </div>
      </header>

      <div className="mx-auto max-w-2xl space-y-3 px-4 pt-4 pb-[calc(2rem+env(safe-area-inset-bottom))]">
        {tab === 'vocabulary' ? (
          <VocabularyList uid={uid} />
        ) : (
        <>
        {view && <SyncStatus view={view} cloudUser={!!uid} />}
        {loading ? (
          <div className="flex justify-center pt-24" aria-live="polite">
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-200 border-t-blue-500" />
            <span className="sr-only">Carregando…</span>
          </div>
        ) : empty ? (
          <div className="flex flex-col items-center px-6 pt-20 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-2xl shadow-sm ring-1 ring-zinc-900/5">📈</div>
            <p className="mt-4 text-[15px] font-semibold">Nenhuma frase ainda</p>
            <p className="mt-1 max-w-xs text-sm leading-relaxed text-zinc-500">
              Converse com o tutor e sua evolução aparece aqui: pontuação, frases praticadas e correções para revisar.
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <StatTile
                title="Frases praticadas"
                value={totalPhrases.toLocaleString('pt-BR')}
                sub={`em ${conversations} ${conversations === 1 ? 'conversa' : 'conversas'}`}
              />
              <StatTile
                title="Score geral"
                value={overall != null ? fmtScore(overall) : '–'}
                sub={overall != null ? `de 10 · ${scoreLabel(overall)}` : 'sem frases avaliadas'}
              />
            </div>

            {points.length > 0 && (
              <Card title="Evolução do score">
                <div className="flex items-baseline justify-between">
                  <p className="text-xs text-zinc-400">
                    Média por conversa · últimas {points.length}
                  </p>
                  {trend != null && Math.abs(trend) >= 0.1 && (
                    <p className="text-xs font-medium text-zinc-600 tabular-nums">
                      {trend > 0 ? '↑' : '↓'} {fmtScore(Math.abs(trend))} vs. anteriores
                    </p>
                  )}
                </div>
                <div className="mt-3">
                  <ScoreChart points={points} />
                </div>
              </Card>
            )}

            {data.corrections.length > 0 && (
              <Card title="Erros mais frequentes">
                {spots.length === 0 ? (
                  <p className="py-2 text-sm text-zinc-400">
                    As categorias aparecem a partir das suas próximas correções.
                  </p>
                ) : (
                  <>
                    <p className="text-xs text-zinc-400">
                      Nas suas correções recentes · toque para ver os exemplos
                    </p>
                    <FrequentErrors spots={spots} active={activeTag} onSelect={setTagFilter} />
                  </>
                )}
              </Card>
            )}

            <Card title={`Erros e correções${corrections.length ? ` · ${corrections.length}` : ''}`}>
              {activeTag && (
                <button
                  onClick={() => setTagFilter(null)}
                  className="mt-1 inline-flex min-h-8 items-center gap-1.5 rounded-full bg-blue-50 px-3 text-xs font-medium text-blue-600 transition-all duration-300 ease-out hover:bg-blue-100 active:scale-95"
                >
                  {errorTagLabel(activeTag)}
                  <span aria-hidden>✕</span>
                  <span className="sr-only">Remover filtro</span>
                </button>
              )}
              {corrections.length === 0 ? (
                <p className="py-2 text-sm text-zinc-400">Nenhuma correção ainda. Continue assim! 🎉</p>
              ) : (
                <ul className="-mx-1 mt-1 divide-y divide-zinc-900/5">
                  {(showAll ? corrections : corrections.slice(0, CORRECTIONS_PAGE)).map((c, i) => (
                    <li key={c.date + i} className="space-y-1.5 px-1 py-3">
                      <div className="flex items-center gap-2 text-[11px] text-zinc-400">
                        <span>{fmtDate(c.date)}</span>
                        <span aria-hidden>·</span>
                        <span>{levelLabel(c.level)}</span>
                        {c.score != null && (
                          <span className="ml-auto rounded-full bg-zinc-100 px-2 py-0.5 font-medium text-zinc-600 tabular-nums">
                            {c.score}/10
                          </span>
                        )}
                      </div>
                      <p className="text-[13.5px] text-zinc-400 line-through decoration-zinc-300">{c.said}</p>
                      <p className="text-[13.5px] leading-snug text-zinc-700">{c.correction}</p>
                      <p className="text-[13.5px] font-medium leading-snug text-blue-600">{c.native}</p>
                      {!!c.tags?.length && (
                        <p className="flex flex-wrap gap-1.5 pt-0.5">
                          {c.tags.map((t) => (
                            <span key={t} className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-500">
                              {errorTagLabel(t)}
                            </span>
                          ))}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {corrections.length > CORRECTIONS_PAGE && (
                <button
                  onClick={() => setShowAll((v) => !v)}
                  className="mt-1 block min-h-11 w-full rounded-2xl text-sm font-medium text-blue-500 transition-all duration-300 ease-out hover:bg-zinc-50 active:scale-[0.98]"
                >
                  {showAll ? 'Mostrar menos' : `Ver todas (${corrections.length})`}
                </button>
              )}
            </Card>

            <button
              onClick={reset}
              disabled={busy}
              className="mx-auto block min-h-11 rounded-full px-4 text-sm text-red-500 transition-all duration-300 ease-out hover:bg-red-50 active:scale-95 disabled:opacity-50"
            >
              {busy ? 'Apagando…' : 'Apagar histórico'}
            </button>
          </>
        )}
        </>
        )}
      </div>
    </div>
  )
}
