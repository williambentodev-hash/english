"""Agente de exercícios.

Em vez de um prompt único, o modelo recebe ferramentas para investigar o histórico do aluno
(categorias de erro, exemplos, busca por similaridade) e decide o que consultar antes de
entregar os exercícios pela ferramenta `submit_exercises`. O laço é curto e limitado:
no último passo o modelo é obrigado a entregar.
"""
import json
import logging
from typing import Any

from pydantic import ValidationError

from .llm import GroqClient, LLMError, ToolCallError
from .memory import MistakeMemory, PastMistake
from .schemas import Exercise, Level, WeakSpot
from .tags import ERROR_TAGS

log = logging.getLogger(__name__)

MAX_STEPS = 5
# quantas vezes toleramos o modelo errar o formato de uma chamada de ferramenta
MAX_FORMAT_ERRORS = 2

SYSTEM = """You design short practice exercises for one English learner whose native language is Brazilian Portuguese.

Work in two phases:
1. INVESTIGATE the learner's real weak points with the tools: start with list_weak_spots, then look at concrete examples with get_mistakes (and search_mistakes if you want mistakes about a specific topic or structure).
2. Call submit_exercises ONCE with the exercises. Never answer in plain text.

If the learner has no recorded mistakes yet, base the exercises on their level and on common mistakes of Brazilian learners.

Exercise rules:
- Target the learner's most frequent mistake categories first; cover at least two categories when the history has them.
- Mix both types:
  - "choice": "prompt" is a NEW English sentence with exactly one gap written as ___ ; "options" has 3 or 4 short alternatives; "answer" is the correct option, copied exactly.
  - "rewrite": "prompt" is an English sentence containing ONE mistake of the kind this learner makes (you may adapt their own sentences); "answer" is the corrected sentence.
- "instruction": one short line in Brazilian Portuguese telling the learner what to do.
- "explanation": 1-2 sentences in Brazilian Portuguese explaining the rule behind the answer.
- "tag": the mistake category id the exercise trains.
- Match vocabulary and sentence length to the learner's level.
- Before submitting, verify every exercise: the sentence with "answer" filled in must be fully correct and natural, no other option may also be correct, and a "rewrite" prompt must contain a real grammar or word mistake (not a typo)."""


def _function(name: str, description: str, properties: dict[str, Any], required: list[str]) -> dict[str, Any]:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": {"type": "object", "properties": properties, "required": required},
        },
    }


_TAG_PARAM = {"type": "string", "enum": list(ERROR_TAGS), "description": "Mistake category id."}

TOOLS = [
    _function(
        "list_weak_spots",
        "Mistake categories this learner gets wrong, with how many times, most frequent first.",
        {},
        [],
    ),
    _function(
        "get_mistakes",
        "Real sentences this learner got wrong (most repeated first), with the correct version.",
        {"tag": {**_TAG_PARAM, "description": "Only mistakes of this category. Omit for all categories."}},
        [],
    ),
    _function(
        "search_mistakes",
        "Search this learner's past mistakes by meaning, e.g. a topic or an example sentence.",
        {"query": {"type": "string", "description": "English sentence or topic to look for."}},
        ["query"],
    ),
    _function(
        "submit_exercises",
        "Deliver the final exercises. Call exactly once, after investigating.",
        {
            "exercises": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "type": {"type": "string", "enum": ["choice", "rewrite"]},
                        "tag": _TAG_PARAM,
                        "instruction": {"type": "string", "description": "Brazilian Portuguese."},
                        "prompt": {"type": "string", "description": "English. Has ___ when type is choice."},
                        "options": {"type": "array", "items": {"type": "string"}, "description": "Only for choice."},
                        "answer": {"type": "string"},
                        "explanation": {"type": "string", "description": "Brazilian Portuguese."},
                    },
                    "required": ["type", "tag", "instruction", "prompt", "answer", "explanation"],
                },
            }
        },
        ["exercises"],
    ),
]

_SUBMIT = {"type": "function", "function": {"name": "submit_exercises"}}


def _mistake(m: PastMistake) -> dict[str, Any]:
    return {"learner_wrote": m.said[:300], "correct": m.native[:300], "categories": m.tags, "times": m.times}


