import type { Suggestion } from '../services/tutor'

interface Props {
  suggestions: Suggestion[]
  /** coloca a frase no campo de texto, para o aluno adaptar e enviar */
  onPick: (text: string) => void
}

/** Ideias de resposta para a última mensagem do tutor: tocar leva a frase para o campo de texto. */
export default function Suggestions({ suggestions, onPick }: Props) {
  if (!suggestions.length) return null
  return (
    <section aria-label="Sugestões de resposta" className="flex flex-col items-end gap-1.5 pt-1 animate-in">
      <p className="px-1 text-xs text-zinc-400">Não sabe o que dizer? Toque numa ideia e adapte.</p>
      {suggestions.map((s) => (
        <button
          key={s.text}
          type="button"
          onClick={() => onPick(s.text)}
          className="max-w-[85%] rounded-2xl rounded-br-lg bg-blue-50 px-3.5 py-2 text-left ring-1 ring-blue-200/70 transition-all duration-300 ease-out hover:bg-blue-100 active:scale-[0.98] sm:max-w-[70%]"
        >
          <span lang="en" className="block text-[14.5px] leading-snug text-blue-700">{s.text}</span>
          {s.translation && (
            <span lang="pt-BR" className="mt-0.5 block text-xs leading-snug text-zinc-500">{s.translation}</span>
          )}
        </button>
      ))}
      <p className="px-1 text-xs text-zinc-400">Ou escreva em português: eu mostro como se diz.</p>
    </section>
  )
}
