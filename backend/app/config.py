"""Configuração lida de variáveis de ambiente (ou do arquivo .env na pasta backend/)."""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # LLM: a chave fica só no servidor
    groq_api_key: str = ""
    groq_model: str = "openai/gpt-oss-120b"
    llm_timeout_seconds: float = 30.0

    # Mesmo projeto Firebase do front: usado para validar o ID token do usuário
    firebase_project_id: str = ""

    # Origens do front autorizadas, separadas por vírgula
    cors_origins: str = "http://localhost:5173"

    # Limites de uso (0 desativa a regra)
    rate_limit_per_minute: int = 30
    daily_limit: int = 500
    # convidados (login anônimo) têm um teto menor: criar uid anônimo é gratuito
    daily_limit_anonymous: int = 100
    # por IP: segura quem cria vários convidados. Atrás de proxy, rode o uvicorn com
    # --proxy-headers e FORWARDED_ALLOW_IPS, senão todos os usuários compartilham o IP do proxy.
    ip_rate_limit_per_minute: int = 120

    # Só as últimas N mensagens da conversa vão para o modelo (custo previsível)
    max_history_messages: int = 30

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip().rstrip("/") for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
