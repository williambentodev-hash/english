import pytest
from fastapi.testclient import TestClient

from app.auth import User
from app.config import Settings, get_settings
from app.deps import get_current_user, get_limiter, get_llm, get_memory
from app.llm import LLMError
from app.main import app
from app.memory import MistakeMemory, PastMistake
from app.rate_limit import SlidingWindowLimiter

TUTOR_JSON = (
    '{"feedback":{"score":6,"correction":"\\"I go\\" → \\"I went\\": use o passado simples.",'
    '"tags":["verb_tense"],"native":"I went to the beach yesterday."},'
    '"reply":"Nice! Who did you go with?","translation":"Legal! Com quem você foi?"}'
)


class FakeLLM:
    """Substitui o Groq: devolve um texto fixo e guarda o que recebeu."""

    def __init__(self, response: str | LLMError = TUTOR_JSON):
        self.response = response
        self.calls: list[tuple[list[dict[str, str]], int]] = []

    async def complete(self, messages, max_tokens):
        self.calls.append((messages, max_tokens))
        if isinstance(self.response, LLMError):
            raise self.response
        return self.response


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
def llm():
    return FakeLLM()


@pytest.fixture
def settings():
    # sem ler o .env local: os testes não dependem da configuração da máquina
    return Settings(
        _env_file=None, database_url="", rate_limit_per_minute=5, daily_limit=8, daily_limit_anonymous=3
    )


@pytest.fixture
def user():
    return User(uid="user-1", anonymous=False)


class FakeEmbedder:
    """Vetor previsível por texto, sem carregar modelo."""

    def __init__(self, vectors: dict[str, list[float]] | None = None, error: Exception | None = None):
        self.vectors = vectors or {}
        self.error = error
        self.calls: list[str] = []

    async def embed(self, text):
        self.calls.append(text)
        if self.error:
            raise self.error
        return self.vectors.get(text, [1.0, 0.0])


class FakeStore:
    """Guarda os erros em memória e devolve na busca o que foi configurado em `found`."""

    def __init__(self, found: list[PastMistake] | None = None, error: Exception | None = None):
        self.found = found or []
        self.error = error
        self.searches: list[tuple] = []
        self.saved: list[dict] = []
        self.deleted: list[str] = []

    async def search(self, uid, embedding, limit, max_distance):
        self.searches.append((uid, embedding, limit, max_distance))
        if self.error:
            raise self.error
        return self.found

    async def upsert(self, uid, said, correction, native, tags, level, embedding):
        if self.error:
            raise self.error
        self.saved.append(
            dict(uid=uid, said=said, correction=correction, native=native, tags=tags, level=level, embedding=embedding)
        )

    async def delete_user(self, uid):
        if self.error:
            raise self.error
        self.deleted.append(uid)
        return 2


@pytest.fixture
def store():
    return FakeStore()


@pytest.fixture
def embedder():
    return FakeEmbedder()


@pytest.fixture
def memory(store, embedder):
    return MistakeMemory(store, embedder, top_k=3, max_distance=0.6)


@pytest.fixture
def client(llm, settings, user):
    """Cliente autenticado como `user`, com LLM falso, sem memória e limites zerados a cada teste."""
    limiter = SlidingWindowLimiter()
    app.dependency_overrides[get_memory] = lambda: None
    app.dependency_overrides[get_llm] = lambda: llm
    app.dependency_overrides[get_settings] = lambda: settings
    app.dependency_overrides[get_limiter] = lambda: limiter
    app.dependency_overrides[get_current_user] = lambda: user
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()
