import { useState, type FormEvent } from 'react'

interface Props {
  initialKey?: string
  onSave: (key: string) => void
  onClose?: () => void
}

export default function ApiKeyModal({ initialKey = '', onSave, onClose }: Props) {
  const [value, setValue] = useState(initialKey)
  const valid = value.trim().startsWith('gsk_')

  function submit(e: FormEvent) {
    e.preventDefault()
    if (valid) onSave(value.trim())
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-zinc-900/20 backdrop-blur-sm p-4 pb-[max(1rem,env(safe-area-inset-bottom))] animate-in">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-3xl bg-white/80 backdrop-blur-md shadow-sm ring-1 ring-zinc-900/5 p-6 space-y-5"
      >
        <div className="space-y-1.5 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-900 text-white text-xl">
            🔑
          </div>
          <h2 className="text-lg font-semibold tracking-tight">Sua API Key do Groq</h2>
          <p className="text-sm text-zinc-500 leading-relaxed">
            Gratuita. A chave fica salva apenas neste navegador e é enviada direto para o Groq.
          </p>
        </div>

        <input
          type="password"
          autoFocus
          autoComplete="off"
          spellCheck={false}
          placeholder="gsk_..."
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-full min-h-11 rounded-2xl bg-zinc-100 px-4 text-base outline-none ring-1 ring-transparent transition-all duration-300 ease-out focus:bg-white focus:ring-zinc-300"
        />

        <div className="flex gap-2">
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="flex-1 min-h-11 rounded-2xl text-sm font-medium text-zinc-600 bg-zinc-100 transition-all duration-300 ease-out hover:bg-zinc-200 active:scale-[0.97]"
            >
              Cancelar
            </button>
          )}
          <button
            type="submit"
            disabled={!valid}
            className="flex-1 min-h-11 rounded-2xl text-sm font-medium text-white bg-zinc-900 transition-all duration-300 ease-out hover:bg-zinc-800 active:scale-[0.97] disabled:opacity-30 disabled:active:scale-100"
          >
            Salvar
          </button>
        </div>

        <a
          href="https://console.groq.com/keys"
          target="_blank"
          rel="noreferrer"
          className="block text-center text-xs text-zinc-400 hover:text-zinc-600 transition-colors"
        >
          Criar uma chave grátis no Groq Console →
        </a>
      </form>
    </div>
  )
}
