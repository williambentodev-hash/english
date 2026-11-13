import json

import httpx
import pytest

from app.llm import GroqClient, LLMError

pytestmark = pytest.mark.anyio

MESSAGES = [{"role": "user", "content": "hi"}]


def client(handler, api_key="gsk_test"):
    return GroqClient(httpx.AsyncClient(transport=httpx.MockTransport(handler)), api_key, "some-model")


async def test_returns_generated_text_and_sends_the_server_key():
    seen = {}

    def handler(request: httpx.Request):
        seen["auth"] = request.headers["authorization"]
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"choices": [{"message": {"content": ' {"reply":"Hi"} '}}]})

    assert await client(handler).complete(MESSAGES, max_tokens=64) == '{"reply":"Hi"}'
    assert seen["auth"] == "Bearer gsk_test"
    assert seen["body"]["model"] == "some-model"
    assert seen["body"]["messages"] == MESSAGES
    assert seen["body"]["max_completion_tokens"] == 64
    assert seen["body"]["response_format"] == {"type": "json_object"}


async def test_recovers_text_rejected_by_json_mode():
    def handler(_):
        return httpx.Response(
            400, json={"error": {"code": "json_validate_failed", "failed_generation": "Hello there!"}}
        )

    assert await client(handler).complete(MESSAGES, 64) == "Hello there!"


@pytest.mark.parametrize(
    ("response", "status"),
    [
        (httpx.Response(429, json={"error": {"message": "rate limit"}}), 503),
        (httpx.Response(401, json={"error": {"message": "invalid key gsk_test"}}), 502),
        (httpx.Response(500, text="<html>oops</html>"), 502),
        (httpx.Response(200, json={"choices": []}), 502),
        (httpx.Response(200, json={"choices": [{"message": {"content": "  "}}]}), 502),
    ],
)
async def test_upstream_failures_become_safe_errors(response, status):
    with pytest.raises(LLMError) as e:
        await client(lambda _: response).complete(MESSAGES, 64)
    assert e.value.status == status
    # a mensagem vai para o usuário: nada do erro original do provedor
    assert "gsk_test" not in e.value.message


async def test_timeout():
    def handler(request):
        raise httpx.ReadTimeout("lento", request=request)

    with pytest.raises(LLMError) as e:
        await client(handler).complete(MESSAGES, 64)
    assert e.value.status == 504


async def test_missing_key_never_calls_the_provider():
    def handler(_):
        raise AssertionError("não deveria chamar o Groq")

    with pytest.raises(LLMError) as e:
        await client(handler, api_key="").complete(MESSAGES, 64)
    assert e.value.status == 503
