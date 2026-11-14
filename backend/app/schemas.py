"""Contratos da API (entrada e saída)."""
import math
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

from .tags import parse_tags

Level = Literal["beginner", "intermediate", "advanced"]
ErrorTag = Literal[
    "verb_tense",
    "verb_form",
    "article",
    "preposition",
    "plural",
    "pronoun",
    "word_order",
    "word_choice",
    "spelling",
    "other",
]

MAX_TEXT = 8000
MAX_USER_MESSAGE = 2000


def normalize_score(value: Any) -> int | None:
    """Nota inteira de 1 a 10; None quando ausente ou não numérica."""
    if value is None or isinstance(value, bool):
        return None
    try:
        n = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(n):
        return None
    return min(10, max(1, math.floor(n + 0.5)))


class Feedback(BaseModel):
    """Avaliação da última frase do aluno. Tolerante na entrada: o histórico vem do cliente."""

    score: int | None = None
    correction: str | None = Field(None, max_length=MAX_TEXT)
    tags: list[str] = []
    native: str = Field(max_length=MAX_TEXT)

    @field_validator("score", mode="before")
    @classmethod
    def _score(cls, v: Any) -> int | None:
        return normalize_score(v)

    @field_validator("tags", mode="before")
    @classmethod
    def _tags(cls, v: Any) -> list[str]:
        return parse_tags(v)


class Message(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=MAX_TEXT)
    feedback: Feedback | None = None
    translation: str | None = Field(None, max_length=MAX_TEXT)


class WeakSpot(BaseModel):
    """Categoria de erro e quantas vezes apareceu nas correções recentes do aluno."""

    tag: ErrorTag
    count: int = Field(ge=1, le=10_000)


class ChatRequest(BaseModel):
    level: Level
    messages: list[Message] = Field(min_length=1, max_length=400)
    weak_spots: list[WeakSpot] = Field(default_factory=list, max_length=10)


class TutorReply(BaseModel):
    reply: str
    feedback: Feedback | None
    translation: str | None


class TranslateRequest(BaseModel):
    term: str = Field(min_length=1, max_length=120)
    context: str = Field(default="", max_length=2000)


class TermTranslation(BaseModel):
    translation: str
    # forma de dicionário em inglês (ex.: "went" → "go"), quando diferente do termo
    base: str | None
