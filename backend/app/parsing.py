"""Leitura do JSON devolvido pelo modelo. Nunca confia no formato: valida campo a campo."""
import json
from typing import Any

from .schemas import CheckResult, Feedback, TermTranslation, TutorReply, normalize_score
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
    return TutorReply(reply=reply, feedback=feedback, translation=_text(data.get("translation")))


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
