import { useEffect, useRef, useState } from 'react'
import ApiKeyModal from './components/ApiKeyModal'
import ChatInput from './components/ChatInput'
import MessageBubble, { TypingIndicator } from './components/MessageBubble'
import { getApiKey, sendMessage, setApiKey, type ChatMessage } from './services/claude'

const GREETING: ChatMessage = {
  role: 'assistant',
  content: "Hi there! 👋 I'm your English tutor. How was your day today?",
}

export default function App() {
  const [apiKey, setKey] = useState<string | null>(() => getApiKey())
  const [showKeyModal, setShowKeyModal] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([GREETING])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, loading, error])

  function saveKey(key: string) {
    setApiKey(key)
    setKey(key)
    setShowKeyModal(false)
  }

  async function handleSend(text: string) {
    if (!apiKey) return setShowKeyModal(true)
    const next = [...messages, { role: 'user' as const, content: text }]
    setMessages(next)
    setError(null)
    setLoading(true)
    try {
      // A API exige que a conversa comece com "user": a saudação local é omitida.
      const history = next[0] === GREETING ? next.slice(1) : next
      const reply = await sendMessage(history, apiKey)
      setMessages((m) => [...m, { role: 'assistant', content: reply }])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro inesperado.')
      // remove a mensagem não respondida para manter a alternância user/assistant
      setMessages((m) => m.slice(0, -1))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-30 border-b border-zinc-900/5 bg-white/80 backdrop-blur-md pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex h-14 max-w-2xl items-center justify-between px-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-blue-400 to-blue-600 text-sm text-white">
              T
            </div>
            <div className="leading-tight">
              <h1 className="text-[15px] font-semibold tracking-tight">English Tutor</h1>
              <p className="text-xs text-zinc-500">{loading ? 'digitando…' : 'online'}</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => { setMessages([GREETING]); setError(null) }}
              className="min-h-11 rounded-full px-3 text-sm text-blue-500 transition-all duration-300 ease-out hover:bg-zinc-100 active:scale-95"
            >
              Nova
            </button>
            <button
              onClick={() => setShowKeyModal(true)}
              aria-label="Configurar API key"
              className="flex h-11 w-11 items-center justify-center rounded-full text-zinc-500 transition-all duration-300 ease-out hover:bg-zinc-100 active:scale-95"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 space-y-2.5 px-3 pt-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))]">
        {messages.map((m, i) => (
          <MessageBubble key={i} message={m} />
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

      {(!apiKey || showKeyModal) && (
        <ApiKeyModal
          initialKey={apiKey ?? ''}
          onSave={saveKey}
          onClose={apiKey ? () => setShowKeyModal(false) : undefined}
        />
      )}
    </div>
  )
}
