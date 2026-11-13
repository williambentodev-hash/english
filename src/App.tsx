import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import ApiKeyModal from './components/ApiKeyModal'
import AuthModal from './components/AuthModal'
import ChatInput from './components/ChatInput'
import Sidebar, { ComposeIcon, SIDEBAR_EASE, SidebarIcon } from './components/Sidebar'
import SettingsModal from './components/SettingsModal'
import MessageBubble, { TypingIndicator } from './components/MessageBubble'
import ProgressDashboard, { type DashboardTab } from './components/ProgressDashboard'
import WordPopover, { type TermSelection } from './components/WordPopover'
import { getApiKey, isLevel, sendMessage, setApiKey, type ChatMessage, type Level } from './services/groq'
import { isBoolean, useMediaQuery, usePersistentState } from './services/prefs'
import { ttsSupported, useSpeechRate } from './services/speech'
import { useAuth } from './services/auth'
import { useProfileSync } from './services/profileSync'
import { newSessionId, recordPhrase, usePendingSync, useWeakSpots } from './services/stats'
import { chatTitle, deleteChat, endChat, loadChat, useChatHistory, type ChatTurn } from './services/history'
import { termId, useVocabulary } from './services/vocabulary'

const GREETING_TEXT = "Hi there! 👋 I'm your English tutor. How was your day today?"
const GREETING_TRANSLATION = 'Olá! 👋 Eu sou seu professor de inglês. Como foi o seu dia hoje?'

// botão de ícone do header: alvo de toque de 44px, sem quebra de linha
const iconBtn =
  'flex h-11 w-11 shrink-0 items-center justify-center whitespace-nowrap rounded-full transition-all duration-300 ease-out hover:bg-zinc-100 active:scale-95'

const greeting = (blind: boolean): ChatMessage => ({
  role: 'assistant',
  content: GREETING_TEXT,
  translation: GREETING_TRANSLATION,
  hidden: blind,
})

/** Mensagens da tela a partir do histórico salvo (texto sempre visível). */
const fromTurns = (turns: ChatTurn[]): ChatMessage[] => [
  greeting(false),
  ...turns.flatMap((t): ChatMessage[] => [
    { role: 'user', content: t.said },
    { role: 'assistant', content: t.reply, feedback: t.feedback, translation: t.translation },
  ]),
]

