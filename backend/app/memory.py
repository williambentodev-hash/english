"""Memória de erros do aluno (RAG).

Cada correção vira uma linha no PostgreSQL com o embedding da frase que o aluno escreveu.
Antes de responder, o tutor recebe os erros antigos do mesmo aluno mais parecidos com a frase
nova, para poder dizer "você já errou isso antes" com o exemplo real.

A memória é um reforço: se o banco ou o modelo de embeddings falharem, a conversa segue sem ela.
"""
import asyncio
import logging
from dataclasses import dataclass, field
from typing import Protocol
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import asyncpg

from .embeddings import EMBEDDING_DIM
from .schemas import Feedback

log = logging.getLogger(__name__)

SCHEMA = f"""
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS mistakes (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uid          TEXT NOT NULL,
    said         TEXT NOT NULL,
    correction   TEXT NOT NULL,
    native       TEXT NOT NULL,
    tags         TEXT[] NOT NULL DEFAULT '{{}}',
    level        TEXT NOT NULL,
    times        INTEGER NOT NULL DEFAULT 1,
    embedding    vector({EMBEDDING_DIM}) NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A mesma frase errada de novo não vira outra linha: soma em `times`.
-- Este índice também atende o filtro por aluno. Não há índice vetorial (HNSW/IVFFlat) de
-- propósito: a busca é sempre dentro das linhas de um aluno, poucas o bastante para a
-- comparação exata ser rápida e sem perda de precisão.
CREATE UNIQUE INDEX IF NOT EXISTS mistakes_uid_said_key ON mistakes (uid, md5(lower(said)));
"""


@dataclass(frozen=True)
class PastMistake:
    said: str
    correction: str
    native: str
    tags: list[str] = field(default_factory=list)
    times: int = 1
    # distância de cosseno até a frase nova (0 = idêntica)
    distance: float = 0.0


@dataclass(frozen=True)
class Recall:
    """Resultado da busca; o embedding é reaproveitado ao gravar a correção da mesma frase."""

    mistakes: list[PastMistake] = field(default_factory=list)
    embedding: list[float] | None = None


class Embedder(Protocol):
    async def embed(self, text: str) -> list[float]: ...


class MistakeStore(Protocol):
    async def search(self, uid: str, embedding: list[float], limit: int, max_distance: float) -> list[PastMistake]: ...

    async def upsert(
        self, uid: str, said: str, correction: str, native: str, tags: list[str], level: str, embedding: list[float]
    ) -> None: ...

    async def delete_user(self, uid: str) -> int: ...

    async def tag_counts(self, uid: str) -> list[tuple[str, int]]: ...

    async def top(self, uid: str, tag: str | None, limit: int) -> list[PastMistake]: ...


def _vector(embedding: list[float]) -> str:
    """Formato de texto do pgvector: '[0.1,0.2,...]'."""
    return "[" + ",".join(f"{x:.7g}" for x in embedding) + "]"


def clean_dsn(dsn: str) -> str:
    """Remove parâmetros do libpq que o asyncpg não conhece e repassaria ao servidor como configuração.

    Provedores como o Neon entregam a URL com `channel_binding=require`; sem tirar, a conexão falha.
    """
    parts = urlsplit(dsn.strip())
    query = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if k != "channel_binding"]
    return urlunsplit(parts._replace(query=urlencode(query)))


