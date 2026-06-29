from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import structlog

logger = structlog.get_logger(__name__)


class LogEntry:
    """A single structured log entry from the render pipeline."""

    __slots__ = ("extra", "level", "message", "stage", "timestamp")

    def __init__(
        self,
        stage: str,
        message: str,
        *,
        level: str = "INFO",
        extra: dict[str, Any] | None = None,
    ) -> None:
        self.timestamp = datetime.now(tz=UTC).isoformat(timespec="seconds")
        self.stage = stage
        self.level = level
        self.message = message
        self.extra = extra or {}

    def format(self) -> str:
        parts = [
            f"[{self.timestamp}]",
            f"[{self.level}]",
            f"[{self.stage}]",
            self.message,
        ]
        if self.extra:
            kv = " ".join(f"{k}={v}" for k, v in self.extra.items())
            parts.append(f"({kv})")
        return " ".join(parts)


class RenderLogCollector:
    """Collects structured log entries across pipeline stages for a single render.

    Entries are accumulated in-memory and flushed to a logs.txt file in the
    workspace when the pipeline completes (success or failure). Flush is safe
    to call multiple times and will not raise on I/O errors.
    """

    def __init__(self, render_id: str) -> None:
        self._render_id = render_id
        self._entries: list[LogEntry] = []
        self._flushed = False

    @property
    def entries(self) -> list[LogEntry]:
        return list(self._entries)

    @property
    def is_empty(self) -> bool:
        return len(self._entries) == 0

    def add(
        self,
        stage: str,
        message: str,
        *,
        level: str = "INFO",
        extra: dict[str, Any] | None = None,
    ) -> None:
        """Record a log entry for the current pipeline stage."""
        self._entries.append(LogEntry(stage, message, level=level, extra=extra))

    def add_error(
        self,
        stage: str,
        message: str,
        *,
        extra: dict[str, Any] | None = None,
    ) -> None:
        """Record an error-level log entry."""
        self.add(stage, message, level="ERROR", extra=extra)

    async def flush(self, workspace: Path) -> Path | None:
        """Write all collected entries to logs.txt in the workspace.

        Returns the path to logs.txt on success, None if workspace doesn't
        exist or on I/O error. Safe to call multiple times; subsequent calls
        append new entries since last flush.
        """
        if not workspace.exists():
            await logger.awarning(
                "log_collector_flush_no_workspace",
                render_id=self._render_id,
            )
            return None

        log_path = workspace / "logs.txt"
        content = self._format_all()

        try:
            await asyncio.to_thread(log_path.write_text, content, encoding="utf-8")
            self._flushed = True
            return log_path
        except OSError as exc:
            await logger.awarning(
                "log_collector_flush_error",
                render_id=self._render_id,
                error=str(exc),
            )
            return None

    def _format_all(self) -> str:
        header = f"# Render Log: {self._render_id}\n"
        separator = "-" * 60 + "\n"
        lines = [header, separator]
        for entry in self._entries:
            lines.append(entry.format() + "\n")
        return "".join(lines)
