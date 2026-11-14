import json

import pytest

from app.agent import MAX_STEPS, MistakeTools, generate_exercises
from app.deps import get_memory
from app.llm import LLMError, ToolCallError
from app.main import app
from app.memory import PastMistake
from app.parsing import parse_check_result
from app.schemas import Exercise, WeakSpot

CHOICE = {
    "type": "choice",
    "tag": "verb_tense",
    "instruction": "Complete a frase.",
    "prompt": "She ___ to the meeting yesterday.",
    "options": ["go", "went", "goes"],
    "answer": "went",
    "explanation": "Ação terminada no passado: passado simples.",
}
REWRITE = {
    "type": "rewrite",
    "tag": "verb_form",
    "instruction": "Corrija a frase.",
    "prompt": "She don't like movies.",
    "answer": "She doesn't like movies.",
    "explanation": "Terceira pessoa do singular usa doesn't.",
}


def call(name, **args):
    return {"id": f"call_{name}", "type": "function", "function": {"name": name, "arguments": json.dumps(args)}}


class ScriptedLLM:
    """Devolve, a cada passo, as chamadas de ferramenta roteirizadas; guarda o que recebeu."""

    def __init__(self, *steps, check='{"correct":true,"feedback":"Boa!"}'):
        self.steps = list(steps)
        self.check = check
        self.requests: list[dict] = []

    async def chat(self, messages, tools, tool_choice="required", **_):
        self.requests.append({"messages": [dict(m) for m in messages], "tool_choice": tool_choice})
        step = self.steps.pop(0) if self.steps else [call("list_weak_spots")]
        if isinstance(step, Exception):
            raise step
        return {"role": "assistant", "content": None, "reasoning": "campo extra do provedor", "tool_calls": step}

    async def complete(self, messages, max_tokens):
        self.requests.append({"messages": messages})
        return self.check


class FakeMemory:
    def __init__(self, error=None):
        self.error = error
        self.calls = []

    async def weak_spots(self, uid):
        self.calls.append(("weak_spots", uid))
        if self.error:
            raise self.error
        return [("verb_tense", 3)]

    async def examples(self, uid, tag=None, limit=5):
        self.calls.append(("examples", uid, tag))
        return [PastMistake("I go yesterday", "c", "I went yesterday.", ["verb_tense"], 3)]

    async def search(self, uid, query, limit=5):
        self.calls.append(("search", uid, query))
        return []


def tool_results(llm):
    return [json.loads(m["content"]) for m in llm.requests[-1]["messages"] if m["role"] == "tool"]


@pytest.mark.anyio
async def test_agent_investigates_then_submits():
    llm = ScriptedLLM(
        [call("list_weak_spots")],
        [call("get_mistakes", tag="verb_tense")],
        [call("submit_exercises", exercises=[CHOICE, REWRITE])],
    )
    memory = FakeMemory()
    exercises = await generate_exercises(llm, MistakeTools(memory, "user-1", []), "beginner", 5)

    assert [e.type for e in exercises] == ["choice", "rewrite"]
    # as ferramentas consultaram só o aluno logado, com os argumentos do modelo
    assert memory.calls == [("weak_spots", "user-1"), ("examples", "user-1", "verb_tense")]
    # o resultado de cada ferramenta voltou para o modelo
    assert tool_results(llm) == [
        {"weak_spots": [{"tag": "verb_tense", "meaning": "wrong tense (past, present, future, perfect, continuous)", "mistakes": 3}]},
        {"mistakes": [{"learner_wrote": "I go yesterday", "correct": "I went yesterday.", "categories": ["verb_tense"], "times": 3}]},
    ]
    # a mensagem do modelo volta sem campos que a API não aceita
    assistant = next(m for m in llm.requests[-1]["messages"] if m["role"] == "assistant")
    assert set(assistant) == {"role", "content", "tool_calls"}
    assert "Learner level: beginner. Create 5 exercises." in llm.requests[0]["messages"][1]["content"]


@pytest.mark.anyio
async def test_submitting_before_looking_at_examples_is_sent_back_once():
    llm = ScriptedLLM(
        [call("submit_exercises", exercises=[CHOICE])],
        [call("submit_exercises", exercises=[CHOICE])],
    )
    exercises = await generate_exercises(llm, MistakeTools(None, "u", []), "beginner", 5)
    assert len(exercises) == 1
    assert "Too early" in tool_results(llm)[0]["error"]


@pytest.mark.anyio
async def test_invalid_exercises_are_dropped_and_count_is_respected():
    bad_answer = {**CHOICE, "answer": "gone"}  # não está nas opções
    no_gap = {**CHOICE, "prompt": "She went to the meeting."}
    same = {**REWRITE, "answer": "she don't like movies"}  # não corrigiu nada
    llm = ScriptedLLM(
        [call("get_mistakes")],
        [call("submit_exercises", exercises=[bad_answer, CHOICE, no_gap, same, REWRITE, CHOICE])],
    )
    exercises = await generate_exercises(llm, MistakeTools(None, "u", []), "beginner", 2)
    assert [e.type for e in exercises] == ["choice", "rewrite"]


