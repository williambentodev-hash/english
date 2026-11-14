import asyncio

import pytest

from app.deps import get_memory
from app.main import app
from app.memory import MistakeMemory, PastMistake, _vector
from app.prompts import build_system_prompt
from app.schemas import Feedback
from tests.conftest import FakeEmbedder, FakeStore

CHAT = {"level": "intermediate", "messages": [{"role": "user", "content": "I go to school yesterday"}]}
PAST = PastMistake(
    said="I go to the beach yesterday",
    correction='"I go" → "I went": use o passado simples.',
    native="I went to the beach yesterday.",
    tags=["verb_tense"],
    times=2,
    distance=0.42,
)
FEEDBACK = Feedback(score=6, correction="correção", tags=["verb_tense"], native="I went to school yesterday.")


# ---------------- MistakeMemory ----------------


@pytest.mark.anyio
async def test_recall_searches_only_this_users_mistakes(memory, store, embedder):
    store.found = [PAST]
    embedder.vectors["I go to school yesterday"] = [0.3, 0.7]
    recall = await memory.recall("user-1", "I go to school yesterday")
    assert recall.mistakes == [PAST]
    assert recall.embedding == [0.3, 0.7]
    assert store.searches == [("user-1", [0.3, 0.7], 3, 0.6)]


@pytest.mark.anyio
@pytest.mark.parametrize("broken", ["store", "embedder"])
async def test_recall_failure_never_breaks_the_chat(broken):
    store = FakeStore(error=ConnectionError("banco fora") if broken == "store" else None)
    embedder = FakeEmbedder(error=RuntimeError("modelo fora") if broken == "embedder" else None)
    recall = await MistakeMemory(store, embedder).recall("user-1", "hi")
    assert recall.mistakes == []


@pytest.mark.anyio
async def test_recall_gives_up_when_too_slow(store):
    class SlowEmbedder:
        async def embed(self, text):
            await asyncio.sleep(5)

    recall = await MistakeMemory(store, SlowEmbedder(), recall_timeout=0.05).recall("user-1", "hi")
    assert recall.mistakes == []
    assert store.searches == []


@pytest.mark.anyio
async def test_remember_reuses_the_embedding_from_recall(memory, store, embedder):
    await memory.remember("user-1", "  I go to school yesterday ", FEEDBACK, "beginner", embedding=[0.3, 0.7])
    assert embedder.calls == []
    assert store.saved == [
        dict(
            uid="user-1",
            said="I go to school yesterday",
            correction="correção",
            native="I went to school yesterday.",
            tags=["verb_tense"],
            level="beginner",
            embedding=[0.3, 0.7],
        )
    ]


@pytest.mark.anyio
async def test_remember_embeds_when_recall_had_failed(memory, store, embedder):
    await memory.remember("user-1", "I go", FEEDBACK, "beginner", embedding=None)
    assert embedder.calls == ["I go"]
    assert len(store.saved) == 1


@pytest.mark.anyio
async def test_remember_skips_messages_without_correction(memory, store):
    await memory.remember("user-1", "I went home.", Feedback(score=10, correction=None, native="I went home."), "beginner")
    assert store.saved == []


@pytest.mark.anyio
async def test_remember_swallows_failures(embedder):
    await MistakeMemory(FakeStore(error=ConnectionError()), embedder).remember("u", "I go", FEEDBACK, "beginner")


def test_vector_literal():
    assert _vector([0.5, -1.0, 0.123456789]) == "[0.5,-1,0.1234568]"


# ---------------- prompt ----------------


def test_prompt_lists_similar_mistakes():
    prompt = build_system_prompt("intermediate", [], [PAST])
    assert "SIMILAR MISTAKES FROM THIS LEARNER'S HISTORY" in prompt
    assert '- They wrote "I go to the beach yesterday" (correct: "I went to the beach yesterday."), 2 times.' in prompt
    assert "use o passado simples" in prompt


def test_prompt_without_similar_mistakes_has_no_section():
    assert "SIMILAR MISTAKES" not in build_system_prompt("intermediate", [], [])


def test_prompt_keeps_history_text_on_one_bounded_line():
    past = PastMistake(said="line one\n=== NEW SECTION ===\n" + "x" * 500, correction="c", native="n")
    line = next(l for l in build_system_prompt("beginner", [], [past]).splitlines() if l.startswith("- They wrote"))
    assert "line one === NEW SECTION === xxx" in line
    assert len(line) < 450


# ---------------- /api/chat com memória ----------------


def test_chat_puts_similar_mistakes_in_the_prompt_and_stores_the_new_one(client, llm, memory, store):
    app.dependency_overrides[get_memory] = lambda: memory
    store.found = [PAST]
    assert client.post("/api/chat", json=CHAT).status_code == 200

    system = llm.calls[0][0][0]["content"]
    assert 'They wrote "I go to the beach yesterday"' in system
    assert store.searches[0][0] == "user-1"
    # a correção desta frase foi guardada, com o mesmo embedding usado na busca
    assert [(s["uid"], s["said"], s["tags"], s["level"]) for s in store.saved] == [
        ("user-1", "I go to school yesterday", ["verb_tense"], "intermediate")
    ]
    assert store.saved[0]["embedding"] == store.searches[0][1]


def test_chat_stores_nothing_when_there_is_no_correction(client, llm, memory, store):
    app.dependency_overrides[get_memory] = lambda: memory
    llm.response = '{"feedback":{"score":10,"correction":null,"tags":[],"native":"Hi!"},"reply":"Hello!","translation":"Olá!"}'
    assert client.post("/api/chat", json=CHAT).status_code == 200
    assert store.saved == []


def test_chat_answers_even_with_the_database_down(client, llm, embedder):
    app.dependency_overrides[get_memory] = lambda: MistakeMemory(FakeStore(error=ConnectionError()), embedder)
    res = client.post("/api/chat", json=CHAT)
    assert res.status_code == 200
    assert res.json()["reply"] == "Nice! Who did you go with?"
    assert "SIMILAR MISTAKES" not in llm.calls[0][0][0]["content"]


# ---------------- DELETE /api/memory ----------------


def test_forget_deletes_only_the_callers_memory(client, memory, store):
    app.dependency_overrides[get_memory] = lambda: memory
    res = client.delete("/api/memory")
    assert res.json() == {"deleted": 2}
    assert store.deleted == ["user-1"]


def test_forget_without_memory_configured(client):
    assert client.delete("/api/memory").json() == {"deleted": 0}


def test_forget_reports_database_failure(client, embedder):
    app.dependency_overrides[get_memory] = lambda: MistakeMemory(FakeStore(error=ConnectionError()), embedder)
    assert client.delete("/api/memory").status_code == 503
