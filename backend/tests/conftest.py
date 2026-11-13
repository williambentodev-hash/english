import pytest
from fastapi.testclient import TestClient

from app.auth import User
from app.config import Settings, get_settings
from app.deps import get_current_user, get_limiter, get_llm
from app.llm import LLMError
from app.main import app
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
    return Settings(_env_file=None, rate_limit_per_minute=5, daily_limit=8, daily_limit_anonymous=3)


@pytest.fixture
def user():
    return User(uid="user-1", anonymous=False)


@pytest.fixture
def client(llm, settings, user):
    """Cliente autenticado como `user`, com LLM falso e limites zerados a cada teste."""
    limiter = SlidingWindowLimiter()
    app.dependency_overrides[get_llm] = lambda: llm
    app.dependency_overrides[get_settings] = lambda: settings
    app.dependency_overrides[get_limiter] = lambda: limiter
    app.dependency_overrides[get_current_user] = lambda: user
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()
