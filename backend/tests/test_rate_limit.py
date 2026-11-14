import pytest

from app.rate_limit import Rule, SlidingWindowLimiter


class Clock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


@pytest.fixture
def clock():
    return Clock()


@pytest.fixture
def limiter(clock):
    return SlidingWindowLimiter(clock)


def test_blocks_after_limit_and_reports_retry_after(limiter, clock):
    rule = Rule("minute", "u1", limit=2, window=60)
    assert limiter.acquire([rule]) is None
    clock.now += 10
    assert limiter.acquire([rule]) is None
    clock.now += 10
    blocked = limiter.acquire([rule])
    assert blocked.rule is rule
    # o primeiro uso (t=0) sai da janela em t=60; estamos em t=20
    assert blocked.retry_after == pytest.approx(40)


def test_window_slides(limiter, clock):
    rule = Rule("minute", "u1", limit=2, window=60)
    limiter.acquire([rule])
    clock.now += 30
    limiter.acquire([rule])
    clock.now += 31  # o primeiro uso expirou, o segundo não
    assert limiter.acquire([rule]) is None
    assert limiter.acquire([rule]) is not None


def test_keys_are_independent(limiter):
    assert limiter.acquire([Rule("minute", "u1", 1, 60)]) is None
    assert limiter.acquire([Rule("minute", "u2", 1, 60)]) is None
    assert limiter.acquire([Rule("minute", "u1", 1, 60)]) is not None


def test_blocked_request_consumes_nothing(limiter, clock):
    minute = Rule("minute", "u1:m", limit=1, window=60)
    day = Rule("day", "u1:d", limit=2, window=86_400)
    assert limiter.acquire([minute, day]) is None
    # barrado pelo limite por minuto: não pode gastar a cota diária
    assert limiter.acquire([minute, day]).rule is minute
    assert limiter.acquire([minute, day]).rule is minute
    clock.now += 61
    assert limiter.acquire([minute, day]) is None
    clock.now += 61
    assert limiter.acquire([minute, day]).rule is day


def test_reports_the_rule_that_takes_longest(limiter):
    minute = Rule("minute", "u1:m", limit=1, window=60)
    day = Rule("day", "u1:d", limit=1, window=86_400)
    limiter.acquire([minute, day])
    assert limiter.acquire([minute, day]).rule is day


def test_zero_limit_disables_the_rule(limiter):
    rule = Rule("ip", "1.2.3.4", limit=0, window=60)
    assert all(limiter.acquire([rule]) is None for _ in range(50))


def test_sweep_forgets_idle_keys(limiter, clock):
    limiter.SWEEP_EVERY = 3
    limiter.acquire([Rule("minute", "idle", 5, 60)])
    clock.now += 120
    limiter.acquire([Rule("minute", "busy", 5, 60)])
    limiter.acquire([Rule("minute", "busy", 5, 60)])  # 3ª chamada: faxina
    assert "idle" not in limiter._hits
    assert "busy" in limiter._hits
