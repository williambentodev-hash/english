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


class GroqClient:
    def __init__(self, http: httpx.AsyncClient, api_key: str, model: str):
        self._http = http
        self._api_key = api_key
        self._model = model

    async def complete(self, messages: list[dict[str, str]], max_tokens: int) -> str:
        """Devolve o texto (JSON) gerado pelo modelo."""
        if not self._api_key:
            log.error("GROQ_API_KEY não configurada")
            raise LLMError("Servidor sem chave do LLM configurada.", 503)
        try:
            res = await self._http.post(
                API_URL,
                headers={"authorization": f"Bearer {self._api_key}"},
                json={
                    "model": self._model,
                    "messages": messages,
                    "response_format": {"type": "json_object"},
                    "max_completion_tokens": max_tokens,
                    # gpt-oss é um modelo de raciocínio: esforço baixo = respostas rápidas para chat
                    "reasoning_effort": "low",
                    "include_reasoning": False,
                },
            )
        except httpx.TimeoutException as e:
            raise LLMError("O tutor demorou demais para responder. Tente de novo.", 504) from e
        except httpx.HTTPError as e:
            log.warning("falha de rede ao chamar o Groq: %r", e)
            raise LLMError("Não foi possível falar com o tutor. Tente de novo.") from e

        data = _json(res)
        if res.status_code >= 400:
            error = data.get("error")
            error = error if isinstance(error, dict) else {}
            # o modo JSON do Groq rejeita saídas inválidas, mas devolve o texto gerado: aproveitamos
            failed = error.get("failed_generation")
            if error.get("code") == "json_validate_failed" and isinstance(failed, str) and failed.strip():
                return failed.strip()
            log.warning("Groq respondeu %s: %s", res.status_code, error.get("message"))
            if res.status_code == 429:
                raise LLMError("O tutor está sobrecarregado. Aguarde alguns segundos.", 503)
            raise LLMError("O tutor está indisponível no momento. Tente de novo.")

        try:
            text = data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError):
            text = None
        if not isinstance(text, str) or not text.strip():
            raise LLMError("Resposta vazia do modelo. Tente de novo.")
        return text.strip()


def _json(res: httpx.Response) -> dict[str, Any]:
    try:
        data = res.json()
    except ValueError:
        return {}
    return data if isinstance(data, dict) else {}
