import json

from app.prompts import build_chat_messages, build_system_prompt
from app.schemas import Feedback, Message, WeakSpot
from app.tags import ERROR_TAGS


def test_system_prompt_has_level_and_every_tag():
    prompt = build_system_prompt("beginner")
    assert "Learner level: BEGINNER" in prompt
    assert "very short, simple sentences" in prompt
    for tag in ERROR_TAGS:
        assert f'"{tag}":' in prompt
    assert "RECURRING MISTAKES" not in prompt
    assert "${" not in prompt


def test_system_prompt_lists_weak_spots():
    prompt = build_system_prompt("advanced", [WeakSpot(tag="article", count=4), WeakSpot(tag="plural", count=2)])
    assert "RECURRING MISTAKES" in prompt
    assert "- article: a/an/the missing, unnecessary or wrong — 4 recent mistakes" in prompt
    assert prompt.index("- article:") < prompt.index("- plural:")


def test_assistant_messages_go_back_as_json():
    history = [
        Message(role="user", content="I go yesterday"),
        Message(
            role="assistant",
            content="Where did you go?",
            feedback=Feedback(score=5, correction="correção", tags=["verb_tense"], native="I went yesterday."),
            translation="Aonde você foi?",
        ),
        Message(role="user", content="To the beach"),
    ]
    system, first, assistant, last = build_chat_messages("intermediate", history, [], max_history=30)
    assert system["role"] == "system"
    assert first == {"role": "user", "content": "I go yesterday"}
    assert last == {"role": "user", "content": "To the beach"}
    assert json.loads(assistant["content"]) == {
        "feedback": {"score": 5, "correction": "correção", "tags": ["verb_tense"], "native": "I went yesterday."},
        "reply": "Where did you go?",
        "translation": "Aonde você foi?",
    }
    # acentos legíveis para o modelo, sem escapes \u
    assert "correção" in assistant["content"]


def test_history_is_trimmed_and_starts_with_the_learner():
    history = [
        Message(role="user" if i % 2 == 0 else "assistant", content=f"m{i}") for i in range(9)
    ]
    messages = build_chat_messages("intermediate", history, [], max_history=4)
    # as 4 últimas seriam m5..m8, mas m5 é do tutor: começa em m6
    assert [m["role"] for m in messages] == ["system", "user", "assistant", "user"]
    assert messages[1]["content"] == "m6"
    assert messages[-1]["content"] == "m8"
