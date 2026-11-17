// Foco do aluno e cenários de conversa (role-play).
// O servidor recebe só o id do cenário: a descrição que entra no prompt fica em backend/app/scenarios.py
// (mesmos ids). Aqui ficam o que aparece na tela: título, a frase que abre a conversa e as primeiras
// sugestões de resposta (as seguintes vêm do tutor a cada mensagem).
import type { Suggestion } from './tutor'

/* ---------------- Foco ---------------- */

export type Goal = 'work' | 'general'

export const GOALS: { id: Goal; label: string }[] = [
  { id: 'work', label: 'Trabalho' },
  { id: 'general', label: 'Dia a dia' },
]

export const isGoal = (v: unknown): v is Goal => GOALS.some((g) => g.id === v)

export const MAX_PROFESSION = 80

/* ---------------- Cenários ---------------- */

export interface Scenario {
  id: string
  group: Goal
  emoji: string
  title: string
  /** o que o aluno pratica, em português */
  hint: string
  /** primeira fala do tutor */
  opening: string
  openingTranslation: string
  /** respostas possíveis à abertura, em nível iniciante */
  starters: Suggestion[]
}

/** Conversa livre: não manda cenário ao servidor. */
export const FREE = 'free'

export const SCENARIOS: Scenario[] = [
  {
    id: FREE,
    group: 'general',
    emoji: '💬',
    title: 'Conversa livre',
    hint: 'Fale sobre o seu dia',
    opening: "Hi there! 👋 I'm your English tutor. How was your day today?",
    openingTranslation: 'Olá! 👋 Eu sou seu professor de inglês. Como foi o seu dia hoje?',
    starters: [
      { text: 'My day was good.', translation: 'Meu dia foi bom.' },
      { text: 'I worked a lot today.', translation: 'Trabalhei muito hoje.' },
      { text: 'I am tired today.', translation: 'Estou cansado hoje.' },
    ],
  },
  {
    id: 'work_intro',
    group: 'work',
    emoji: '👋',
    title: 'Apresentar-se ao time',
    hint: 'Dizer quem você é e o que faz',
    opening: 'Hi! Welcome to the team. 👋 What is your name, and what do you do?',
    openingTranslation: 'Oi! Bem-vindo ao time. 👋 Qual é o seu nome e o que você faz?',
    starters: [
      { text: 'My name is … and I am a solutions architect.', translation: 'Meu nome é … e sou arquiteto de soluções.' },
      { text: 'I design software systems.', translation: 'Eu projeto sistemas de software.' },
      { text: 'I work with cloud projects.', translation: 'Eu trabalho com projetos de nuvem.' },
    ],
  },
  {
    id: 'work_standup',
    group: 'work',
    emoji: '📅',
    title: 'Daily (stand-up)',
    hint: 'Ontem, hoje e impedimentos',
    opening: "Good morning! Let's start the daily. What did you do yesterday?",
    openingTranslation: 'Bom dia! Vamos começar a daily. O que você fez ontem?',
    starters: [
      { text: 'Yesterday I worked on the design document.', translation: 'Ontem trabalhei no documento de design.' },
      { text: 'Yesterday I had a meeting with the client.', translation: 'Ontem tive uma reunião com o cliente.' },
      { text: 'I finished the architecture diagram.', translation: 'Terminei o diagrama de arquitetura.' },
    ],
  },
  {
    id: 'work_explain',
    group: 'work',
    emoji: '🧩',
    title: 'Explicar uma solução',
    hint: 'Descrever a arquitetura para quem não é técnico',
    opening: "I'm not a technical person. 🙂 Can you explain how your solution works?",
    openingTranslation: 'Eu não sou da área técnica. 🙂 Você pode explicar como a sua solução funciona?',
    starters: [
      { text: 'Sure. The system has three parts.', translation: 'Claro. O sistema tem três partes.' },
      { text: 'The user opens the app and sends a request.', translation: 'O usuário abre o app e envia uma requisição.' },
      { text: 'The data is stored in the cloud.', translation: 'Os dados ficam armazenados na nuvem.' },
    ],
  },
  {
    id: 'work_requirements',
    group: 'work',
    emoji: '📝',
    title: 'Reunião com o cliente',
    hint: 'Fazer perguntas para levantar requisitos',
    opening: 'Hello! We need a new system for our company. What do you need to know?',
    openingTranslation: 'Olá! Precisamos de um novo sistema para a nossa empresa. O que você precisa saber?',
    starters: [
      { text: 'How many users will use the system?', translation: 'Quantos usuários vão usar o sistema?' },
      { text: 'What is the main problem today?', translation: 'Qual é o principal problema hoje?' },
      { text: 'When do you need it?', translation: 'Para quando vocês precisam?' },
    ],
  },
  {
    id: 'work_tradeoffs',
    group: 'work',
    emoji: '⚖️',
    title: 'Defender uma decisão',
    hint: 'Custo, escala, segurança, prazo',
    opening: 'I read your proposal. Why did you choose this solution?',
    openingTranslation: 'Li a sua proposta. Por que você escolheu essa solução?',
    starters: [
      { text: 'Because it is cheaper.', translation: 'Porque é mais barata.' },
      { text: 'Because it is easier to scale.', translation: 'Porque é mais fácil de escalar.' },
      { text: 'It is more secure for our data.', translation: 'É mais segura para os nossos dados.' },
    ],
  },
  {
    id: 'work_incident',
    group: 'work',
    emoji: '🚨',
    title: 'Incidente em produção',
    hint: 'Dar status: o que houve e próximos passos',
    opening: 'The system is down! 😟 What happened?',
    openingTranslation: 'O sistema caiu! 😟 O que aconteceu?',
    starters: [
      { text: 'We are investigating the problem.', translation: 'Estamos investigando o problema.' },
      { text: 'The database is not responding.', translation: 'O banco de dados não está respondendo.' },
      { text: 'We will fix it in one hour.', translation: 'Vamos corrigir em uma hora.' },
    ],
  },
  {
    id: 'work_interview',
    group: 'work',
    emoji: '🤝',
    title: 'Entrevista de emprego',
    hint: 'Falar da sua experiência',
    opening: 'Thanks for coming today. Can you tell me about yourself?',
    openingTranslation: 'Obrigado por vir hoje. Você pode me falar sobre você?',
    starters: [
      { text: 'I am a solutions architect from Brazil.', translation: 'Sou arquiteto de soluções, do Brasil.' },
      { text: 'I have ten years of experience.', translation: 'Tenho dez anos de experiência.' },
      { text: 'I like to solve complex problems.', translation: 'Gosto de resolver problemas complexos.' },
    ],
  },
  {
    id: 'restaurant',
    group: 'general',
    emoji: '🍽️',
    title: 'No restaurante',
    hint: 'Fazer um pedido',
    opening: 'Good evening! Welcome. 🍽️ Are you ready to order?',
    openingTranslation: 'Boa noite! Bem-vindo. 🍽️ Você já quer fazer o pedido?',
    starters: [
      { text: 'Yes, I would like a pizza, please.', translation: 'Sim, eu gostaria de uma pizza, por favor.' },
      { text: 'Can I see the menu, please?', translation: 'Posso ver o cardápio, por favor?' },
      { text: 'What do you recommend?', translation: 'O que você recomenda?' },
    ],
  },
  {
    id: 'travel',
    group: 'general',
    emoji: '✈️',
    title: 'No aeroporto',
    hint: 'Fazer o check-in',
    opening: 'Good morning! ✈️ Where are you flying today?',
    openingTranslation: 'Bom dia! ✈️ Para onde você vai voar hoje?',
    starters: [
      { text: 'I am flying to New York.', translation: 'Vou voar para Nova York.' },
      { text: 'I am traveling for work.', translation: 'Estou viajando a trabalho.' },
      { text: 'Here is my passport.', translation: 'Aqui está o meu passaporte.' },
    ],
  },
]

export const getScenario = (id: string): Scenario => SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0]

/** Cenários do foco do aluno primeiro; a conversa livre sempre abre a lista. */
export function scenariosFor(goal: Goal): Scenario[] {
  const rank = (s: Scenario) => (s.id === FREE ? 0 : s.group === goal ? 1 : 2)
  return [...SCENARIOS].sort((a, b) => rank(a) - rank(b))
}
