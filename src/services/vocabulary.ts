// Vocabulário salvo (termos individuais tocados nas mensagens do tutor).
// - Usuário autenticado: Firestore, coleção `vocabulary` (o cache offline do Firestore enfileira as escritas).
// - Sem Firebase/usuário: localStorage deste navegador.
import { useEffect, useState } from 'react'
import { firebaseReady } from '../lib/firebase'
import {
  deleteVocabRemote,
  saveVocabRemote,
  setVocabLearnedRemote,
  subscribeVocabRemote,
  toVocabEntry,
  type VocabEntry,
} from './db'

export type { VocabEntry }

const STORAGE = 'tutor_vocabulary_v1'
const CHANGED = 'tutor-vocab-changed'
/** termos com mais palavras que isso viram "frase", não vocabulário */
export const MAX_TERM_WORDS = 6

/* ---------------- Normalização ---------------- */

/** Limpa pontuação das bordas e espaços; minúscula no início de frase (exceto "I" e siglas). */
export function cleanTerm(raw: string) {
  const t = raw
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
  if (/^\p{Lu}\p{Ll}/u.test(t) && !/^I\b/.test(t)) return t[0].toLowerCase() + t.slice(1)
  return t
}

/** Id estável do termo (vira parte do id do documento; `encodeURIComponent` remove "/"). */
export const termId = (term: string) => encodeURIComponent(cleanTerm(term).toLowerCase())

export const countWords = (t: string) => t.split(/\s+/).filter(Boolean).length

/** Frase (do texto do tutor) que contém a posição `offset`. */
export function sentenceAt(text: string, offset: number) {
  const re = /[^.!?\n]+(?:[.!?]+["'”’)]*|\n|$)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (offset >= m.index && offset < m.index + m[0].length) return m[0].trim().replace(/^[^\p{L}\p{N}"'“]+/u, '')
    if (!m[0]) break
  }
  return text.trim()
}

/* ---------------- localStorage ---------------- */

function loadLocal(): VocabEntry[] {
  try {
    const arr = JSON.parse(localStorage.getItem(STORAGE) ?? '[]')
    if (!Array.isArray(arr)) return []
    return arr
      .map((x) => toVocabEntry(x, typeof x?.id === 'string' ? x.id : ''))
      .filter((v): v is VocabEntry => v !== null && v.id !== '')
      .sort((a, b) => b.date.localeCompare(a.date))
  } catch {
    return []
  }
}

function writeLocal(entries: VocabEntry[]) {
  try {
    localStorage.setItem(STORAGE, JSON.stringify(entries))
  } catch {
    /* modo privado / storage cheio */
  }
  window.dispatchEvent(new Event(CHANGED))
}

const useCloud = (uid: string | null): uid is string => !!uid && firebaseReady()

/* ---------------- API ---------------- */

export interface NewTerm {
  term: string
  translation: string
  base: string | null
  context: string
  /** ao restaurar um termo removido ("Desfazer") */
  date?: string
  learned?: boolean
}

export async function saveTerm(uid: string | null, t: NewTerm) {
  const term = cleanTerm(t.term).slice(0, 120)
  const entry: VocabEntry = {
    id: termId(term),
    term,
    // limites espelhados em firestore.rules
    translation: t.translation.slice(0, 200),
    base: t.base?.slice(0, 120) ?? null,
    context: t.context.slice(0, 1000),
    date: t.date ?? new Date().toISOString(),
    learned: t.learned ?? false,
  }
  if (useCloud(uid)) return void (await saveVocabRemote(uid, entry))
  writeLocal([entry, ...loadLocal().filter((e) => e.id !== entry.id)])
}

export async function setLearned(uid: string | null, id: string, learned: boolean) {
  if (useCloud(uid)) return void (await setVocabLearnedRemote(uid, id, learned))
  writeLocal(loadLocal().map((e) => (e.id === id ? { ...e, learned } : e)))
}

export async function removeTerm(uid: string | null, id: string) {
  if (useCloud(uid)) return void (await deleteVocabRemote(uid, id))
  writeLocal(loadLocal().filter((e) => e.id !== id))
}

/** Lista em tempo real (null enquanto carrega). */
export function useVocabulary(uid: string | null) {
  const [entries, setEntries] = useState<VocabEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setEntries(null)
    setError(null)
    if (useCloud(uid)) {
      return subscribeVocabRemote(uid, setEntries, (e) => {
        console.warn('[vocabulary] falha ao carregar', e)
        setError('Não foi possível carregar o vocabulário.')
        setEntries([])
      })
    }
    const sync = () => setEntries(loadLocal())
    sync()
    const onStorage = (e: StorageEvent) => e.key === STORAGE && sync()
    window.addEventListener(CHANGED, sync)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(CHANGED, sync)
      window.removeEventListener('storage', onStorage)
    }
  }, [uid])

  return { entries, error }
}
