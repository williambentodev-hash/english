// Meta diária e ofensiva (dias seguidos cumprindo a meta).
//
// - Cada atividade do app soma pontos numa das 4 habilidades do dia (recordActivity).
// - O dia fica "cumprido" quando todas as habilidades ligadas na meta chegam ao alvo. Isso é gravado
//   no próprio dia (done), então mudar a meta depois não reescreve o passado.
// - Ofensiva: dias cumpridos seguidos. A cada 7 dias o aluno ganha uma proteção (máx. 2), gasta
//   sozinha num dia perdido para não zerar a ofensiva.
// - Guardado no localStorage e, com login, no campo `habit` de users/{uid}. Ao sincronizar, os dois
//   lados são mesclados (maior contagem de cada dia), então dois aparelhos no mesmo dia não se apagam.
import { useEffect, useState } from 'react'
import { firebaseReady } from '../lib/firebase'
import { loadHabitRemote, saveHabitRemote } from './db'

/* ---------------- Tipos e meta ---------------- */

export type Skill = 'write' | 'speak' | 'listen' | 'vocab'

export const SKILLS: { id: Skill; label: string; emoji: string; unit: string; how: string }[] = [
  { id: 'write', label: 'Escrita', emoji: '✍️', unit: 'frases escritas', how: 'Escreva para o tutor ou refaça uma frase corrigida' },
  { id: 'speak', label: 'Fala', emoji: '🎙️', unit: 'frases faladas', how: 'Responda pelo microfone ou use "Repetir em voz alta"' },
  { id: 'listen', label: 'Escuta', emoji: '🎧', unit: 'frases ouvidas', how: 'Faça o ditado ou responda no modo escuta' },
  { id: 'vocab', label: 'Vocabulário', emoji: '🧠', unit: 'palavras revisadas', how: 'Revise as palavras salvas' },
]

export type Counts = Record<Skill, number>
export type DailyGoal = Counts

export const GOAL_PRESETS: { id: string; label: string; hint: string; goal: DailyGoal }[] = [
  { id: 'light', label: 'Leve', hint: '~10 min', goal: { write: 3, speak: 3, listen: 3, vocab: 5 } },
  { id: 'regular', label: 'Regular', hint: '~20 min', goal: { write: 5, speak: 5, listen: 5, vocab: 10 } },
  { id: 'intense', label: 'Intenso', hint: '~40 min', goal: { write: 10, speak: 10, listen: 10, vocab: 20 } },
]
export const DEFAULT_GOAL = GOAL_PRESETS[1].goal
export const MAX_TARGET = 50

/** Proteções: uma a cada FREEZE_EVERY dias seguidos, guardando no máximo MAX_FREEZES. */
export const FREEZE_EVERY = 7
export const MAX_FREEZES = 2
/** dias guardados no histórico */
const KEEP_DAYS = 120

interface DayLog {
  c: Partial<Counts>
  /** meta cumprida neste dia (nunca volta a false) */
  done?: boolean
}

export interface Habit {
  goal: DailyGoal
  /** ISO da última mudança da meta (na mescla entre aparelhos, a mais nova vence) */
  goalAt: string
  /** chave: dia local "AAAA-MM-DD" */
  log: Record<string, DayLog>
  /** maior ofensiva já alcançada (o histórico antigo é apagado, o recorde não) */
  best: number
}

/* ---------------- Datas (dia local) ---------------- */

const pad = (n: number) => String(n).padStart(2, '0')
export const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

export function addDays(key: string, n: number) {
  const [y, m, d] = key.split('-').map(Number)
  return dayKey(new Date(y, m - 1, d + n))
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

/* ---------------- Validação e mescla ---------------- */

const SKILL_IDS = SKILLS.map((s) => s.id)
const clampCount = (v: unknown, max = 10_000) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(max, Math.floor(v))) : 0

function parseGoal(v: any): DailyGoal | null {
  if (!v || typeof v !== 'object') return null
  const g = Object.fromEntries(SKILL_IDS.map((s) => [s, clampCount(v[s], MAX_TARGET)])) as DailyGoal
  return SKILL_IDS.some((s) => g[s] > 0) ? g : null
}

