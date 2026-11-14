"""Cliente do Groq (Chat Completions, formato OpenAI). Único lugar que conhece a chave do LLM."""
import logging
from typing import Any

import httpx

API_URL = "https://api.groq.com/openai/v1/chat/completions"

log = logging.getLogger(__name__)


class LLMError(Exception):
    """Falha ao obter resposta do modelo. `message` é segura para mostrar ao usuário."""

    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.message = message
        self.status = status


class ToolCallError(LLMError):
    """O modelo não chamou uma ferramenta, ou chamou em formato inválido."""


class GroqClient:
    def __init__(self, http: httpx.AsyncClient, api_key: str, model: str):
        self._http = http
        self._api_key = api_key
        self._model = model

    async def _post(self, payload: dict[str, Any]) -> httpx.Response:
        if not self._api_key:
            log.error("GROQ_API_KEY não configurada")
            raise LLMError("Servidor sem chave do LLM configurada.", 503)
        try:
            return await self._http.post(
                API_URL,
                headers={"authorization": f"Bearer {self._api_key}"},
                json={
                    "model": self._model,
                    # gpt-oss é um modelo de raciocínio: esforço baixo = respostas rápidas para chat
                    "reasoning_effort": "low",
                    "include_reasoning": False,
                    **payload,
                },
            )
        except httpx.TimeoutException as e:
            raise LLMError("O tutor demorou demais para responder. Tente de novo.", 504) from e
        except httpx.HTTPError as e:
            log.warning("falha de rede ao chamar o Groq: %r", e)
            raise LLMError("Não foi possível falar com o tutor. Tente de novo.") from e

    @staticmethod
    def _raise_for_error(res: httpx.Response, error: dict[str, Any]) -> None:
        log.warning("Groq respondeu %s: %s", res.status_code, error.get("message"))
        if res.status_code == 429:
            raise LLMError("O tutor está sobrecarregado. Aguarde alguns segundos.", 503)
        raise LLMError("O tutor está indisponível no momento. Tente de novo.")

    async def complete(self, messages: list[dict[str, str]], max_tokens: int) -> str:
        """Devolve o texto (JSON) gerado pelo modelo."""
        res = await self._post(
            {"messages": messages, "response_format": {"type": "json_object"}, "max_completion_tokens": max_tokens}
        )
        data = _json(res)
        if res.status_code >= 400:
            error = _error(data)
            # o modo JSON do Groq rejeita saídas inválidas, mas devolve o texto gerado: aproveitamos
            failed = error.get("failed_generation")
            if error.get("code") == "json_validate_failed" and isinstance(failed, str) and failed.strip():
                return failed.strip()
            self._raise_for_error(res, error)

        text = _message(data).get("content")
        if not isinstance(text, str) or not text.strip():
            raise LLMError("Resposta vazia do modelo. Tente de novo.")
        return text.strip()

    async def chat(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        tool_choice: str | dict[str, Any] = "required",
        max_tokens: int = 4096,
        reasoning_effort: str = "medium",
    ) -> dict[str, Any]:
        """Um passo de um agente: devolve a mensagem do modelo, com as ferramentas que ele quer chamar.

        Levanta ToolCallError quando o modelo erra o formato da chamada (vale tentar de novo).
        """
        res = await self._post(
            {
                "messages": messages,
                "tools": tools,
                "tool_choice": tool_choice,
                "max_completion_tokens": max_tokens,
                # planejar e conferir gabaritos pede mais raciocínio que o bate-papo
                "reasoning_effort": reasoning_effort,
            }
        )
        data = _json(res)
        if res.status_code >= 400:
            error = _error(data)
            if error.get("code") == "tool_use_failed":
                raise ToolCallError("O modelo errou o formato da ferramenta.")
            self._raise_for_error(res, error)

        message = _message(data)
        calls = message.get("tool_calls")
        if not isinstance(calls, list) or not calls:
            raise ToolCallError("O modelo respondeu sem chamar nenhuma ferramenta.")
        return message


def _error(data: dict[str, Any]) -> dict[str, Any]:
    error = data.get("error")
    return error if isinstance(error, dict) else {}


def _message(data: dict[str, Any]) -> dict[str, Any]:
    try:
        message = data["choices"][0]["message"]
    except (KeyError, IndexError, TypeError):
        return {}
    return message if isinstance(message, dict) else {}


def _json(res: httpx.Response) -> dict[str, Any]:
    try:
        data = res.json()
    except ValueError:
        return {}
    return data if isinstance(data, dict) else {}
