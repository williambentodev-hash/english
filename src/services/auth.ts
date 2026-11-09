// Firebase Auth: e-mail/senha ou convidado (anônimo).
import { useEffect, useState } from 'react'
import {
  EmailAuthProvider,
  createUserWithEmailAndPassword,
  linkWithCredential,
  onAuthStateChanged,
  signInAnonymously,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  type User,
} from 'firebase/auth'
import { auth, firebaseReady } from '../lib/firebase'

export interface AuthState {
  /** Firebase configurado e inicializado */
  enabled: boolean
  /** estado inicial do Auth já conhecido */
  ready: boolean
  user: User | null
}

// avisa os hooks quando o usuário muda sem trocar de sessão (ex.: convidado vira conta)
const refreshListeners = new Set<() => void>()

export function useAuth(): AuthState {
  const enabled = firebaseReady()
  const [state, setState] = useState<AuthState>({ enabled, ready: !enabled, user: null })

  useEffect(() => {
    if (!auth) return
    const a = auth
    const update = () => setState({ enabled: true, ready: true, user: a.currentUser })
    refreshListeners.add(update)
    const unsub = onAuthStateChanged(a, update)
    return () => {
      refreshListeners.delete(update)
      unsub()
    }
  }, [])

  return state
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
    await linkWithCredential(a.currentUser, EmailAuthProvider.credential(email.trim(), password))
    // linkWithCredential não dispara onAuthStateChanged: avisa os hooks manualmente
    refreshListeners.forEach((l) => l())
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