export function parseHabit(v: any): Habit | null {
  if (!v || typeof v !== 'object') return null
  const log: Record<string, DayLog> = {}
  if (v.log && typeof v.log === 'object') {
    for (const [day, e] of Object.entries<any>(v.log)) {
      if (!DAY_RE.test(day) || !e || typeof e !== 'object') continue
      const c: Partial<Counts> = {}
      for (const s of SKILL_IDS) if (clampCount(e.c?.[s])) c[s] = clampCount(e.c[s])
      log[day] = e.done === true ? { c, done: true } : { c }
    }
  }
  return {
    goal: parseGoal(v.goal) ?? DEFAULT_GOAL,
    goalAt: typeof v.goalAt === 'string' ? v.goalAt : '',
    log,
    best: clampCount(v.best),
  }
}

const emptyHabit = (): Habit => ({ goal: DEFAULT_GOAL, goalAt: '', log: {}, best: 0 })

/** Junta dois históricos: maior contagem de cada habilidade por dia; dia cumprido em qualquer lado vale. */
export function mergeHabit(a: Habit, b: Habit): Habit {
  const log: Record<string, DayLog> = { ...a.log }
  for (const [day, e] of Object.entries(b.log)) {
    const mine = log[day]
    if (!mine) {
      log[day] = e
      continue
    }
    const c: Partial<Counts> = {}
    for (const s of SKILL_IDS) {
      const n = Math.max(mine.c[s] ?? 0, e.c[s] ?? 0)
      if (n) c[s] = n
    }
    log[day] = mine.done || e.done ? { c, done: true } : { c }
  }
  const newer = b.goalAt > a.goalAt ? b : a
  return { goal: newer.goal, goalAt: newer.goalAt, log, best: Math.max(a.best, b.best) }
}

function trim(h: Habit): Habit {
  const oldest = addDays(dayKey(), -KEEP_DAYS)
  const log = Object.fromEntries(Object.entries(h.log).filter(([day]) => day >= oldest))
  return { ...h, log }
}

/* ---------------- Ofensiva ---------------- */

export interface StreakInfo {
  /** dias seguidos (hoje entra quando a meta é cumprida; até lá, conta até ontem) */
  current: number
  best: number
  /** proteções guardadas */
  freezes: number
  /** dias perdidos cobertos por uma proteção */
  frozen: Set<string>
  todayDone: boolean
}

export function computeStreak(h: Habit, today = dayKey()): StreakInfo {
  const days = Object.keys(h.log).filter((d) => d <= today).sort()
  let current = 0
  let best = h.best
  let freezes = 0
  const frozen = new Set<string>()
  if (days.length) {
    for (let d = days[0]; d <= today; d = addDays(d, 1)) {
      if (h.log[d]?.done) {
        current++
        best = Math.max(best, current)
        if (current % FREEZE_EVERY === 0) freezes = Math.min(MAX_FREEZES, freezes + 1)
      } else if (d === today) {
        // hoje ainda está em andamento: não quebra a ofensiva
      } else if (current > 0 && freezes > 0) {
        freezes--
        frozen.add(d)
      } else {
        current = 0
      }
    }
  }
  return { current, best, freezes, frozen, todayDone: !!h.log[today]?.done }
}

/* ---------------- Meta do dia ---------------- */

/** Vocabulário conta como cumprido quando não há nada pendente para revisar (não dá para revisar o que não existe). */
let vocabCleared = false

export const skillMet = (goal: DailyGoal, c: Partial<Counts>, s: Skill) =>
  goal[s] === 0 || (c[s] ?? 0) >= goal[s] || (s === 'vocab' && vocabCleared)

export const isVocabCleared = () => vocabCleared

function goalMet(goal: DailyGoal, c: Partial<Counts>) {
  const active = SKILL_IDS.some((s) => (c[s] ?? 0) > 0)
  return active && SKILL_IDS.every((s) => skillMet(goal, c, s))
}

/* ---------------- Armazenamento local e eventos ---------------- */

