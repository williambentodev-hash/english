// Comparação palavra a palavra entre a frase esperada e o que o aluno disse (reconhecimento de voz).

/** Forma de comparação de uma palavra: minúscula, sem pontuação nem apóstrofos ("I'm" → "im"). */
const key = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

export interface WordMatch {
  /** palavra como aparece na frase esperada (com pontuação) */
  word: string
  /** foi reconhecida na fala */
  ok: boolean
}

/**
 * Marca quais palavras da frase esperada aparecem, na ordem, no que foi ouvido (maior subsequência
 * comum). Palavras ditas a mais não penalizam; as que faltaram ou saíram diferentes ficam com ok=false.
 */
export function matchWords(expected: string, heard: string): WordMatch[] {
  const words = expected.split(/\s+/).filter(Boolean)
  const exp = words.map(key)
  const got = heard.split(/\s+/).map(key).filter(Boolean)
  const n = exp.length
  const m = got.length
  // tabela da LCS (frases curtas: no máximo algumas dezenas de palavras)
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = exp[i] && exp[i] === got[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const ok = new Array<boolean>(n).fill(false)
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (exp[i] && exp[i] === got[j]) {
      ok[i] = true
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++
    else j++
  }
  // "palavras" só de pontuação (ex.: "—") não contam como erro
  return words.map((word, k) => ({ word, ok: ok[k] || !exp[k] }))
}

/** Fração de palavras reconhecidas (0 a 1). */
export const matchScore = (m: WordMatch[]) => (m.length ? m.filter((w) => w.ok).length / m.length : 0)