class PgMistakeStore:
    def __init__(self, pool: asyncpg.Pool):
        self._pool = pool

    @classmethod
    async def connect(cls, dsn: str) -> "PgMistakeStore":
        pool = await asyncpg.create_pool(
            clean_dsn(dsn),
            min_size=1,
            max_size=5,
            command_timeout=5,
            # bancos serverless suspendem conexões ociosas: não as guarde por muito tempo
            max_inactive_connection_lifetime=60,
            # compatível com poolers em modo transação (PgBouncer), que não aceitam prepared statements
            statement_cache_size=0,
        )
        async with pool.acquire() as conn:
            await conn.execute(SCHEMA)
        return cls(pool)

    async def close(self) -> None:
        await self._pool.close()

    async def search(self, uid: str, embedding: list[float], limit: int, max_distance: float) -> list[PastMistake]:
        rows = await self._pool.fetch(
            """
            SELECT said, correction, native, tags, times, embedding <=> $2::text::vector AS distance
            FROM mistakes
            WHERE uid = $1 AND embedding <=> $2::text::vector <= $3
            ORDER BY distance
            LIMIT $4
            """,
            uid,
            _vector(embedding),
            max_distance,
            limit,
        )
        return [
            PastMistake(r["said"], r["correction"], r["native"], list(r["tags"]), r["times"], float(r["distance"]))
            for r in rows
        ]

    async def upsert(
        self, uid: str, said: str, correction: str, native: str, tags: list[str], level: str, embedding: list[float]
    ) -> None:
        await self._pool.execute(
            """
            INSERT INTO mistakes (uid, said, correction, native, tags, level, embedding)
            VALUES ($1, $2, $3, $4, $5, $6, $7::text::vector)
            ON CONFLICT (uid, md5(lower(said))) DO UPDATE SET
                times = mistakes.times + 1,
                correction = EXCLUDED.correction,
                native = EXCLUDED.native,
                tags = EXCLUDED.tags,
                level = EXCLUDED.level,
                last_seen_at = now()
            """,
            uid,
            said,
            correction,
            native,
            tags,
            level,
            _vector(embedding),
        )

    async def delete_user(self, uid: str) -> int:
        status = await self._pool.execute("DELETE FROM mistakes WHERE uid = $1", uid)
        # status no formato "DELETE 3"
        return int(status.split()[-1])

    async def tag_counts(self, uid: str) -> list[tuple[str, int]]:
        """Quantos erros o aluno cometeu em cada categoria, da mais frequente para a menos."""
        rows = await self._pool.fetch(
            """
            SELECT tag, sum(times)::int AS total
            FROM mistakes, unnest(tags) AS tag
            WHERE uid = $1
            GROUP BY tag
            ORDER BY total DESC, tag
            """,
            uid,
        )
        return [(r["tag"], r["total"]) for r in rows]

    async def top(self, uid: str, tag: str | None, limit: int) -> list[PastMistake]:
        """Erros do aluno (de uma categoria, se informada): os mais repetidos e recentes primeiro."""
        rows = await self._pool.fetch(
            """
            SELECT said, correction, native, tags, times
            FROM mistakes
            WHERE uid = $1 AND ($2::text IS NULL OR $2 = ANY(tags))
            ORDER BY times DESC, last_seen_at DESC
            LIMIT $3
            """,
            uid,
            tag,
            limit,
        )
        return [PastMistake(r["said"], r["correction"], r["native"], list(r["tags"]), r["times"]) for r in rows]


class MistakeMemory:
    def __init__(
        self,
        store: MistakeStore,
        embedder: Embedder,
        top_k: int = 3,
        max_distance: float = 0.6,
        recall_timeout: float = 3.0,
    ):
        self._store = store
        self._embedder = embedder
        self._top_k = top_k
        self._max_distance = max_distance
        self._recall_timeout = recall_timeout

    async def recall(self, uid: str, text: str) -> Recall:
        """Erros antigos do aluno parecidos com `text`. Nunca levanta erro nem atrasa muito a resposta."""
        embedding: list[float] | None = None
        try:
            async with asyncio.timeout(self._recall_timeout):
                embedding = await self._embedder.embed(text)
                mistakes = await self._store.search(uid, embedding, self._top_k, self._max_distance)
            return Recall(mistakes, embedding)
        except Exception:
            log.warning("memória: busca falhou; respondendo sem ela", exc_info=True)
            return Recall([], embedding)

    async def remember(
        self, uid: str, said: str, feedback: Feedback, level: str, embedding: list[float] | None = None
    ) -> None:
        """Grava a correção recebida. Nunca levanta erro (roda depois da resposta enviada)."""
        if not feedback.correction:
            return
        try:
            if embedding is None:
                embedding = await self._embedder.embed(said)
            await self._store.upsert(
                uid, said.strip(), feedback.correction, feedback.native, feedback.tags, level, embedding
            )
        except Exception:
            log.warning("memória: gravação falhou", exc_info=True)

    # --- consultas usadas pelo agente de exercícios (podem levantar erro: quem chama decide) ---

    async def weak_spots(self, uid: str) -> list[tuple[str, int]]:
        return await self._store.tag_counts(uid)

    async def examples(self, uid: str, tag: str | None = None, limit: int = 5) -> list[PastMistake]:
        return await self._store.top(uid, tag, limit)

    async def search(self, uid: str, query: str, limit: int = 5) -> list[PastMistake]:
        embedding = await self._embedder.embed(query)
        return await self._store.search(uid, embedding, limit, self._max_distance)

    async def forget(self, uid: str) -> int:
        """Apaga tudo o que foi guardado sobre o aluno. Devolve quantos erros foram apagados."""
        return await self._store.delete_user(uid)
