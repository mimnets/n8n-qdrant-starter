"""FFmpeg stderr progress parser with time-based extraction.

Parses FFmpeg output lines to extract `time=HH:MM:SS.ss` markers and
computes render progress as a percentage of total duration. All parsing
is best-effort: malformed lines return None rather than raising.
"""

from __future__ import annotations

import re

_TIME_PATTERN = re.compile(r"time=\s*(\d{1,3}):(\d{2}):(\d{2})\.(\d{2,3})")

_NEGATIVE_TIME_PATTERN = re.compile(r"time=\s*-")


def parse_time_from_line(line: str) -> float | None:
    """Extract elapsed seconds from an FFmpeg stderr line.

    Returns None if the line does not contain a valid time= marker
    or if the time is negative (bitexact mode early output).
    """
    if _NEGATIVE_TIME_PATTERN.search(line):
        return None

    match = _TIME_PATTERN.search(line)
    if match is None:
        return None

    hours = int(match.group(1))
    minutes = int(match.group(2))
    seconds = int(match.group(3))
    centiseconds = match.group(4)

    if len(centiseconds) == 2:
        frac = int(centiseconds) / 100.0
    else:
        frac = int(centiseconds) / 1000.0

    total = hours * 3600.0 + minutes * 60.0 + seconds + frac
    return total


def compute_progress_percent(
    elapsed_seconds: float,
    total_duration: float,
) -> int:
    """Compute progress percentage (0-100) from elapsed time and total duration.

    Clamps output to [0, 100]. Returns 0 if total_duration is zero or negative.
    """
    if total_duration <= 0.0:
        return 0

    raw = (elapsed_seconds / total_duration) * 100.0

    if raw < 0.0:
        return 0
    if raw > 100.0:
        return 100

    return int(raw)
