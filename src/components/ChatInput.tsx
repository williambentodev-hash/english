import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react'

interface Props {
  disabled?: boolean
  onSend: (text: string) => void
}

export default function ChatInput({ disabled, onSend }: Props) {
  const [text, setText] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)
  const canSend = text.trim().length > 0 && !disabled

  function submit(e?: FormEvent) {
    e?.preventDefault()
    if (!canSend) return
    onSend(text.trim())
    setText('')
    if (ref.current) ref.current.style.height = 'auto'
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter envia no desktop; Shift+Enter quebra linha
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-900/5 bg-white/80 backdrop-blur-md">
      <form
        onSubmit={submit}
        className="mx-auto flex max-w-2xl items-end gap-2 px-3 pt-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))]"
      >
        <textarea
          ref={ref}
          rows={1}
          value={text}
          placeholder="Write in English…"
          onChange={(e) => {
            setText(e.target.value)
            e.target.style.height = 'auto'
            e.target.style.height = `${Math.min(e.target.scrollHeight, 128)}px`
          }}
          onKeyDown={onKeyDown}
          className="flex-1 min-h-11 max-h-32 resize-none rounded-3xl bg-zinc-100 px-4 py-2.5 text-base leading-6 outline-none ring-1 ring-transparent transition-all duration-300 ease-out focus:bg-white focus:ring-zinc-300"
        />
        <button
          type="submit"
          disabled={!canSend}
          aria-label="Enviar"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blue-500 text-white shadow-sm transition-all duration-300 ease-out hover:bg-blue-600 active:scale-90 disabled:bg-zinc-300 disabled:shadow-none"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </button>
      </form>
    </div>
  )
}
