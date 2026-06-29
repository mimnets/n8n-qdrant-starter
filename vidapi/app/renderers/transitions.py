from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.models.composition import (
    AudioAsset,
    Clip,
    Composition,
    Transition,
    TransitionPlacement,
    TransitionType,
)

EPSILON = 1e-6

EDITLY_TRANSITION_NAMES: dict[TransitionType, str] = {
    TransitionType.FADE_IN: "fade",
    TransitionType.FADE_OUT: "fade",
    TransitionType.CROSSFADE: "fade",
    TransitionType.DIRECTIONAL_LEFT: "directional-left",
    TransitionType.DIRECTIONAL_RIGHT: "directional-right",
    TransitionType.DIRECTIONAL_UP: "directional-up",
    TransitionType.DIRECTIONAL_DOWN: "directional-down",
    TransitionType.WIPE_LEFT: "wipeLeft",
    TransitionType.WIPE_RIGHT: "wipeRight",
    TransitionType.WIPE_UP: "wipeUp",
    TransitionType.WIPE_DOWN: "wipeDown",
    TransitionType.CROSS_ZOOM: "CrossZoom",
    TransitionType.SIMPLE_ZOOM: "SimpleZoom",
    TransitionType.CIRCLE_OPEN: "circleopen",
    TransitionType.LINEAR_BLUR: "LinearBlur",
}

EDITLY_SUPPORTED_TRANSITIONS: frozenset[TransitionType] = frozenset(
    EDITLY_TRANSITION_NAMES
)


@dataclass(frozen=True)
class TransitionValidationIssue:
    """Stable, redacted transition validation issue."""

    field: str
    message: str
    limit: int | float
    observed: int | float


@dataclass(frozen=True)
class PlannedTransition:
    """Validated transition assigned to one rendered segment boundary."""

    boundary: float
    field: str
    transition: Transition
    track_index: int
    clip_index: int
    successor_clip_index: int | None = None


class TransitionValidationError(ValueError):
    """Raised when transition plans cannot be compiled safely."""

    def __init__(self, issues: tuple[TransitionValidationIssue, ...]) -> None:
        if not issues:
            msg = "TransitionValidationError requires at least one issue"
            raise ValueError(msg)
        self.issues = issues
        super().__init__(issues[0].message)


@dataclass(frozen=True)
class _ClipRef:
    track_index: int
    clip_index: int
    clip: Clip

    @property
    def start(self) -> float:
        return self.clip.start

    @property
    def end(self) -> float:
        return self.clip.start + self.clip.length

    @property
    def transition_field(self) -> str:
        return (
            f"timeline.tracks[{self.track_index}].clips[{self.clip_index}].transition"
        )


def editly_transition_payload(transition: Transition) -> dict[str, Any]:
    """Return a deterministic Editly transition payload for a public transition."""
    return {
        "name": EDITLY_TRANSITION_NAMES[transition.name],
        "duration": round(transition.duration, 6),
    }


def validate_transition_semantics(
    composition: Composition,
) -> tuple[TransitionValidationIssue, ...]:
    """Return transition issues without side effects."""
    _, issues = _collect_transition_facts(composition)
    return issues


def plan_transition_effects(composition: Composition) -> tuple[PlannedTransition, ...]:
    """Return validated transition plans or raise a redacted validation error."""
    plans, issues = _collect_transition_facts(composition)
    if issues:
        raise TransitionValidationError(issues)
    return tuple(
        sorted(
            plans,
            key=lambda plan: (
                round(plan.boundary, 6),
                plan.track_index,
                plan.clip_index,
            ),
        )
    )


def transition_plan_by_boundary(
    plans: tuple[PlannedTransition, ...],
) -> dict[float, PlannedTransition]:
    """Index validated transition plans by rounded boundary time."""
    return {round(plan.boundary, 6): plan for plan in plans}


