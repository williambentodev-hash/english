// Sincroniza nível e configurações com users/{uid}. As preferências continuam no localStorage
// (resposta instantânea e fallback); o Firestore é aplicado ao entrar e atualizado a cada mudança.
import { useEffect, useRef } from 'react'
import type { User } from 'firebase/auth'
import { loadUserProfile, saveUserProfile, type UserProfile } from './db'
import type { Level } from './tutor'
import type { Goal } from './scenarios'
import { isSpeechRate, setSpeechRate } from './speech'

interface Setters {
  setLevel: (l: Level) => void
  setBlind: (b: boolean) => void
  setGoal: (g: Goal) => void
  setProfession: (p: string) => void
  setOnboarded: (o: boolean) => void
}

export function useProfileSync(
  user: User | null,
  profile: UserProfile,
  { setLevel, setBlind, setGoal, setProfession, setOnboarded }: Setters,
) {
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
        // boas-vindas respondidas aqui antes de a nuvem saber delas: as escolhas deste aparelho valem
        const localIsNewer = latest.current.onboarded && !remote?.onboarded
        if (remote && !localIsNewer) {
          if (remote.level) setLevel(remote.level)
          if (remote.blindListening != null) setBlind(remote.blindListening)
          if (isSpeechRate(remote.speechRate)) setSpeechRate(remote.speechRate)
          if (remote.goal) setGoal(remote.goal)
          if (remote.profession != null) setProfession(remote.profession)
          // quem já fez as boas-vindas em outro aparelho não repete aqui
          if (remote.onboarded) setOnboarded(true)
        } else {
          // primeiro acesso (ou boas-vindas recém-feitas): leva as preferências deste navegador para a nuvem
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

  const { level, blindListening, speechRate, goal, profession, onboarded } = profile
  useEffect(() => {
    if (!uid || loadedFor.current !== uid) return
    saveUserProfile(uid, { level, blindListening, speechRate, goal, profession, onboarded, ...meta }).catch(warn)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, level, blindListening, speechRate, goal, profession, onboarded, meta.email, meta.anonymous])
}

const warn = (e: unknown) => console.warn('[profile] falha ao sincronizar com o Firestore.', e)