export default function App() {
  const [apiKey, setKey] = useState<string | null>(() => getApiKey())
  const [showKeyModal, setShowKeyModal] = useState(false)
  const [progressTab, setProgressTab] = useState<DashboardTab | null>(null)
  const [showAccount, setShowAccount] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  // sidebar: coluna recolhível no desktop (lembrada) e gaveta no celular (sempre começa fechada)
  const desktop = useMediaQuery('(min-width: 1024px)')
  const [sidebarPinned, setSidebarPinned] = usePersistentState('tutor_sidebar_open', true, isBoolean)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const sidebarOpen = desktop ? sidebarPinned : drawerOpen
  const closeSidebar = useCallback(() => (desktop ? setSidebarPinned(false) : setDrawerOpen(false)), [desktop, setSidebarPinned])
  const openSidebar = () => (desktop ? setSidebarPinned(true) : setDrawerOpen(true))
  /** No celular a gaveta fecha depois de uma ação; no desktop a coluna fica aberta. */
  const closeDrawer = () => setDrawerOpen(false)
  useEffect(() => {
    if (desktop) setDrawerOpen(false)
  }, [desktop])
  const [loadingChat, setLoadingChat] = useState<string | null>(null)
  const { enabled: cloud, ready: authReady, user } = useAuth()
  // login anônimo automático na inicialização; se falhar (offline), uid fica null e o app segue local
  const uid = user?.uid ?? null
  usePendingSync(uid)
  // erros recorrentes das correções recentes: entram no prompt do tutor a cada frase
  const weakSpots = useWeakSpots(uid)
  const sessionId = useRef(newSessionId())
  const [currentChat, setCurrentChat] = useState(sessionId.current)
  // pedido em andamento ao tutor: cancelado ao trocar de conversa
  const inflight = useRef<AbortController | null>(null)
  const { chats, error: historyError } = useChatHistory(uid)
  const [level, setLevel] = usePersistentState<Level>('tutor_level', 'intermediate', isLevel)
  const [blindPref, setBlind] = usePersistentState('tutor_blind_listening', false, isBoolean)
  const blind = blindPref && ttsSupported
  const speechRate = useSpeechRate()
  useProfileSync(user, { level, blindListening: blindPref, speechRate }, { setLevel, setBlind })
  const [messages, setMessages] = useState<ChatMessage[]>(() => [greeting(blind)])
  const [session, setSession] = useState(0) // remonta as bolhas a cada nova conversa
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  // vocabulário: termo tocado numa mensagem do tutor + termos já salvos (tempo real)
  const [termSel, setTermSel] = useState<TermSelection | null>(null)
  const closeTerm = useCallback(() => setTermSel(null), [])
  const { entries: vocab } = useVocabulary(uid)
  const savedVocab = useMemo(() => new Map((vocab ?? []).map((v) => [v.id, v])), [vocab])
  const savedIds = useMemo(() => new Set(savedVocab.keys()), [savedVocab])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, loading, error])

  function saveKey(key: string) {
    setApiKey(key)
    setKey(key)
    setShowKeyModal(false)
  }

  /** Encerra a sessão atual (se teve alguma frase) e mostra `next` com o id `id`. */
  function switchSession(id: string, next: ChatMessage[], end = true) {
    inflight.current?.abort()
    if (end && id !== sessionId.current && messages.some((m) => m.role === 'user')) endChat(uid, sessionId.current)
    sessionId.current = id
    setCurrentChat(id)
    setMessages(next)
    setSession((s) => s + 1)
    setTermSel(null)
    setError(null)
    setLoading(false)
  }

  function newConversation() {
    switchSession(newSessionId(), [greeting(blind)])
    closeDrawer()
  }

  function openProgress(tab: DashboardTab) {
    setProgressTab(tab)
    closeDrawer()
  }

  async function openChat(id: string) {
    if (id === sessionId.current) return closeDrawer()
    setLoadingChat(id)
    try {
      const turns = await loadChat(uid, id)
      if (!turns.length) throw new Error('vazia')
      switchSession(id, fromTurns(turns))
      closeDrawer()
      requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ block: 'end' }))
    } catch (e) {
      console.warn('[history] falha ao abrir conversa', e)
      setError('Não foi possível abrir essa conversa. Verifique a conexão e tente de novo.')
      closeDrawer()
    } finally {
      setLoadingChat(null)
    }
  }

  async function removeChat(id: string) {
    try {
      await deleteChat(uid, id)
      if (id === sessionId.current) switchSession(newSessionId(), [greeting(blind)], false)
    } catch (e) {
      console.warn('[history] falha ao apagar conversa', e)
    }
  }

  function reveal(index: number) {
    setMessages((m) => m.map((msg, i) => (i === index ? { ...msg, hidden: false } : msg)))
  }

  async function handleSend(text: string) {
    if (!apiKey) return setShowKeyModal(true)
    const sid = sessionId.current
    const first = !messages.some((m) => m.role === 'user')
    const ctrl = new AbortController()
    inflight.current = ctrl
    // responder revela o texto que estava oculto no modo escuta
    const next: ChatMessage[] = [
      ...messages.map((m) => (m.hidden ? { ...m, hidden: false } : m)),
      { role: 'user', content: text },
    ]
    setMessages(next)
    setError(null)
    setLoading(true)
    try {
      // A API exige que a conversa comece com "user": a saudação local é omitida.
      const history = next[0].role === 'assistant' ? next.slice(1) : next
      const { reply, feedback, translation } = await sendMessage(history, apiKey, level, weakSpots, ctrl.signal)
      if (ctrl.signal.aborted) return
      setMessages((m) => [...m, { role: 'assistant', content: reply, feedback, translation, hidden: blind }])
      void recordPhrase(uid, {
        sessionId: sid,
        level,
        said: text,
        feedback,
        reply,
        translation,
        title: first ? chatTitle(text) : undefined,
      })
    } catch (e) {
      // trocou de conversa no meio do pedido: nada a desfazer na tela nova
      if (ctrl.signal.aborted) return
      setError(e instanceof Error ? e.message : 'Erro inesperado.')
      // remove a mensagem não respondida para manter a alternância user/assistant
      setMessages((m) => m.slice(0, -1))
    } finally {
      if (inflight.current === ctrl) {
        inflight.current = null
        setLoading(false)
      }
    }
  }

  return (
    <div
      className="flex min-h-full flex-col"
      // largura ocupada pela sidebar fixa (desktop aberto); lida também pelo ChatInput
      style={{ '--sidebar-w': desktop && sidebarPinned ? '18rem' : '0px' } as CSSProperties}
    >
      <Sidebar
        desktop={desktop}
        open={sidebarOpen}
        onClose={closeSidebar}
        chats={chats}
        historyError={historyError}
        currentId={currentChat}
        loadingId={loadingChat}
        onSelectChat={openChat}
        onDeleteChat={removeChat}
        onNew={newConversation}
        onOpenProgress={openProgress}
        cloud={cloud}
        authReady={authReady}
        user={user}
        onOpenAccount={() => {
          closeDrawer()
          setShowAccount(true)
        }}
        onOpenSettings={() => {
          closeDrawer()
          setShowSettings(true)
        }}
      />

      <div className={`flex flex-1 flex-col pl-[var(--sidebar-w)] transition-[padding] duration-300 ${SIDEBAR_EASE}`}>
      <header className="sticky top-0 z-20 border-b border-zinc-900/5 bg-white/80 backdrop-blur-md pt-[env(safe-area-inset-top)]">
        <div className="flex h-14 items-center justify-between gap-2 px-2 sm:px-3">
          <div className="flex min-w-0 items-center gap-1.5">
            {!(desktop && sidebarPinned) && (
              <button
                onClick={openSidebar}
                aria-label="Abrir menu"
                aria-expanded={sidebarOpen}
                title="Menu"
                className={`${iconBtn} text-zinc-500 animate-in`}
              >
                <SidebarIcon />
              </button>
            )}
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-400 to-blue-600 text-sm font-medium text-white">
              T
            </div>
            <div className="min-w-0 leading-tight">
              <h1 className="truncate text-[15px] font-semibold tracking-tight">English Tutor</h1>
              <p className="truncate text-xs text-zinc-500">{loading ? 'digitando…' : blind ? 'modo escuta' : 'online'}</p>
            </div>
          </div>
          {/* atalhos rápidos: modo escuta e nova conversa (o resto fica na sidebar) */}
          <nav className="flex shrink-0 items-center" aria-label="Atalhos">
            {ttsSupported && (
              <button
                onClick={() => setBlind(!blindPref)}
                aria-pressed={blind}
                aria-label="Modo escuta"
                title={blind ? 'Desativar modo escuta' : 'Ativar modo escuta'}
                className={`${iconBtn} ${blind ? 'bg-blue-50 text-blue-500 hover:bg-blue-100' : 'text-zinc-500'}`}
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M3 14v-2a9 9 0 0 1 18 0v2" />
                  <rect x="3" y="14" width="4.5" height="6.5" rx="2" />
                  <rect x="16.5" y="14" width="4.5" height="6.5" rx="2" />
                </svg>
              </button>
            )}
            <button onClick={newConversation} aria-label="Nova conversa" title="Nova conversa" className={`${iconBtn} text-blue-500`}>
              <ComposeIcon className="h-5 w-5" />
            </button>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 space-y-2.5 px-3 pt-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))]">
        {blind && (
          <p className="mx-auto w-fit max-w-[90%] rounded-full bg-blue-50 px-3 py-1 text-center text-xs text-blue-600 animate-in">
            🎧 Modo escuta: as respostas chegam só em áudio. Responda para ver o texto.
          </p>
        )}
        {messages.map((m, i) => (
          <MessageBubble
            key={`${session}-${i}`}
            messageKey={`${session}-${i}`}
            message={m}
            onReveal={() => reveal(i)}
            onSelectTerm={setTermSel}
            active={termSel}
            savedIds={savedIds}
          />
        ))}
        {loading && <TypingIndicator />}
        {error && (
          <div className="mx-auto w-fit max-w-[90%] rounded-2xl bg-red-50 px-4 py-2 text-center text-sm text-red-600 ring-1 ring-red-100 animate-in">
            {error}
          </div>
        )}
        <div ref={bottomRef} />
      </main>

      <ChatInput disabled={loading} onSend={handleSend} />
      </div>

      {termSel && (
        <WordPopover
          key={`${termSel.source}-${termSel.offset}-${termSel.term}`}
          selection={termSel}
          uid={uid}
          apiKey={apiKey}
          saved={savedVocab.get(termId(termSel.term))}
          onClose={closeTerm}
        />
      )}

      {progressTab && <ProgressDashboard uid={uid} initialTab={progressTab} onClose={() => setProgressTab(null)} />}

      {showSettings && (
        <SettingsModal
          level={level}
          onLevelChange={setLevel}
          blind={blind}
          onBlindChange={setBlind}
          onEditApiKey={() => {
            setShowSettings(false)
            setShowKeyModal(true)
          }}
          onClose={() => setShowSettings(false)}
        />
      )}

      {showAccount && <AuthModal user={user} onClose={() => setShowAccount(false)} />}

      {(!cloud || authReady) && (!apiKey || showKeyModal) && (
        <ApiKeyModal
          initialKey={apiKey ?? ''}
          onSave={saveKey}
          onClose={apiKey ? () => setShowKeyModal(false) : undefined}
        />
      )}
    </div>
  )
}
