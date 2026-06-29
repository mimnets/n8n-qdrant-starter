from __future__ import annotations

import re

import structlog

logger = structlog.get_logger(__name__)

_MERGE_PATTERN = re.compile(r"\{\{(\w+)\}\}")


class MergeError(Exception):
    """Raised when merge variable expansion fails."""


def expand_merge_variables(
    composition_json: str,
    merge: dict[str, str | int | float | bool] | None,
) -> str:
    """Substitute ``{{var}}`` placeholders in the serialized composition JSON.

    Returns the JSON string with all placeholders replaced.
    If ``merge`` is None or empty, returns the original string unchanged.
    Raises ``MergeError`` if a placeholder references a variable not present
    in the merge dict.
    """
    if not merge:
        return composition_json

    missing: list[str] = []

    def _replace(match: re.Match[str]) -> str:
        key = match.group(1)
        if key not in merge:
            missing.append(key)
            return match.group(0)
        value = merge[key]
        if isinstance(value, bool):
            return "true" if value else "false"
        return str(value)

    result = _MERGE_PATTERN.sub(_replace, composition_json)

    if missing:
        raise MergeError(
            f"Undefined merge variables: {', '.join(sorted(set(missing)))}"
        )

    logger.info(
        "merge_variables_expanded",
        variable_count=len(merge),
    )
    return result
