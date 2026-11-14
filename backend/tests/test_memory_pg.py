"""Testes de integração com PostgreSQL + pgvector de verdade, e com o modelo de embeddings real.

Rodam só com as variáveis definidas (o CI define as duas):
  TEST_DATABASE_URL=postgresql://tutor:tutor@localhost:5432/tutor
  RUN_MODEL_TESTS=1
"""
import math
import os

import pytest

from app.embeddings import EMBEDDING_DIM, FastEmbedEmbedder
from app.memory import PgMistakeStore

pytestmark = pytest.mark.anyio

DSN = os.environ.get("TEST_DATABASE_URL")
needs_db = pytest.mark.skipif(not DSN, reason="defina TEST_DATABASE_URL")
needs_model = pytest.mark.skipif(not os.environ.get("RUN_MODEL_TESTS"), reason="defina RUN_MODEL_TESTS=1")


def vec(angle_degrees: float) -> list[float]:
    """Vetor unitário no plano das duas primeiras dimensões: a distância de cosseno vira 1 - cos(Δângulo)."""
    a = math.radians(angle_degrees)
    return [math.cos(a), math.sin(a)] + [0.0] * (EMBEDDING_DIM - 2)


@pytest.fixture
async def store():
    s = await PgMistakeStore.connect(DSN)
    await s._pool.execute("DELETE FROM mistakes WHERE uid LIKE 'test-%'")
    yield s
    await s._pool.execute("DELETE FROM mistakes WHERE uid LIKE 'test-%'")
    await s.close()


async def add(store, uid, said, angle, **over):
    args = {"correction": "c", "native": "n", "tags": ["article"], "level": "beginner", **over}
    await store.upsert(uid, said, embedding=vec(angle), **args)


@needs_db
async def test_search_returns_closest_first_within_max_distance(store):
    await add(store, "test-a", "perto", 10)
    await add(store, "test-a", "igual", 0)
    await add(store, "test-a", "longe", 90)  # distância 1.0: fora do limite
    found = await store.search("test-a", vec(0), limit=5, max_distance=0.6)
    assert [m.said for m in found] == ["igual", "perto"]
    assert found[0].distance == pytest.approx(0, abs=1e-6)
    assert found[1].distance == pytest.approx(1 - math.cos(math.radians(10)), abs=1e-5)
    assert found[0].tags == ["article"]


@needs_db
async def test_search_respects_limit(store):
    for i in range(5):
        await add(store, "test-a", f"frase {i}", i)
    assert [m.said for m in await store.search("test-a", vec(0), limit=2, max_distance=0.6)] == ["frase 0", "frase 1"]


@needs_db
async def test_users_never_see_each_others_mistakes(store):
    await add(store, "test-a", "erro do A", 0)
    await add(store, "test-b", "erro do B", 0)
    assert [m.said for m in await store.search("test-a", vec(0), 5, 0.6)] == ["erro do A"]
    assert [m.said for m in await store.search("test-c", vec(0), 5, 0.6)] == []


@needs_db
async def test_same_sentence_again_counts_instead_of_duplicating(store):
    await add(store, "test-a", "I go yesterday", 0, correction="antiga")
    await add(store, "test-a", "i GO yesterday", 0, correction="nova")
    await add(store, "test-b", "I go yesterday", 0)
    found = await store.search("test-a", vec(0), 5, 0.6)
    assert [(m.said, m.times, m.correction) for m in found] == [("I go yesterday", 2, "nova")]


@needs_db
async def test_delete_user_removes_only_that_user(store):
    await add(store, "test-a", "um", 0)
    await add(store, "test-a", "dois", 5)
    await add(store, "test-b", "outro", 0)
    assert await store.delete_user("test-a") == 2
    assert await store.search("test-a", vec(0), 5, 0.6) == []
    assert len(await store.search("test-b", vec(0), 5, 0.6)) == 1


@needs_db
async def test_schema_setup_is_idempotent(store):
    again = await PgMistakeStore.connect(DSN)
    await again.close()


@needs_model
async def test_real_model_dimension_and_similarity():
    embedder = FastEmbedEmbedder("sentence-transformers/all-MiniLM-L6-v2")
    base, similar, unrelated = [
        await embedder.embed(t)
        for t in ("I go to the beach yesterday", "I go to school yesterday", "What is your favorite food?")
    ]
    assert len(base) == EMBEDDING_DIM

    def distance(a, b):
        dot = sum(x * y for x, y in zip(a, b))
        return 1 - dot / math.sqrt(sum(x * x for x in a) * sum(y * y for y in b))

    # o limite padrão (0.6) precisa separar a frase parecida da não relacionada
    assert distance(base, similar) < 0.6 < distance(base, unrelated)
