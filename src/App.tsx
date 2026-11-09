import { useEffect, useRef, useState } from 'react'
import ApiKeyModal from './components/ApiKeyModal'
import ChatInput from './components/ChatInput'
import LevelPicker from './components/LevelPicker'
import MessageBubble, { TypingIndicator } from './components/MessageBubble'
import { getApiKey, isLevel, sendMessage, setApiKey, type ChatMessage, type Level } from './services/groq'
import { isBoolean, usePersistentState } from './services/prefs'
import { ttsSupported } from './services/speech'

const GREETING_TEXT = "Hi there! 👋 I'm your English tutor. How was your day today?"

const greeting = (blind: boolean): ChatMessage => ({ role: 'assistant', content: GREETING_TEXT, hidden: blind })

export default function App() {
  const [apiKey, setKey] = useState<string | null>(() => getApiKey())
  const [showKeyModal, setShowKeyModal] = useState(false)
  const [level, setLevel] = usePersistentState<Level>('tutor_level', 'intermediate', isLevel)
  const [blindPref, setBlind] = usePersistentState('tutor_blind_listening', false, isBoolean)
  const blind = blindPref && ttsSupported
  const [messages, setMessages] = useState<ChatMessage[]>(() => [greeting(blind)])
  const [session, setSession] = useState(0) // remonta as bolhas a cada nova conversa
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

  function newConversation() {
    setMessages([greeting(blind)])
    setSession((s) => s + 1)
    setError(null)
  }

  function reveal(index: number) {
    setMessages((m) => m.map((msg, i) => (i === index ? { ...msg, hidden: false } : msg)))
  }

  async function handleSend(text: string) {
    if (!apiKey) return setShowKeyModal(true)
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
      const { reply, feedback } = await sendMessage(history, apiKey, level)
      setMessages((m) => [...m, { role: 'assistant', content: reply, feedback, hidden: blind }])
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
              <p className="text-xs text-zinc-500">{loading ? 'digitando…' : blind ? 'modo escuta' : 'online'}</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={newConversation}
              className="min-h-11 rounded-full px-3 text-sm text-blue-500 transition-all duration-300 ease-out hover:bg-zinc-100 active:scale-95"
            >
              Nova
            </button>
            {ttsSupported && (
              <button
                onClick={() => setBlind((b) => !b)}
                aria-pressed={blind}
                aria-label="Modo escuta (ouvir antes de ver)"
                title="Modo escuta: ouvir antes de ver"
                className={`flex h-11 w-11 items-center justify-center rounded-full transition-all duration-300 ease-out active:scale-95 ${
                  blind ? 'bg-blue-50 text-blue-500' : 'text-zinc-500 hover:bg-zinc-100'
                }`}
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 14v-2a9 9 0 0 1 18 0v2" />
                  <rect x="3" y="14" width="4.5" height="6.5" rx="2" fill={blind ? 'currentColor' : 'none'} />
                  <rect x="16.5" y="14" width="4.5" height="6.5" rx="2" fill={blind ? 'currentColor' : 'none'} />
                </svg>
              </button>
            )}
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
        <div className="mx-auto flex max-w-2xl justify-center px-4 pb-2.5">
          <LevelPicker value={level} onChange={setLevel} />
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 space-y-2.5 px-3 pt-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))]">
        {blind && (
          <p className="mx-auto w-fit max-w-[90%] rounded-full bg-blue-50 px-3 py-1 text-center text-xs text-blue-600 animate-in">
            🎧 Modo escuta: as respostas chegam só em áudio. Responda para ver o texto.
          </p>
        )}
        {messages.map((m, i) => (
          <MessageBubble key={`${session}-${i}`} message={m} onReveal={() => reveal(i)} />
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
