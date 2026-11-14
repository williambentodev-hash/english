import { useEffect, useState } from 'react'

/** useState salvo no localStorage (ignora valores inválidos ou storage indisponível). */
export function usePersistentState<T>(key: string, initial: T, isValid: (v: unknown) => v is T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      const parsed: unknown = raw == null ? null : JSON.parse(raw)
      return isValid(parsed) ? parsed : initial
    } catch {
      return initial
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      /* modo privado */
    }
  }, [key, value])

  return [value, setValue] as const
}

export const isBoolean = (v: unknown): v is boolean => typeof v === 'boolean'

/** true enquanto a media query casar (atualiza ao redimensionar/girar a tela). */
export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const sync = () => setMatches(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [query])
  return matches
}
