"""Contratos da API (entrada e saída)."""
import math
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from .tags import ERROR_TAGS, parse_tags

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


# ---------------- exercícios ----------------


class Exercise(BaseModel):
    """Um exercício gerado pelo agente. Validado com rigor: vem do modelo."""

    # choice: completar a lacuna (___) escolhendo uma opção; rewrite: reescrever a frase errada
    type: Literal["choice", "rewrite"]
    tag: str
    # enunciado, em português
    instruction: str = Field(min_length=1, max_length=300)
    # frase em inglês: com "___" (choice) ou com um erro (rewrite)
    prompt: str = Field(min_length=1, max_length=500)
    options: list[str] = Field(default_factory=list, max_length=5)
    answer: str = Field(min_length=1, max_length=500)
    # por que a resposta é essa, em português
    explanation: str = Field(min_length=1, max_length=800)

    @field_validator("instruction", "prompt", "answer", "explanation", mode="before")
    @classmethod
    def _strip(cls, v: Any) -> Any:
        return v.strip() if isinstance(v, str) else v

    @field_validator("tag", mode="before")
    @classmethod
    def _tag(cls, v: Any) -> str:
        return v if isinstance(v, str) and v in ERROR_TAGS else "other"

    @field_validator("options", mode="before")
    @classmethod
    def _options(cls, v: Any) -> Any:
        if not isinstance(v, list):
            return []
        seen: list[str] = []
        for option in v:
            if isinstance(option, str) and option.strip() and option.strip() not in seen:
                seen.append(option.strip())
        return seen

    @model_validator(mode="after")
    def _coherent(self) -> "Exercise":
        if self.type == "choice":
            if "___" not in self.prompt:
                raise ValueError('choice: "prompt" precisa ter a lacuna ___')
            if len(self.options) < 2:
                raise ValueError("choice: pelo menos 2 opções diferentes")
            if self.answer not in self.options:
                raise ValueError('choice: "answer" precisa ser uma das opções')
        else:
            self.options = []
            if normalize_answer(self.answer) == normalize_answer(self.prompt):
                raise ValueError('rewrite: "answer" está igual à frase errada')
        return self


def normalize_answer(text: str) -> str:
    """Compara respostas ignorando maiúsculas, pontuação final e espaços a mais."""
    return " ".join(text.lower().replace("’", "'").split()).rstrip(".!?")


class ExercisesRequest(BaseModel):
    level: Level
    weak_spots: list[WeakSpot] = Field(default_factory=list, max_length=10)
    count: int = Field(default=5, ge=1, le=8)


class ExercisesResponse(BaseModel):
    exercises: list[Exercise]


class CheckRequest(BaseModel):
    """Resposta escrita pelo aluno em um exercício de reescrever."""

    prompt: str = Field(min_length=1, max_length=500)
    expected: str = Field(min_length=1, max_length=500)
    answer: str = Field(min_length=1, max_length=500)


class CheckResult(BaseModel):
    correct: bool
    # comentário curto em português (ausente quando a resposta bate com a esperada)
    feedback: str | None = None