class MistakeTools:
    """Ferramentas de consulta ao histórico de UM aluno (o uid vem do login, nunca do modelo)."""

    def __init__(self, memory: MistakeMemory | None, uid: str, app_weak_spots: list[WeakSpot]):
        self._memory = memory
        self._uid = uid
        self._app_weak_spots = app_weak_spots

    async def run(self, name: str, args: dict[str, Any]) -> Any:
        try:
            if name == "list_weak_spots":
                return await self._weak_spots()
            if name == "get_mistakes":
                tag = args.get("tag")
                return await self._mistakes(tag if tag in ERROR_TAGS else None)
            if name == "search_mistakes":
                return await self._search(str(args.get("query") or "")[:300])
            return {"error": f"unknown tool {name}"}
        except Exception:
            # banco ou embeddings fora do ar: o agente segue sem o histórico
            log.warning("agente: ferramenta %s falhou", name, exc_info=True)
            return {"error": "history unavailable right now; continue without it"}

    async def _weak_spots(self) -> dict[str, Any]:
        counts = await self._memory.weak_spots(self._uid) if self._memory else []
        if not counts:
            # sem memória no servidor ainda: usa a contagem que o app mantém
            counts = [(w.tag, w.count) for w in self._app_weak_spots]
        return {"weak_spots": [{"tag": t, "meaning": ERROR_TAGS.get(t, t), "mistakes": n} for t, n in counts]}

    async def _mistakes(self, tag: str | None) -> dict[str, Any]:
        found = await self._memory.examples(self._uid, tag, limit=6) if self._memory else []
        return {"mistakes": [_mistake(m) for m in found]}

    async def _search(self, query: str) -> dict[str, Any]:
        found = await self._memory.search(self._uid, query, limit=5) if self._memory and query else []
        return {"mistakes": [_mistake(m) for m in found]}


def _parse_exercises(args: dict[str, Any], count: int) -> tuple[list[Exercise], list[str]]:
    """Separa os exercícios válidos dos problemas encontrados (devolvidos ao modelo para corrigir)."""
    valid: list[Exercise] = []
    problems: list[str] = []
    items = args.get("exercises")
    for i, item in enumerate(items if isinstance(items, list) else []):
        try:
            valid.append(Exercise.model_validate(item))
        except ValidationError as e:
            problems.append(f"exercise {i + 1}: {e.errors()[0]['msg']}")
    return valid[:count], problems


def _arguments(call: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    function = call.get("function") if isinstance(call.get("function"), dict) else {}
    try:
        args = json.loads(function.get("arguments") or "{}")
    except (TypeError, ValueError):
        args = {}
    return str(function.get("name") or ""), args if isinstance(args, dict) else {}


async def generate_exercises(llm: GroqClient, tools: MistakeTools, level: Level, count: int) -> list[Exercise]:
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": SYSTEM},
        {"role": "user", "content": f"Learner level: {level}. Create {count} exercises."},
    ]
    format_errors = 0
    # o agente precisa olhar frases reais do aluno antes de entregar
    investigated = False
    step = 0
    while step < MAX_STEPS:
        # no último passo não há mais investigação: o modelo é obrigado a entregar
        last = step == MAX_STEPS - 1
        try:
            message = await llm.chat(messages, TOOLS, tool_choice=_SUBMIT if last else "required")
        except ToolCallError:
            format_errors += 1
            if format_errors > MAX_FORMAT_ERRORS:
                break
            continue
        step += 1

        calls = message["tool_calls"]
        # só o que a API aceita de volta (o provedor pode devolver campos extras, como o raciocínio)
        messages.append({"role": "assistant", "content": message.get("content") or "", "tool_calls": calls})
        for call in calls:
            name, args = _arguments(call)
            result: Any
            if name != "submit_exercises":
                investigated = investigated or name in ("get_mistakes", "search_mistakes")
                result = await tools.run(name, args)
            elif not investigated and not last:
                # entrega precipitada: devolve o trabalho uma vez
                investigated = True
                result = {"error": "Too early. Call get_mistakes first to see this learner's real sentences, then submit."}
            else:
                exercises, problems = _parse_exercises(args, count)
                if exercises:
                    return exercises
                result = {"error": "no valid exercise", "problems": problems[:5] or ["empty list"]}
            messages.append(
                {"role": "tool", "tool_call_id": call.get("id", ""), "content": json.dumps(result, ensure_ascii=False)}
            )

    log.warning("agente: terminou sem exercícios válidos")
    raise LLMError("Não foi possível gerar os exercícios agora. Tente de novo.")


# ---------------- correção de resposta escrita ----------------

CHECK_SYSTEM = """You grade one answer of an English exercise for a Brazilian learner.
The learner had to rewrite an incorrect sentence correctly. You get the incorrect SENTENCE, one EXPECTED correct version, and the learner's ANSWER.
Accept the ANSWER if it is grammatically correct, fixes the mistake and keeps the meaning — it does not need to match EXPECTED word for word. Ignore capitalization and final punctuation.
Respond ONLY with JSON: {"correct":<true or false>,"feedback":<one short sentence in Brazilian Portuguese: what is still wrong, or a brief confirmation>}"""


def build_check_messages(prompt: str, expected: str, answer: str) -> list[dict[str, str]]:
    return [
        {"role": "system", "content": CHECK_SYSTEM},
        {"role": "user", "content": f"SENTENCE: {prompt}\nEXPECTED: {expected}\nANSWER: {answer}"},
    ]