@pytest.mark.anyio
async def test_all_invalid_goes_back_to_the_model_with_the_problems():
    llm = ScriptedLLM(
        [call("get_mistakes")],
        [call("submit_exercises", exercises=[{**CHOICE, "answer": "gone"}])],
        [call("submit_exercises", exercises=[CHOICE])],
    )
    assert len(await generate_exercises(llm, MistakeTools(None, "u", []), "beginner", 3)) == 1
    error = tool_results(llm)[-1]
    assert error["error"] == "no valid exercise"
    assert "exercise 1" in error["problems"][0]


@pytest.mark.anyio
async def test_last_step_forces_the_delivery_and_then_gives_up():
    llm = ScriptedLLM()  # só investiga, nunca entrega
    with pytest.raises(LLMError):
        await generate_exercises(llm, MistakeTools(None, "u", []), "beginner", 3)
    assert len(llm.requests) == MAX_STEPS
    assert llm.requests[-2]["tool_choice"] == "required"
    assert llm.requests[-1]["tool_choice"] == {"type": "function", "function": {"name": "submit_exercises"}}


@pytest.mark.anyio
async def test_malformed_tool_calls_are_retried_a_few_times():
    llm = ScriptedLLM(ToolCallError("x"), [call("get_mistakes")], ToolCallError("x"), [call("submit_exercises", exercises=[CHOICE])])
    assert len(await generate_exercises(llm, MistakeTools(None, "u", []), "beginner", 1)) == 1

    always_broken = ScriptedLLM(*[ToolCallError("x")] * 10)
    with pytest.raises(LLMError):
        await generate_exercises(always_broken, MistakeTools(None, "u", []), "beginner", 1)
    assert len(always_broken.requests) == 3


@pytest.mark.anyio
async def test_tools_survive_a_database_failure_and_unknown_names():
    tools = MistakeTools(FakeMemory(error=ConnectionError()), "u", [])
    assert "error" in await tools.run("list_weak_spots", {})
    assert "error" in await tools.run("drop_database", {})


@pytest.mark.anyio
async def test_without_server_history_weak_spots_come_from_the_app():
    tools = MistakeTools(None, "u", [WeakSpot(tag="article", count=4)])
    assert (await tools.run("list_weak_spots", {}))["weak_spots"][0] == {
        "tag": "article",
        "meaning": "a/an/the missing, unnecessary or wrong",
        "mistakes": 4,
    }
    assert await tools.run("get_mistakes", {"tag": "not_a_tag"}) == {"mistakes": []}


def test_exercise_normalizes_tag_and_options():
    e = Exercise.model_validate({**CHOICE, "tag": "invented", "options": [" go ", "went", "went", 3]})
    assert e.tag == "other"
    assert e.options == ["go", "went"]
    assert Exercise.model_validate({**REWRITE, "options": ["x", "y"]}).options == []


# ---------------- rotas ----------------


def test_exercises_endpoint(client):
    from app.deps import get_llm

    llm = ScriptedLLM([call("get_mistakes")], [call("submit_exercises", exercises=[CHOICE, REWRITE])])
    memory = FakeMemory()
    app.dependency_overrides[get_llm] = lambda: llm
    app.dependency_overrides[get_memory] = lambda: memory
    res = client.post("/api/exercises", json={"level": "beginner", "count": 2})
    assert res.status_code == 200
    body = res.json()["exercises"]
    assert [e["type"] for e in body] == ["choice", "rewrite"]
    assert body[1]["options"] == []
    assert memory.calls == [("examples", "user-1", None)]


def test_exercises_endpoint_validates_count_and_reports_failure(client):
    from app.deps import get_llm

    assert client.post("/api/exercises", json={"level": "beginner", "count": 50}).status_code == 422
    app.dependency_overrides[get_llm] = lambda: ScriptedLLM()
    res = client.post("/api/exercises", json={"level": "beginner"})
    assert res.status_code == 502
    assert isinstance(res.json()["detail"], str)


CHECK = {"prompt": "She don't like movies.", "expected": "She doesn't like movies.", "answer": ""}


def test_check_exact_answer_skips_the_model(client, llm):
    res = client.post("/api/exercises/check", json={**CHECK, "answer": "  she doesn’t like  movies "})
    assert res.json() == {"correct": True, "feedback": None}
    assert llm.calls == []


def test_check_other_answers_are_graded_by_the_model(client, llm):
    llm.response = '{"correct":false,"feedback":"Ainda falta o -es."}'
    res = client.post("/api/exercises/check", json={**CHECK, "answer": "She do not like movies."})
    assert res.json() == {"correct": False, "feedback": "Ainda falta o -es."}
    assert "ANSWER: She do not like movies." in llm.calls[0][0][1]["content"]


def test_check_without_verdict_is_502(client, llm):
    llm.response = '{"correct":"maybe"}'
    assert client.post("/api/exercises/check", json={**CHECK, "answer": "x"}).status_code == 502


def test_parse_check_result():
    assert parse_check_result('```json\n{"correct": true, "feedback": " ok "}\n```').feedback == "ok"
    with pytest.raises(ValueError):
        parse_check_result("talvez")
