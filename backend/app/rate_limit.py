"""Limite de uso por janela deslizante, em memória.

Suficiente para uma instância. Com mais de uma réplica, o estado precisa ir para um
armazenamento compartilhado (Redis ou o próprio PostgreSQL).
"""
import time
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass


@dataclass(frozen=True)
class Rule:
    name: str
    key: str
    limit: int
    window: float  # segundos


@dataclass(frozen=True)
class Blocked:
    rule: Rule
    retry_after: float  # segundos até liberar uma vaga


class SlidingWindowLimiter:
    SWEEP_EVERY = 1000

    def __init__(self, clock: Callable[[], float] = time.monotonic):
        self._clock = clock
        self._hits: dict[str, deque[float]] = {}
        # maior janela já usada por chave, para a faxina saber o que expirou
        self._windows: dict[str, float] = {}
        self._calls = 0

    def acquire(self, rules: list[Rule]) -> Blocked | None:
        """Registra um uso em todas as regras, ou em nenhuma se alguma estiver estourada.

        Devolve a regra que bloqueou (a que demora mais para liberar) ou None se passou.
        Regras com limite <= 0 estão desativadas.
        """
        now = self._clock()
        self._calls += 1
        if self._calls % self.SWEEP_EVERY == 0:
            self._sweep(now)

        active = [r for r in rules if r.limit > 0]
        blocked: Blocked | None = None
        for rule in active:
            hits = self._prune(rule.key, now - rule.window)
            if hits is not None and len(hits) >= rule.limit:
                # a vaga abre quando o uso mais antigo que ainda conta sair da janela
                retry = hits[len(hits) - rule.limit] + rule.window - now
                if blocked is None or retry > blocked.retry_after:
                    blocked = Blocked(rule, retry)
        if blocked:
            return blocked

        for rule in active:
            self._hits.setdefault(rule.key, deque()).append(now)
            self._windows[rule.key] = max(rule.window, self._windows.get(rule.key, 0.0))
        return None

    def _prune(self, key: str, cutoff: float) -> deque[float] | None:
        hits = self._hits.get(key)
        if hits is None:
            return None
        while hits and hits[0] <= cutoff:
            hits.popleft()
        return hits

    def _sweep(self, now: float) -> None:
        """Remove chaves sem uso recente para a memória não crescer para sempre."""
        for key in list(self._hits):
            hits = self._prune(key, now - self._windows.get(key, 0.0))
            if not hits:
                self._hits.pop(key, None)
                self._windows.pop(key, None)
