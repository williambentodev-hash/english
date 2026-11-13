import json

import pytest

from app.parsing import parse_term_translation, parse_tutor_reply


def tutor(feedback=None, reply="Nice!", translation="Legal!"):
    return json.dumps({"feedback": feedback, "reply": reply, "translation": translation})


def feedback(**over):
    return {"score": 7, "correction": "explicação", "tags": ["article"], "native": "I have a dog.", **over}


def test_valid_reply():
    r = parse_tutor_reply(tutor(feedback()))
    assert r.reply == "Nice!"
    assert r.translation == "Legal!"
    assert r.feedback.model_dump() == {
        "score": 7,
        "correction": "explicação",
        "tags": ["article"],
        "native": "I have a dog.",
    }


def test_json_wrapped_in_markdown_and_text():
    raw = f"Here you go:\n```json\n{tutor(feedback())}\n```"
    assert parse_tutor_reply(raw).reply == "Nice!"


@pytest.mark.parametrize(
    "raw",
    ["Sorry, I can't answer that.", '{"reply":','{"translation":"sem reply"}', '{"reply":"   "}', "[1, 2]", '"texto"'],
)
def test_out_of_format_falls_back_to_raw_text(raw):
    r = parse_tutor_reply(f"  {raw}  ")
    assert r.reply == raw
    assert r.feedback is None
    assert r.translation is None


@pytest.mark.parametrize(
    ("score", "expected"),
    [(7, 7), (0, 1), (-3, 1), (15, 10), (7.5, 8), (6.4, 6), ("8", 8), (None, None), ("alto", None), (True, None)],
)
def test_score_is_normalized(score, expected):
    assert parse_tutor_reply(tutor(feedback(score=score))).feedback.score == expected


def test_learner_wrote_in_portuguese():
    f = parse_tutor_reply(tutor({"score": None, "correction": None, "tags": [], "native": "I'm tired."})).feedback
    assert f.model_dump() == {"score": None, "correction": None, "tags": [], "native": "I'm tired."}


def test_feedback_without_native_is_dropped():
    assert parse_tutor_reply(tutor(feedback(native=""))).feedback is None
    assert parse_tutor_reply(tutor("not an object")).feedback is None
    assert parse_tutor_reply(tutor(None)).feedback is None


def test_tags_keep_only_known_unique_ids_up_to_three():
    tags = ["article", "made_up", "article", 42, "plural", "spelling", "other"]
    assert parse_tutor_reply(tutor(feedback(tags=tags))).feedback.tags == ["article", "plural", "spelling"]
    assert parse_tutor_reply(tutor(feedback(tags="article"))).feedback.tags == []


def test_tags_are_dropped_when_there_is_no_correction():
    f = parse_tutor_reply(tutor(feedback(correction=None, tags=["article"]))).feedback
    assert f.correction is None
    assert f.tags == []


def test_blank_translation_becomes_none():
    assert parse_tutor_reply(tutor(reply="Hi", translation="  ")).translation is None


def test_term_translation():
    t = parse_term_translation('{"translation":" foi ","base":"go"}', "went")
    assert (t.translation, t.base) == ("foi", "go")


def test_term_translation_drops_base_equal_to_term():
    assert parse_term_translation('{"translation":"cachorro","base":"Dog"}', "dog").base is None
    assert parse_term_translation('{"translation":"cachorro","base":null}', "dog").base is None


@pytest.mark.parametrize("raw", ["nada", '{"base":"go"}', '{"translation":""}', "[]"])
def test_term_translation_without_translation_raises(raw):
    with pytest.raises(ValueError):
        parse_term_translation(raw, "went")
