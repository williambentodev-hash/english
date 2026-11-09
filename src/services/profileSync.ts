// Sincroniza nível e configurações com users/{uid}. As preferências continuam no localStorage
// (resposta instantânea e fallback); o Firestore é aplicado ao entrar e atualizado a cada mudança.
import { useEffect, useRef } from 'react'
import type { User } from 'firebase/auth'
import { loadUserProfile, saveUserProfile, type UserProfile } from './db'
import type { Level } from './groq'
import { isSpeechRate, setSpeechRate } from './speech'

interface Setters {
  setLevel: (l: Level) => void
  setBlind: (b: boolean) => void
}

export function useProfileSync(user: User | null, profile: UserProfile, { setLevel, setBlind }: Setters) {
  const uid = user?.uid ?? null
  // uid cujo perfil remoto já foi aplicado; antes disso não grava, para não sobrescrever a nuvem
  const loadedFor = useRef<string | null>(null)
  const latest = useRef(profile)
  latest.current = profile
  const meta = { email: user?.email ?? null, anonymous: user?.isAnonymous ?? false }

  useEffect(() => {
    loadedFor.current = null
    if (!uid) return
    let cancelled = false
    loadUserProfile(uid)
      .then((remote) => {
        if (cancelled) return
        if (remote) {
          if (remote.level) setLevel(remote.level)
          if (remote.blindListening != null) setBlind(remote.blindListening)
          if (isSpeechRate(remote.speechRate)) setSpeechRate(remote.speechRate)
        } else {
          // primeiro acesso: leva as preferências deste navegador para a nuvem
          saveUserProfile(uid, { ...latest.current, ...meta }).catch(warn)
        }
        loadedFor.current = uid
      })
      .catch((e) => {
        warn(e)
        if (!cancelled) loadedFor.current = uid
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid])

  const { level, blindListening, speechRate } = profile
  useEffect(() => {
    if (!uid || loadedFor.current !== uid) return
    saveUserProfile(uid, { level, blindListening, speechRate, ...meta }).catch(warn)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, level, blindListening, speechRate, meta.email, meta.anonymous])
}

const warn = (e: unknown) => console.warn('[profile] falha ao sincronizar com o Firestore.', e)
