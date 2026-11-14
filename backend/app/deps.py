"""Dependências das rotas: usuário autenticado, limite de uso e cliente do LLM."""
import logging
import math
from functools import lru_cache

from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .auth import AuthUnavailable, FirebaseTokenVerifier, InvalidToken, User
from .config import Settings, get_settings
from .llm import GroqClient
from .memory import MistakeMemory
from .rate_limit import Rule, SlidingWindowLimiter

log = logging.getLogger(__name__)

_bearer = HTTPBearer(auto_error=False)


@lru_cache
def get_verifier() -> FirebaseTokenVerifier | None:
    project_id = get_settings().firebase_project_id
    return FirebaseTokenVerifier(project_id) if project_id else None


@lru_cache
def get_limiter() -> SlidingWindowLimiter:
    return SlidingWindowLimiter()


def get_llm(request: Request) -> GroqClient:
    return request.app.state.llm


def get_memory(request: Request) -> MistakeMemory | None:
    """Memória de erros do aluno; None quando o banco não está configurado ou não conectou."""
    return getattr(request.app.state, "memory", None)


# `def` síncrono de propósito: baixar as chaves públicas do Google bloqueia, então o FastAPI
# roda esta dependência no threadpool em vez de travar o event loop.
def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    verifier: FirebaseTokenVerifier | None = Depends(get_verifier),
) -> User:
    if verifier is None:
        log.error("FIREBASE_PROJECT_ID não configurado")
        raise HTTPException(503, "Servidor sem autenticação configurada.")
    if credentials is None:
        raise HTTPException(401, "Faça login para continuar.", headers={"WWW-Authenticate": "Bearer"})
    try:
        return verifier.verify(credentials.credentials)
    except AuthUnavailable:
        log.exception("falha ao obter as chaves públicas do Firebase")
        raise HTTPException(503, "Não foi possível validar o login agora. Tente de novo.")
    except InvalidToken:
        raise HTTPException(401, "Sessão expirada. Recarregue a página.", headers={"WWW-Authenticate": "Bearer"})


_MESSAGES = {
    "minute": "Muitas mensagens em pouco tempo. Aguarde alguns segundos.",
    "day": "Você atingiu o limite diário de uso. Volte amanhã!",
    "day_anonymous": "Você atingiu o limite diário de convidado. Crie uma conta para continuar praticando hoje.",
    "ip": "Muitas mensagens em pouco tempo. Aguarde alguns segundos.",
}


async def enforce_rate_limit(
    request: Request,
    user: User = Depends(get_current_user),
    limiter: SlidingWindowLimiter = Depends(get_limiter),
    settings: Settings = Depends(get_settings),
) -> User:
    """Conta um uso do LLM para o usuário (por minuto e por dia) e para o IP."""
    rules = [Rule("minute", f"user:{user.uid}:minute", settings.rate_limit_per_minute, 60)]
    if user.anonymous:
        rules.append(Rule("day_anonymous", f"user:{user.uid}:day", settings.daily_limit_anonymous, 86_400))
    else:
        rules.append(Rule("day", f"user:{user.uid}:day", settings.daily_limit, 86_400))
    if request.client:
        rules.append(Rule("ip", f"ip:{request.client.host}", settings.ip_rate_limit_per_minute, 60))

    blocked = limiter.acquire(rules)
    if blocked:
        raise HTTPException(
            429,
            _MESSAGES[blocked.rule.name],
            headers={"Retry-After": str(max(1, math.ceil(blocked.retry_after)))},
        )
    return user
