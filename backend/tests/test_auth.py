import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from app.auth import AuthUnavailable, FirebaseTokenVerifier, InvalidToken

PROJECT = "my-project"


@pytest.fixture(scope="module")
def key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture
def verifier(key):
    return FirebaseTokenVerifier(PROJECT, key_resolver=lambda _token: key.public_key())


def make_token(key, provider="password", **over):
    now = int(time.time())
    claims = {
        "iss": f"https://securetoken.google.com/{PROJECT}",
        "aud": PROJECT,
        "sub": "uid-123",
        "iat": now - 10,
        "exp": now + 3600,
        "firebase": {"sign_in_provider": provider},
        **over,
    }
    return jwt.encode({k: v for k, v in claims.items() if v is not None}, key, algorithm="RS256")


def test_valid_token(verifier, key):
    user = verifier.verify(make_token(key))
    assert (user.uid, user.anonymous) == ("uid-123", False)


def test_anonymous_user(verifier, key):
    assert verifier.verify(make_token(key, provider="anonymous")).anonymous is True


@pytest.mark.parametrize(
    "over",
    [
        {"exp": int(time.time()) - 60},
        {"aud": "another-project"},
        {"iss": "https://securetoken.google.com/another-project"},
        {"sub": ""},
        {"sub": None},
    ],
)
def test_rejects_bad_claims(verifier, key, over):
    with pytest.raises(InvalidToken):
        verifier.verify(make_token(key, **over))


def test_rejects_token_signed_by_another_key(verifier):
    other = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    with pytest.raises(InvalidToken):
        verifier.verify(make_token(other))


def test_rejects_unsigned_and_symmetric_tokens(verifier):
    claims = {"iss": f"https://securetoken.google.com/{PROJECT}", "aud": PROJECT, "sub": "x", "iat": 0, "exp": 9e9}
    with pytest.raises(InvalidToken):
        verifier.verify(jwt.encode(claims, "segredo-com-tamanho-suficiente-para-hs256", algorithm="HS256"))
    with pytest.raises(InvalidToken):
        verifier.verify(jwt.encode(claims, None, algorithm="none"))


def test_rejects_garbage(verifier):
    with pytest.raises(InvalidToken):
        verifier.verify("not-a-jwt")


def test_key_download_failure_is_not_a_bad_token(key):
    def resolver(_token):
        raise jwt.PyJWKClientConnectionError("sem rede")

    with pytest.raises(AuthUnavailable):
        FirebaseTokenVerifier(PROJECT, key_resolver=resolver).verify(make_token(key))
