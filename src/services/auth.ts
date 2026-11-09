// Firebase Auth. Sem sessão salva, o app entra automaticamente como convidado (anônimo);
// depois o usuário pode transformar o convidado em conta de e-mail sem perder o histórico.
import { useSyncExternalStore } from 'react'
import {
  EmailAuthProvider,
  createUserWithEmailAndPassword,
  linkWithCredential,
  onAuthStateChanged,
  signInAnonymously,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  type Auth,
  type User,
} from 'firebase/auth'
import { auth, firebaseReady } from '../lib/firebase'

export interface AuthState {
  /** Firebase configurado e inicializado */
  enabled: boolean
  /** estado do Auth já conhecido (logado, ou login automático falhou e o app segue em modo local) */
  ready: boolean
  user: User | null
  /** código do erro do login automático, se houve */
  error: string | null
}

/* ---------------- Store único (um listener para o app inteiro) ---------------- */

let state: AuthState = { enabled: firebaseReady(), ready: !firebaseReady(), user: null, error: null }
const listeners = new Set<() => void>()

function emit(patch: Partial<AuthState>) {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

let autoSignIn: Promise<void> | null = null

/** Login anônimo automático. Falhando (offline, provedor desativado), o app usa o localStorage. */
function ensureSignedIn(a: Auth) {
  if (a.currentUser || autoSignIn) return
  autoSignIn = signInAnonymously(a)
    .then(() => undefined) // onAuthStateChanged entrega o usuário
    .catch((e) => {
      console.warn('[auth] login anônimo falhou; usando só o localStorage até reconectar.', e)
      emit({ ready: true, user: null, error: (e as { code?: string })?.code ?? 'unknown' })
    })
    .finally(() => {
      autoSignIn = null
    })
}

if (auth) {
  const a = auth
  onAuthStateChanged(a, (user) => {
    if (user) return emit({ ready: true, user, error: null })
    // sem sessão salva (primeiro acesso ou após "Sair"): entra como convidado
    emit({ user: null })
    ensureSignedIn(a)
  })
  // abriu offline e o login falhou: tenta de novo quando a conexão voltar
  window.addEventListener('online', () => ensureSignedIn(a))
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useAuth(): AuthState {
  return useSyncExternalStore(subscribe, () => state)
}

function requireAuth() {
  if (!auth) throw new Error('Login indisponível: Firebase não configurado.')
  return auth
}

export async function signInWithEmail(email: string, password: string) {
  await signInWithEmailAndPassword(requireAuth(), email.trim(), password)
}

/** Cria a conta. Se o usuário atual é convidado, a conta é vinculada e o histórico é mantido. */
export async function signUpWithEmail(email: string, password: string) {
  const a = requireAuth()
  if (a.currentUser?.isAnonymous) {
    const { user } = await linkWithCredential(a.currentUser, EmailAuthProvider.credential(email.trim(), password))
    // linkWithCredential não dispara onAuthStateChanged: avisa os hooks manualmente
    emit({ user, error: null })
    return
  }
  await createUserWithEmailAndPassword(a, email.trim(), password)
}

export async function signInAsGuest() {
  await signInAnonymously(requireAuth())
}

export async function signOut() {
  await fbSignOut(requireAuth())
}

const MESSAGES: Record<string, string> = {
  'auth/invalid-email': 'E-mail inválido.',
  'auth/missing-password': 'Digite a senha.',
  'auth/weak-password': 'A senha precisa ter pelo menos 6 caracteres.',
  'auth/email-already-in-use': 'Este e-mail já tem uma conta. Tente entrar.',
  'auth/credential-already-in-use': 'Este e-mail já tem uma conta. Tente entrar.',
  'auth/invalid-credential': 'E-mail ou senha incorretos.',
  'auth/wrong-password': 'E-mail ou senha incorretos.',
  'auth/user-not-found': 'E-mail ou senha incorretos.',
  'auth/too-many-requests': 'Muitas tentativas. Aguarde um pouco e tente de novo.',
  'auth/network-request-failed': 'Sem conexão. Verifique sua internet.',
  'auth/operation-not-allowed': 'Este método de login não está ativado no Firebase.',
  'auth/admin-restricted-operation': 'Login como convidado não está ativado no Firebase.',
}

export function authErrorMessage(e: unknown) {
  const code = (e as { code?: string })?.code
  return (code && MESSAGES[code]) || 'Não foi possível entrar. Tente novamente.'
}