def _collect_transition_facts(
    composition: Composition,
) -> tuple[list[PlannedTransition], tuple[TransitionValidationIssue, ...]]:
    plans: list[PlannedTransition] = []
    issues: list[TransitionValidationIssue] = []

    for track_index, track in enumerate(composition.timeline.tracks):
        visual_refs: list[_ClipRef] = []
        for clip_index, clip in enumerate(track.clips):
            ref = _ClipRef(track_index=track_index, clip_index=clip_index, clip=clip)
            if isinstance(clip.asset, AudioAsset):
                if clip.transition is not None:
                    issues.append(
                        _issue(
                            field=f"{ref.transition_field}.name",
                            message="Transitions can only be applied to visual clips",
                            limit=1,
                            observed=0,
                        )
                    )
                continue
            visual_refs.append(ref)

        visual_refs.sort(key=lambda ref: (ref.start, ref.end, ref.clip_index))
        for ref in visual_refs:
            transition = ref.clip.transition
            if transition is None:
                continue
            if transition.placement is TransitionPlacement.BETWEEN:
                _append_between_plan(ref, visual_refs, plans, issues)
            elif transition.placement is TransitionPlacement.OUT:
                plans.append(
                    PlannedTransition(
                        boundary=ref.end,
                        field=ref.transition_field,
                        transition=transition,
                        track_index=ref.track_index,
                        clip_index=ref.clip_index,
                    )
                )
            elif ref.start > EPSILON:
                plans.append(
                    PlannedTransition(
                        boundary=ref.start,
                        field=ref.transition_field,
                        transition=transition,
                        track_index=ref.track_index,
                        clip_index=ref.clip_index,
                    )
                )

    _append_conflict_issues(plans, issues)
    return plans, tuple(issues)


def _append_between_plan(
    ref: _ClipRef,
    visual_refs: list[_ClipRef],
    plans: list[PlannedTransition],
    issues: list[TransitionValidationIssue],
) -> None:
    transition = ref.clip.transition
    if transition is None:
        return

    overlaps = [
        other
        for other in visual_refs
        if other.clip_index != ref.clip_index
        and other.start < ref.end - EPSILON
        and other.end > ref.start + EPSILON
    ]
    if overlaps:
        issues.append(
            _issue(
                field=ref.transition_field,
                message="Between transitions require non-overlapping same-track clips",
                limit=0,
                observed=len(overlaps),
            )
        )
        return

    exact_successors = [
        other
        for other in visual_refs
        if other.clip_index != ref.clip_index and abs(other.start - ref.end) < EPSILON
    ]
    if len(exact_successors) > 1:
        issues.append(
            _issue(
                field=ref.transition_field,
                message="Between transitions require one same-track successor",
                limit=1,
                observed=len(exact_successors),
            )
        )
        return
    if not exact_successors:
        next_refs = [
            other
            for other in visual_refs
            if other.clip_index != ref.clip_index and other.start > ref.start + EPSILON
        ]
        next_ref = min(next_refs, key=lambda other: other.start, default=None)
        gap = 0.0 if next_ref is None else max(0.0, next_ref.start - ref.end)
        issues.append(
            _issue(
                field=ref.transition_field,
                message="Between transitions require an exact same-track successor",
                limit=0,
                observed=round(gap, 6),
            )
        )
        return

    successor = exact_successors[0]
    if transition.duration > successor.clip.length + EPSILON:
        issues.append(
            _issue(
                field=f"{ref.transition_field}.duration",
                message="Between transition duration must fit incoming clip length",
                limit=round(successor.clip.length, 6),
                observed=round(transition.duration, 6),
            )
        )
        return

    plans.append(
        PlannedTransition(
            boundary=ref.end,
            field=ref.transition_field,
            transition=transition,
            track_index=ref.track_index,
            clip_index=ref.clip_index,
            successor_clip_index=successor.clip_index,
        )
    )


def _append_conflict_issues(
    plans: list[PlannedTransition],
    issues: list[TransitionValidationIssue],
) -> None:
    by_boundary: dict[float, list[PlannedTransition]] = {}
    for plan in plans:
        by_boundary.setdefault(round(plan.boundary, 6), []).append(plan)

    for boundary, boundary_plans in sorted(by_boundary.items()):
        if len(boundary_plans) <= 1:
            continue
        issues.append(
            _issue(
                field=f"timeline.transitions.boundaries[{boundary:.6f}]",
                message="Multiple transitions requested at one rendered boundary",
                limit=1,
                observed=len(boundary_plans),
            )
        )


def _issue(
    *,
    field: str,
    message: str,
    limit: int | float,
    observed: int | float,
) -> TransitionValidationIssue:
    return TransitionValidationIssue(
        field=field,
        message=message,
        limit=limit,
        observed=observed,
    )
