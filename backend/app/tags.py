"""Categorias de erro: lista fixa usada pelo tutor para classificar cada correção.

Os ids são os mesmos do front (src/services/tutor.ts) e dos documentos já gravados no Firestore.
"""
from typing import Any

ERROR_TAGS: dict[str, str] = {
    "verb_tense": "wrong tense (past, present, future, perfect, continuous)",
    "verb_form": "conjugation or agreement: third-person -s, irregular forms, am/is/are, do/does/did, infinitive vs -ing",
    "article": "a/an/the missing, unnecessary or wrong",
    "preposition": "wrong, missing or unnecessary preposition (in, on, at, of, to, for...)",
    "plural": "plural forms, countable vs uncountable, much/many, few/little",
    "pronoun": "pronouns and possessives (he/she/it, his/her, me/I), missing subject",
    "word_order": "word order, including question and negative structure, adjective position",
    "word_choice": "wrong word, false cognate, literal translation from Portuguese, unnatural collocation",
    "spelling": "misspelled word",
    "other": "anything that fits none of the above",
}

MAX_TAGS = 3


def parse_tags(value: Any) -> list[str]:
    """Só categorias conhecidas, sem repetição (o modelo ou dados antigos podem trazer qualquer coisa)."""
    if not isinstance(value, list):
        return []
    seen: list[str] = []
    for tag in value:
        if isinstance(tag, str) and tag in ERROR_TAGS and tag not in seen:
            seen.append(tag)
    return seen[:MAX_TAGS]
