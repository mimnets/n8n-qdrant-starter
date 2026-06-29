from __future__ import annotations

from datetime import UTC, datetime


def utcnow_naive() -> datetime:
    """Return UTC now as a naive datetime for current DB timestamp columns."""
    return datetime.now(tz=UTC).replace(tzinfo=None)


def as_utc_naive(value: datetime) -> datetime:
    """Normalize an aware datetime to naive UTC; leave naive values unchanged."""
    if value.tzinfo is None:
        return value
    return value.astimezone(UTC).replace(tzinfo=None)
