import { useEffect, useRef, useState, type ReactNode, type TouchEvent } from 'react'
import type { User } from 'firebase/auth'
import HistoryList from './HistoryList'
import type { DashboardTab } from './ProgressDashboard'
import type { ChatSummary } from '../services/history'

/** Curva de animação no estilo iOS, compartilhada com o deslocamento do conteúdo no App. */
export const SIDEBAR_EASE = 'ease-[cubic-bezier(0.32,0.72,0,1)]'

interface Props {
  /** true: coluna fixa ao lado do chat (≥ lg); false: gaveta sobre o chat (celular/tablet) */
  desktop: boolean
  /** desktop: expandida; celular: gaveta aberta */
  open: boolean
  onClose: () => void
  /* histórico */
  chats: ChatSummary[] | null
  historyError: string | null
  currentId: string
  loadingId: string | null
  onSelectChat: (id: string) => void
  onDeleteChat: (id: string) => Promise<void>
  onNew: () => void
  /* progresso */
  onOpenProgress: (tab: DashboardTab) => void
  onOpenExercises: () => void
  /* rodapé */
  cloud: boolean
  authReady: boolean
  user: User | null
  onOpenAccount: () => void
  onOpenSettings: () => void
}

const Icon = ({ children, className = 'h-5 w-5' }: { children: ReactNode; className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
)

export const SidebarIcon = () => (
  <Icon>
    <rect x="3" y="4" width="18" height="16" rx="3" />
    <path d="M9 4v16" />
  </Icon>
)

export const ComposeIcon = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </Icon>
)

const SectionTitle = ({ id, children }: { id: string; children: ReactNode }) => (
  <h3 id={id} className="px-4 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
    {children}
  </h3>
)

function NavRow({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-sm font-medium text-zinc-700 transition-all duration-200 ease-out hover:bg-zinc-900/5 active:scale-[0.98]"
    >
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white text-zinc-500 shadow-sm ring-1 ring-zinc-900/5">{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      <span className="text-zinc-300" aria-hidden>›</span>
    </button>
  )
}

/** Nome/descrição da conta mostrados no rodapé. */
function accountInfo(cloud: boolean, ready: boolean, user: User | null) {
  if (!cloud) return { name: 'Modo local', sub: 'Dados salvos neste navegador', initial: null, clickable: false }
  if (!ready) return { name: 'Conectando…', sub: 'Aguarde um instante', initial: null, clickable: false }
  if (!user) return { name: 'Não conectado', sub: 'Toque para entrar', initial: null, clickable: true }
  if (user.isAnonymous) return { name: 'Convidado', sub: 'Crie uma conta para sincronizar', initial: null, clickable: true }
  const name = user.displayName || user.email || 'Minha conta'
  return { name, sub: user.displayName ? user.email ?? 'Sincronizado' : 'Sincronizado', initial: name[0].toUpperCase(), clickable: true }
}

/**
 * Menu lateral: nova conversa, histórico, progresso e conta/ajustes.
 * Desktop: coluna recolhível ao lado do chat. Celular: gaveta deslizante com fundo esmaecido
 * (Esc, toque fora ou arrastar para a esquerda fecham).
 */
