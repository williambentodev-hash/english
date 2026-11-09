import { useEffect, useState, type FormEvent } from 'react'
import type { User } from 'firebase/auth'
import { authErrorMessage, signInAsGuest, signInWithEmail, signOut, signUpWithEmail } from '../services/auth'

interface Props {
  /** usuário atual; com usuário, o modal mostra a conta (e pode ser fechado) */
  user: User | null
  onClose?: () => void
}

type Mode = 'signin' | 'signup'

const inputClass =
  'w-full min-h-11 rounded-2xl bg-zinc-100 px-4 text-base outline-none ring-1 ring-transparent transition-all duration-300 ease-out focus:bg-white focus:ring-zinc-300'
const primaryClass =
  'w-full min-h-11 rounded-2xl text-sm font-medium text-white bg-zinc-900 transition-all duration-300 ease-out hover:bg-zinc-800 active:scale-[0.97] disabled:opacity-30 disabled:active:scale-100'
const secondaryClass =
  'w-full min-h-11 rounded-2xl text-sm font-medium text-zinc-600 bg-zinc-100 transition-all duration-300 ease-out hover:bg-zinc-200 active:scale-[0.97] disabled:opacity-50 disabled:active:scale-100'

export default function AuthModal({ user, onClose }: Props) {
  const guest = user?.isAnonymous ?? false
  // convidado abrindo o modal pela conta: oferece criar conta (mantém o histórico)
  const [mode, setMode] = useState<Mode>(guest ? 'signup' : 'signin')
  const [showForm, setShowForm] = useState(!user)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!onClose) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const valid = /\S+@\S+\.\S+/.test(email.trim()) && password.length >= 6

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await action()
      onClose?.()
    } catch (e) {
      setError(authErrorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!valid || busy) return
    run(() => (mode === 'signin' ? signInWithEmail(email, password) : signUpWithEmail(email, password)))
  }

  const title = user && !showForm ? 'Sua conta' : mode === 'signin' ? 'Entrar' : 'Criar conta'
  const subtitle =
    user && !showForm
      ? guest
        ? 'Você está como convidado. Crie uma conta para não perder sua evolução ao trocar de aparelho.'
        : user.email
      : guest && mode === 'signin'
        ? 'Ao entrar em uma conta existente, a evolução deste convidado fica para trás. Para mantê-la, use "Criar conta".'
        : !user
          ? 'Sem conexão com a nuvem no momento: sua evolução está sendo salva neste aparelho e será enviada quando você entrar.'
          : 'Sua evolução, correções e preferências ficam salvas na nuvem e sincronizadas entre aparelhos.'

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-title"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-zinc-900/20 backdrop-blur-sm p-4 pb-[max(1rem,env(safe-area-inset-bottom))] animate-in"
      onClick={(e) => e.target === e.currentTarget && onClose?.()}
    >
      <div className="w-full max-w-sm rounded-3xl bg-white/80 backdrop-blur-md shadow-sm ring-1 ring-zinc-900/5 p-6 space-y-5">
        <div className="space-y-1.5 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-400 to-blue-600 text-white">
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21a8 8 0 0 1 16 0" />
            </svg>
          </div>
          <h2 id="auth-title" className="text-lg font-semibold tracking-tight">{title}</h2>
          <p className="text-sm text-zinc-500 leading-relaxed break-words">{subtitle}</p>
        </div>

        {user && !showForm ? (
          <div className="space-y-2">
            {guest ? (
              <>
                <button onClick={() => { setMode('signup'); setShowForm(true) }} className={primaryClass}>
                  Criar conta
                </button>
                {/* sem "Sair" para convidado: sairia para um novo convidado e o histórico ficaria inacessível */}
                <button onClick={() => { setMode('signin'); setShowForm(true) }} className={secondaryClass}>
                  Já tenho conta
                </button>
              </>
            ) : (
              <button disabled={busy} onClick={() => run(signOut)} className={`${secondaryClass} !text-red-500`}>
                Sair
              </button>
            )}
            {onClose && (
              <button onClick={onClose} className="block w-full min-h-11 text-sm font-medium text-blue-500">
                OK
              </button>
            )}
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-2.5">
            <input
              type="email"
              autoFocus
              autoComplete="email"
              inputMode="email"
              placeholder="E-mail"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
            />
            <input
              type="password"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              placeholder={mode === 'signin' ? 'Senha' : 'Senha (mín. 6 caracteres)'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
            />

            {error && (
              <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-center text-xs text-red-600 animate-in">
                {error}
              </p>
            )}

            <button type="submit" disabled={!valid || busy} className={`${primaryClass} !mt-4`}>
              {busy ? 'Aguarde…' : mode === 'signin' ? 'Entrar' : 'Criar conta'}
            </button>

            {!user && (
              <>
                <div className="flex items-center gap-3 py-1 text-[11px] uppercase tracking-wide text-zinc-400">
                  <span className="h-px flex-1 bg-zinc-900/10" />
                  ou
                  <span className="h-px flex-1 bg-zinc-900/10" />
                </div>
                <button type="button" disabled={busy} onClick={() => run(signInAsGuest)} className={secondaryClass}>
                  Continuar como convidado
                </button>
              </>
            )}

            <button
              type="button"
              onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(null) }}
              className="block w-full pt-1 text-center text-xs text-zinc-500 hover:text-zinc-700 transition-colors"
            >
              {mode === 'signin' ? 'Não tem conta? Criar conta' : 'Já tem conta? Entrar'}
            </button>
            {user && (
              <button
                type="button"
                onClick={() => (onClose ? onClose() : setShowForm(false))}
                className="block w-full text-center text-xs text-zinc-400 hover:text-zinc-600 transition-colors"
              >
                Cancelar
              </button>
            )}
          </form>
        )}
      </div>
    </div>
  )
}
