// Revisão espaçada (sistema de Leitner) do vocabulário salvo.
// Cada palavra fica numa "caixa". Acertar sobe uma caixa e adia a próxima revisão; errar volta
// para a caixa 0 (revisa de novo na mesma sessão e no dia seguinte). Passar da última caixa
// marca a palavra como aprendida, e ela sai da revisão.

/** Dias até a próxima revisão ao chegar em cada caixa (índice = caixa - 1). */
export const INTERVAL_DAYS = [1, 3, 7, 16, 35, 90] as const
/** Caixa a partir da qual a palavra é considerada aprendida. */
export const MASTERED_BOX = INTERVAL_DAYS.length
/** Caixas em que o cartão pede para produzir a palavra (português → inglês) em vez de reconhecê-la. */
export const PRODUCE_FROM_BOX = 2

const DAY_MS = 86_400_000

export interface ReviewState {
  /** 0 = palavra nova ou errada recentemente */
  box: number
  /** ISO da próxima revisão; null = nunca revisada (já está pendente) */
  due: string | null
  learned: boolean
}

export const isDue = (s: ReviewState, now = Date.now()) =>
  !s.learned && (s.due === null || Date.parse(s.due) <= now)

/**
 * Início do dia da revisão (4h, horário local): a palavra fica disponível o dia todo, não só a partir
 * da hora exata em que foi revisada. 4h e não 0h: quem estuda de madrugada não antecipa a do dia seguinte.
 */
function dueAt(days: number, now: number) {
  const d = new Date(now + days * DAY_MS)
  d.setHours(4, 0, 0, 0)
  return d.toISOString()
}

/** Próximo estado depois de uma resposta. */
export function schedule(s: ReviewState, correct: boolean, now = Date.now()): ReviewState {
  if (!correct) return { box: 0, due: new Date(now).toISOString(), learned: false }
  const box = Math.min(s.box + 1, MASTERED_BOX)
  return { box, due: dueAt(INTERVAL_DAYS[box - 1], now), learned: box >= MASTERED_BOX }
}

/** Em quantos dias a palavra volta se o aluno acertar agora. */
export const nextIntervalDays = (s: ReviewState) => INTERVAL_DAYS[Math.min(s.box, MASTERED_BOX - 1)]

export function fmtInterval(days: number) {
  if (days === 1) return 'amanhã'
  if (days < 30) return `em ${days} dias`
  const months = Math.round(days / 30)
  return months === 1 ? 'em 1 mês' : `em ${months} meses`
}