export default function Sidebar(props: Props) {
  const { desktop, open, onClose, cloud, authReady, user } = props
  const drawer = !desktop
  const [dragX, setDragX] = useState(0)
  const touch = useRef<{ x: number; y: number; horizontal: boolean | null } | null>(null)
  const panelRef = useRef<HTMLElement>(null)

  // gaveta (celular): foco, Esc e trava da rolagem do chat por trás
  useEffect(() => {
    if (!drawer || !open) {
      setDragX(0)
      return
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    panelRef.current?.focus({ preventScroll: true })
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [drawer, open, onClose])

  const onTouchStart = (e: TouchEvent) => {
    if (!drawer) return
    const t = e.touches[0]
    touch.current = { x: t.clientX, y: t.clientY, horizontal: null }
  }
  const onTouchMove = (e: TouchEvent) => {
    const s = touch.current
    if (!s) return
    const t = e.touches[0]
    const dx = t.clientX - s.x
    const dy = t.clientY - s.y
    if (s.horizontal === null && Math.abs(dx) + Math.abs(dy) > 8) s.horizontal = Math.abs(dx) > Math.abs(dy)
    if (s.horizontal) setDragX(Math.min(0, dx))
  }
  const onTouchEnd = () => {
    if (dragX < -70) onClose()
    setDragX(0)
    touch.current = null
  }

  const account = accountInfo(cloud, authReady, user)

  return (
    <>
      {drawer && (
        <div
          aria-hidden
          onClick={onClose}
          className={`fixed inset-0 z-50 bg-zinc-900/25 backdrop-blur-[2px] transition-opacity duration-300 ease-out ${
            open ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
        />
      )}

      <aside
        ref={panelRef}
        aria-label="Menu"
        {...(drawer && open ? { role: 'dialog', 'aria-modal': true } : {})}
        aria-hidden={!open}
        inert={!open}
        tabIndex={-1}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={dragX ? { transform: `translateX(${dragX}px)`, transition: 'none' } : undefined}
        className={`fixed inset-y-0 left-0 flex flex-col bg-zinc-50/95 outline-none backdrop-blur-xl transition-transform duration-300 ${SIDEBAR_EASE} pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] ${
          drawer ? 'z-50 w-[min(20rem,86vw)] shadow-2xl' : 'z-30 w-72 border-r border-zinc-900/5'
        } ${open ? 'translate-x-0' : '-translate-x-full'}`}
      >
        {/* topo: marca + recolher */}
        <div className="flex h-14 shrink-0 items-center justify-between pl-4 pr-2">
          <span className="text-[15px] font-semibold tracking-tight text-zinc-900">English Tutor</span>
          <button
            type="button"
            onClick={onClose}
            aria-label={drawer ? 'Fechar menu' : 'Recolher menu'}
            title={drawer ? 'Fechar menu' : 'Recolher menu'}
            className="flex h-11 w-11 items-center justify-center rounded-full text-zinc-500 transition-all duration-300 ease-out hover:bg-zinc-900/5 active:scale-95"
          >
            <SidebarIcon />
          </button>
        </div>

        {/* destaque: nova conversa */}
        <div className="shrink-0 px-3 pb-3">
          <button
            type="button"
            onClick={props.onNew}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl bg-blue-500 px-4 text-sm font-semibold text-white shadow-sm shadow-blue-500/25 transition-all duration-300 ease-out hover:bg-blue-600 active:scale-[0.98]"
          >
            <ComposeIcon className="h-[18px] w-[18px]" />
            Nova conversa
          </button>
        </div>

        {/* histórico (rolável) */}
        <section aria-labelledby="sb-history" className="flex min-h-0 flex-1 flex-col">
          <SectionTitle id="sb-history">Histórico</SectionTitle>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <HistoryList
              chats={props.chats}
              error={props.historyError}
              currentId={props.currentId}
              loadingId={props.loadingId}
              onSelect={props.onSelectChat}
              onDelete={props.onDeleteChat}
            />
          </div>
        </section>

        {/* progresso */}
        <section aria-labelledby="sb-progress" className="shrink-0 border-t border-zinc-900/5 pt-3 pb-2">
          <SectionTitle id="sb-progress">Progresso</SectionTitle>
          <div className="space-y-0.5 px-2">
            <NavRow
              label="Exercícios para você"
              onClick={props.onOpenExercises}
              icon={
                <Icon className="h-4 w-4">
                  <path d="M9 11l3 3 8-8" />
                  <path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9" />
                </Icon>
              }
            />
            <NavRow
              label="Evolução"
              onClick={() => props.onOpenProgress('progress')}
              icon={
                <Icon className="h-4 w-4">
                  <path d="M3 3v18h18" />
                  <path d="m7 15 4-4 3 3 5-6" />
                </Icon>
              }
            />
            <NavRow
              label="Vocabulário salvo"
              onClick={() => props.onOpenProgress('vocabulary')}
              icon={
                <Icon className="h-4 w-4">
                  <path d="M19 21 12 16l-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                </Icon>
              }
            />
          </div>
        </section>

        {/* rodapé: conta + ajustes */}
        <footer className="flex shrink-0 items-center gap-1 border-t border-zinc-900/5 p-2">
          <button
            type="button"
            onClick={props.onOpenAccount}
            disabled={!account.clickable}
            aria-label={`Conta: ${account.name}`}
            className="flex min-h-12 min-w-0 flex-1 items-center gap-2.5 rounded-xl px-2 text-left transition-all duration-200 ease-out enabled:hover:bg-zinc-900/5 enabled:active:scale-[0.98] disabled:cursor-default"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-zinc-200 to-zinc-300 text-sm font-semibold text-zinc-600">
              {account.initial ?? (
                <Icon className="h-[18px] w-[18px]">
                  <circle cx="12" cy="8" r="4" />
                  <path d="M4 21a8 8 0 0 1 16 0" />
                </Icon>
              )}
            </span>
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-sm font-medium text-zinc-900">{account.name}</span>
              <span className="block truncate text-[11px] text-zinc-500">{account.sub}</span>
            </span>
          </button>
          <button
            type="button"
            onClick={props.onOpenSettings}
            aria-label="Ajustes"
            title="Ajustes"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-zinc-500 transition-all duration-300 ease-out hover:bg-zinc-900/5 active:scale-95"
          >
            <Icon>
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </Icon>
          </button>
        </footer>
      </aside>
    </>
  )
}
