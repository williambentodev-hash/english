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
