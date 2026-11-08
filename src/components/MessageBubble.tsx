import { useEffect, useId } from 'react'
import type { ChatMessage } from '../services/groq'
import { getSpeakingId, speak, stopSpeaking, ttsSupported, useIsSpeaking } from '../services/speech'

// Destaca correções entre colchetes nas respostas do tutor.
function renderContent(text: string) {
  return text.split(/(\[[^\]]+\])/g).map((part, i) =>
    part.startsWith('[') && part.endsWith(']') ? (
      <span
        key={i}
        className="block mb-1.5 rounded-xl bg-amber-50 px-2.5 py-1.5 text-[13px] text-amber-800 ring-1 ring-amber-200/60"
      >
        {part.slice(1, -1)}
      </span>
    ) : (
      <span key={i}>{part.trim() && part}</span>
    ),
  )
}

function ListenButton({ text }: { text: string }) {
  const id = useId()
  const speaking = useIsSpeaking(id)

  // para a leitura se a mensagem sair da tela (ex.: "Nova" conversa)
  useEffect(() => () => { if (getSpeakingId() === id) stopSpeaking() }, [id])

  return (
    <button
      type="button"
      onClick={() => (speaking ? stopSpeaking() : speak(id, text))}
      aria-label={speaking ? 'Parar leitura' : 'Ouvir'}
      title={speaking ? 'Parar' : 'Ouvir'}
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-all duration-300 ease-out active:scale-90 ${
        speaking ? 'bg-blue-50 text-blue-500' : 'text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600'
      }`}
    >
      {speaking ? (
        <span className="flex h-4 items-center gap-[3px]" aria-hidden>
          {[0, 200, 400].map((d) => (
            <span
              key={d}
              className="h-full w-[3px] rounded-full bg-current animate-sound-bar"
              style={{ animationDelay: `${d}ms` }}
            />
          ))}
        </span>
      ) : (
        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M11 5 6 9H3v6h3l5 4V5z" fill="currentColor" fillOpacity={0.12} />
          <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
        </svg>
      )}
    </button>
  )
}

export default function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'
  return (
    <div className={`flex items-end gap-1 animate-in ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] sm:max-w-[70%] px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap break-words shadow-sm ${
          isUser
            ? 'bg-blue-500 text-white rounded-3xl rounded-br-lg'
            : 'bg-white text-zinc-900 rounded-3xl rounded-bl-lg ring-1 ring-zinc-900/5'
        }`}
      >
        {isUser ? message.content : renderContent(message.content)}
      </div>
      {!isUser && ttsSupported && <ListenButton text={message.content} />}
    </div>
  )
}

export function TypingIndicator() {
  return (
    <div className="flex justify-start animate-in" aria-label="Tutor digitando">
      <div className="flex items-center gap-1 rounded-3xl rounded-bl-lg bg-white px-4 py-3.5 shadow-sm ring-1 ring-zinc-900/5">
        {[0, 150, 300].map((d) => (
          <span
            key={d}
            className="h-2 w-2 rounded-full bg-zinc-400 animate-typing"
            style={{ animationDelay: `${d}ms` }}
          />
        ))}
      </div>
    </div>
  )
}
