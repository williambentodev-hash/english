import type { ChatMessage } from '../services/claude'

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

export default function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'
  return (
    <div className={`flex animate-in ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] sm:max-w-[70%] px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap break-words shadow-sm ${
          isUser
            ? 'bg-blue-500 text-white rounded-3xl rounded-br-lg'
            : 'bg-white text-zinc-900 rounded-3xl rounded-bl-lg ring-1 ring-zinc-900/5'
        }`}
      >
        {isUser ? message.content : renderContent(message.content)}
      </div>
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
