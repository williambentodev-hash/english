// Frases do ditado (treino de escuta).
// Fontes, nesta ordem de prioridade: as versões nativas das correções do próprio aluno (frases que
// ele quis dizer) e uma lista fixa por foco. Sem números escritos em algarismos: o aluno digitaria
// "ten" ou "10" e as duas formas estariam certas.
import type { CorrectionEntry } from './stats'
import type { Goal } from './scenarios'

export interface DictationItem {
  text: string
  translation: string | null
  /** veio de uma correção do aluno */
  mine: boolean
}

const WORK: [string, string][] = [
  ['I am a solutions architect.', 'Eu sou arquiteto de soluções.'],
  ['We need to talk about the requirements.', 'Precisamos falar sobre os requisitos.'],
  ['The system has three main components.', 'O sistema tem três componentes principais.'],
  ['Can you share your screen, please?', 'Você pode compartilhar a sua tela, por favor?'],
  ['I will send you the diagram today.', 'Vou te enviar o diagrama hoje.'],
  ['What is the deadline for this project?', 'Qual é o prazo deste projeto?'],
  ['The database is running in the cloud.', 'O banco de dados está rodando na nuvem.'],
  ['This solution is cheaper and easier to scale.', 'Esta solução é mais barata e mais fácil de escalar.'],
  ['We have a problem in production.', 'Temos um problema em produção.'],
  ['The team is working on a fix.', 'O time está trabalhando numa correção.'],
  ['Let me explain how it works.', 'Deixa eu explicar como funciona.'],
  ['How many users will use the system?', 'Quantos usuários vão usar o sistema?'],
  ['I agree, but we need more time.', 'Concordo, mas precisamos de mais tempo.'],
  ['The service sends a message to the queue.', 'O serviço envia uma mensagem para a fila.'],
  ['We should add a cache to improve performance.', 'Deveríamos adicionar um cache para melhorar a performance.'],
  ['Security is very important for this client.', 'Segurança é muito importante para este cliente.'],
  ['Yesterday I finished the proposal.', 'Ontem terminei a proposta.'],
  ['Today I will review the architecture.', 'Hoje vou revisar a arquitetura.'],
  ['I am blocked because I need access.', 'Estou bloqueado porque preciso de acesso.'],
  ['Could you repeat that, please?', 'Você poderia repetir, por favor?'],
  ['The API returns the data in JSON.', 'A API retorna os dados em JSON.'],
  ['We can deploy the new version next week.', 'Podemos implantar a nova versão na semana que vem.'],
  ['What are the main risks of this approach?', 'Quais são os principais riscos dessa abordagem?'],
  ['The trade-off is cost versus speed.', 'O trade-off é custo contra velocidade.'],
  ['Let me check and get back to you.', 'Deixa eu verificar e te retorno.'],
  ['The meeting starts in five minutes.', 'A reunião começa em cinco minutos.'],
  ['I think we should use microservices here.', 'Acho que deveríamos usar microsserviços aqui.'],
  ['The load balancer distributes the traffic.', 'O balanceador de carga distribui o tráfego.'],
]

const GENERAL: [string, string][] = [
  ['How was your weekend?', 'Como foi o seu fim de semana?'],
  ['I would like a coffee, please.', 'Eu gostaria de um café, por favor.'],
  ['Where is the nearest station?', 'Onde fica a estação mais próxima?'],
  ['I am flying to London tomorrow.', 'Vou voar para Londres amanhã.'],
  ['Can I pay by card?', 'Posso pagar com cartão?'],
  ['I live in Brazil with my family.', 'Eu moro no Brasil com a minha família.'],
  ['What do you do in your free time?', 'O que você faz no seu tempo livre?'],
  ['It is very hot today.', 'Está muito quente hoje.'],
  ['I did not understand. Can you speak slowly?', 'Não entendi. Você pode falar devagar?'],
  ['Nice to meet you.', 'Prazer em conhecer você.'],
]

const words = (s: string) => s.split(/\s+/).filter(Boolean).length

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/**
 * Monta uma sessão de `count` frases: até metade vem das correções do aluno (as mais recentes,
 * com tamanho bom para ditado), o resto da lista do foco dele, embaralhado.
 */
export function buildDictation(corrections: CorrectionEntry[], goal: Goal, count = 8): DictationItem[] {
  const seen = new Set<string>()
  const mine: DictationItem[] = []
  for (const c of corrections) {
    const text = c.native.trim()
    const key = text.toLowerCase()
    // frases de 3 a 14 palavras, sem algarismos e sem repetir
    if (words(text) < 3 || words(text) > 14 || /\d/.test(text) || seen.has(key)) continue
    seen.add(key)
    mine.push({ text, translation: null, mine: true })
    if (mine.length >= Math.floor(count / 2)) break
  }
  const pool = goal === 'work' ? [...WORK, ...GENERAL.slice(0, 3)] : [...GENERAL, ...WORK.slice(0, 10)]
  const fixed = shuffle(pool)
    .filter(([text]) => !seen.has(text.toLowerCase()))
    .slice(0, count - mine.length)
    .map(([text, translation]) => ({ text, translation, mine: false }))
  return shuffle([...mine, ...fixed])
}
