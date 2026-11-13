"""Validação do ID token do Firebase Auth (o mesmo login que o front já usa).

O token é um JWT RS256 assinado pelo Google. Conferimos assinatura (chaves públicas via JWKS),
validade, audience (id do projeto) e issuer — sem precisar de service account.
"""
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import jwt

JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"


@dataclass(frozen=True)
class User:
    uid: str
    # convidado (login anônimo automático do app)
    anonymous: bool


class InvalidToken(Exception):
    """Token ausente, malformado, expirado ou de outro projeto."""


class AuthUnavailable(Exception):
    """Não foi possível obter as chaves públicas do Google."""


class FirebaseTokenVerifier:
    def __init__(self, project_id: str, key_resolver: Callable[[str], Any] | None = None):
        self._project_id = project_id
        if key_resolver is None:
            # chaves públicas ficam em cache; o cliente refaz o download quando o `kid` muda
            jwks = jwt.PyJWKClient(JWKS_URL, cache_keys=True, lifespan=3600)
            key_resolver = lambda token: jwks.get_signing_key_from_jwt(token).key  # noqa: E731
        self._resolve_key = key_resolver

    def verify(self, token: str) -> User:
        try:
            key = self._resolve_key(token)
            claims = jwt.decode(
                token,
                key,
                algorithms=["RS256"],
                audience=self._project_id,
                issuer=f"https://securetoken.google.com/{self._project_id}",
                options={"require": ["exp", "iat", "aud", "iss", "sub"]},
            )
        except jwt.PyJWKClientConnectionError as e:
            raise AuthUnavailable(str(e)) from e
        except jwt.PyJWTError as e:
            raise InvalidToken(str(e)) from e

        uid = claims.get("sub")
        if not isinstance(uid, str) or not uid:
            raise InvalidToken("sub vazio")
        firebase = claims.get("firebase")
        provider = firebase.get("sign_in_provider") if isinstance(firebase, dict) else None
        return User(uid=uid, anonymous=provider == "anonymous")