const STORAGE = 'tutor_habit_v1'
/** qualquer mudança (atualiza a tela) */
const CHANGED = 'tutor-habit-changed'
/** mudança feita neste aparelho (dispara o envio para a nuvem) */
const EDITED = 'tutor-habit-edited'
/** a meta de hoje acabou de ser cumprida */
export const GOAL_DONE = 'tutor-habit-goal-done'

export function loadHabit(): Habit {
  try {
    return parseHabit(JSON.parse(localStorage.getItem(STORAGE) ?? 'null')) ?? emptyHabit()
  } catch {
    return emptyHabit()
  }
}

function writeHabit(h: Habit, edited: boolean) {
  try {
    localStorage.setItem(STORAGE, JSON.stringify(trim(h)))
  } catch {
    /* modo privado / storage cheio */
  }
  window.dispatchEvent(new Event(CHANGED))
  if (edited) window.dispatchEvent(new Event(EDITED))
}

/** Marca hoje como cumprido se a meta foi atingida; avisa a tela na primeira vez. */
function settleToday(h: Habit): Habit {
  const today = dayKey()
  const e = h.log[today] ?? { c: {} }
  if (e.done || !goalMet(h.goal, e.c)) return h
  const next = { ...h, log: { ...h.log, [today]: { ...e, done: true } } }
  const { current } = computeStreak(next, today)
  next.best = Math.max(next.best, current)
  window.setTimeout(() => window.dispatchEvent(new CustomEvent(GOAL_DONE, { detail: current })), 0)
  return next
}

/** Soma `n` atividades de uma habilidade no dia de hoje. */
export function recordActivity(skill: Skill, n = 1) {
  const h = loadHabit()
  const today = dayKey()
  const e = h.log[today] ?? { c: {} }
  const c = { ...e.c, [skill]: (e.c[skill] ?? 0) + n }
  writeHabit(settleToday({ ...h, log: { ...h.log, [today]: { ...e, c } } }), true)
}

export function setDailyGoal(goal: DailyGoal) {
  const parsed = parseGoal(goal)
  if (!parsed) return
  writeHabit(settleToday({ ...loadHabit(), goal: parsed, goalAt: new Date().toISOString() }), true)
}

/** Informado pelo App sempre que muda o número de palavras pendentes de revisão. */
export function setVocabCleared(cleared: boolean) {
  if (cleared === vocabCleared) return
  vocabCleared = cleared
  const h = loadHabit()
  const settled = settleToday(h)
  writeHabit(settled, settled !== h)
}

/* ---------------- Hook ---------------- */

export interface HabitView {
  habit: Habit
  today: Partial<Counts>
  streak: StreakInfo
}

function view(): HabitView {
  const habit = loadHabit()
  return { habit, today: habit.log[dayKey()]?.c ?? {}, streak: computeStreak(habit) }
}

/**
 * Meta e ofensiva em tempo real. Com login, mescla com a nuvem ao entrar e envia cada mudança
 * deste aparelho (agrupada em alguns segundos), relendo a nuvem antes de gravar.
 */
export function useHabit(uid: string | null): HabitView {
  const [state, setState] = useState(view)

  useEffect(() => {
    const sync = () => setState(view())
    // virada do dia com o app aberto: recalcula a cada minuto
    const tick = window.setInterval(sync, 60_000)
    const onStorage = (e: StorageEvent) => e.key === STORAGE && sync()
    window.addEventListener(CHANGED, sync)
    window.addEventListener('storage', onStorage)
    return () => {
      window.clearInterval(tick)
      window.removeEventListener(CHANGED, sync)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  useEffect(() => {
    if (!uid || !firebaseReady()) return
    let cancelled = false
    let timer: number | undefined

    const push = async () => {
      try {
        const remote = parseHabit(await loadHabitRemote(uid))
        if (cancelled) return
        const local = loadHabit()
        const merged = settleToday(remote ? mergeHabit(local, remote) : local)
        writeHabit(merged, false)
        await saveHabitRemote(uid, trim(merged))
      } catch (e) {
        console.warn('[habit] falha ao sincronizar', e)
      }
    }

    void push()
    const onEdit = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(push, 3000)
    }
    window.addEventListener(EDITED, onEdit)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      window.removeEventListener(EDITED, onEdit)
    }
  }, [uid])

  return state
}
