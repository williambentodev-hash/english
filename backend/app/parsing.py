"""Leitura do JSON devolvido pelo modelo. Nunca confia no formato: valida campo a campo."""
import json
from typing import Any

from .schemas import (
    MAX_SUGGESTION,
    MAX_SUGGESTIONS,
    CheckResult,
    Feedback,
    Suggestion,
    TermTranslation,
    TutorReply,
    normalize_score,
)
from .tags import parse_tags


def _text(value: Any) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _extract_object(raw: str) -> dict[str, Any]:
    """Pega o objeto JSON mesmo com texto ou cercas de markdown em volta."""
    start, end = raw.find("{"), raw.rfind("}")
    data = json.loads(raw[start : end + 1] if 0 <= start < end else raw)
    if not isinstance(data, dict):
        raise ValueError("JSON não é um objeto")
    return data


def parse_tutor_reply(raw: str) -> TutorReply:
    """Lê o JSON do tutor; se vier fora do formato, usa o texto bruto como resposta."""
    try:
        data = _extract_object(raw)
        reply = _text(data.get("reply"))
        if not reply:
            raise ValueError("sem reply")
    except ValueError:
        return TutorReply(reply=raw.strip(), feedback=None, translation=None)

    f = data.get("feedback")
    feedback = None
    if isinstance(f, dict) and (native := _text(f.get("native"))):
        correction = _text(f.get("correction"))
        feedback = Feedback(
            score=normalize_score(f.get("score")),
            correction=correction,
            # sem correção não há erro para classificar
            tags=parse_tags(f.get("tags")) if correction else [],
            native=native,
        )
    return TutorReply(
        reply=reply,
        feedback=feedback,
        translation=_text(data.get("translation")),
        suggestions=_suggestions(data.get("suggestions")),
    )


def _suggestions(value: Any) -> list[Suggestion]:
    """Sugestões de resposta: aceita objetos {text, translation} ou só o texto; descarta o resto."""
    if not isinstance(value, list):
        return []
    out: list[Suggestion] = []
    for item in value:
        if isinstance(item, dict):
            text, translation = _text(item.get("text")), _text(item.get("translation"))
        else:
            text, translation = _text(item), None
        if not text or len(text) > MAX_SUGGESTION or any(s.text == text for s in out):
            continue
        if translation and len(translation) > MAX_SUGGESTION:
            translation = None
        out.append(Suggestion(text=text, translation=translation))
    return out[:MAX_SUGGESTIONS]


def parse_term_translation(raw: str, term: str) -> TermTranslation:
    """Lê a tradução de um termo. Levanta ValueError se o modelo não devolveu uma tradução."""
    data = _extract_object(raw)
    translation = _text(data.get("translation"))
    if not translation:
        raise ValueError("sem tradução")
    base = _text(data.get("base"))
    return TermTranslation(
        translation=translation,
        base=base if base and base.lower() != term.lower() else None,
    )


def parse_check_result(raw: str) -> CheckResult:
    """Lê a correção de um exercício. Levanta ValueError se o modelo não disse se está certo."""
    data = _extract_object(raw)
    correct = data.get("correct")
    if not isinstance(correct, bool):
        raise ValueError("sem veredito")
    return CheckResult(correct=correct, feedback=_text(data.get("feedback")))
