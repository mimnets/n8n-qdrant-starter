from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.core.config import Settings
from app.models.composition import (
    AudioAsset,
    Clip,
    ColorAsset,
    Composition,
    Output,
    Timeline,
    Track,
    Transition,
    TransitionPlacement,
    TransitionType,
    VideoAsset,
)
from app.renderers.base import CompileError
from app.renderers.editly import (
    assemble_editly_spec,
    collect_boundaries,
    compute_total_duration,
    generate_segments,
)
from app.services.limits import LimitExceededError, validate_composition_limits


def _compile_spec(composition: Composition) -> dict:
    tracks = composition.timeline.tracks
    total_duration = compute_total_duration(tracks)
    boundaries = collect_boundaries(tracks, total_duration)
    segments = generate_segments(boundaries, tracks)
    return assemble_editly_spec(segments, composition, "/out.mp4")


def test_transition_type_sets_expected_placement() -> None:
    transition = Transition(name=TransitionType.CROSSFADE, duration=0.5)

    assert transition.name == TransitionType.CROSSFADE
    assert transition.placement == TransitionPlacement.BETWEEN


@pytest.mark.parametrize(
    ("input_name", "expected"),
    [
        ("fadeIn", TransitionType.FADE_IN),
        ("fadeOut", TransitionType.FADE_OUT),
        ("fade-in", TransitionType.FADE_IN),
        ("fade-out", TransitionType.FADE_OUT),
        ("directional-left", TransitionType.DIRECTIONAL_LEFT),
        ("wipe-right", TransitionType.WIPE_RIGHT),
        ("crosszoom", TransitionType.CROSS_ZOOM),
        ("simple-zoom", TransitionType.SIMPLE_ZOOM),
        ("circleopen", TransitionType.CIRCLE_OPEN),
        ("linear-blur", TransitionType.LINEAR_BLUR),
    ],
)
def test_transition_aliases_normalize(
    input_name: str,
    expected: TransitionType,
) -> None:
    assert Transition(name=input_name).name == expected


def test_transition_rejects_unsupported_name() -> None:
    with pytest.raises(ValidationError, match="Input should be"):
        Transition(name="wipe")


def test_transition_rejects_mismatched_placement() -> None:
    with pytest.raises(ValidationError, match="must use placement"):
        Transition(name="fade_out", placement="in")


def test_advanced_transition_defaults_to_between_placement() -> None:
    transition = Transition(name="wipe_left", duration=0.5)

    assert transition.name == TransitionType.WIPE_LEFT
    assert transition.placement == TransitionPlacement.BETWEEN


def test_advanced_transition_rejects_mismatched_placement() -> None:
    with pytest.raises(ValidationError, match="must use placement"):
        Transition(name="linear_blur", placement="out")


def test_clip_rejects_transition_duration_longer_than_clip() -> None:
    with pytest.raises(ValidationError, match="less than or equal to clip length"):
        Clip(
            asset=ColorAsset(type="color", color="#000"),
            length=1.0,
            transition={"name": "fade_out", "duration": 2.0},
        )


def test_fade_out_transition_emits_clip_transition() -> None:
    composition = Composition(
        timeline=Timeline(
            tracks=[
                Track(
                    clips=[
                        Clip(
                            asset=VideoAsset(type="video", src="a.mp4"),
                            start=0,
                            length=2,
                            transition={"name": "fade_out", "duration": 0.4},
                        )
                    ]
                )
            ]
        ),
        output=Output(width=1280, height=720),
    )

    spec = _compile_spec(composition)

    assert spec["clips"][0]["transition"] == {"name": "fade", "duration": 0.4}


def test_fade_in_transition_emits_on_preceding_gap() -> None:
    composition = Composition(
        timeline=Timeline(
            background="#101010",
            tracks=[
                Track(
                    clips=[
                        Clip(
                            asset=VideoAsset(type="video", src="a.mp4"),
                            start=1,
                            length=2,
                            transition={"name": "fade_in", "duration": 0.25},
                        )
                    ]
                )
            ],
        ),
        output=Output(width=1280, height=720),
    )

    spec = _compile_spec(composition)

    assert spec["clips"][0]["layers"] == [{"type": "fill-color", "color": "#101010"}]
    assert spec["clips"][0]["transition"] == {"name": "fade", "duration": 0.25}


def test_crossfade_transition_emits_between_sequential_same_track_clips() -> None:
    composition = Composition(
        timeline=Timeline(
            tracks=[
                Track(
                    clips=[
                        Clip(
                            asset=VideoAsset(type="video", src="a.mp4"),
                            start=0,
                            length=2,
                            transition={"name": "crossfade", "duration": 0.5},
                        ),
                        Clip(
                            asset=VideoAsset(type="video", src="b.mp4"),
                            start=2,
                            length=2,
                        ),
                    ]
                )
            ]
        ),
        output=Output(width=1280, height=720),
    )

    spec = _compile_spec(composition)

    assert spec["clips"][0]["transition"] == {"name": "fade", "duration": 0.5}


def test_crossfade_ignored_without_same_track_successor() -> None:
    composition = Composition(
        timeline=Timeline(
            tracks=[
                Track(
                    clips=[
                        Clip(
                            asset=VideoAsset(type="video", src="a.mp4"),
                            start=0,
                            length=2,
                            transition={"name": "crossfade", "duration": 0.5},
                        )
                    ]
                ),
                Track(
                    clips=[
                        Clip(
                            asset=VideoAsset(type="video", src="b.mp4"),
                            start=2,
                            length=2,
                        )
                    ]
                ),
            ]
        ),
        output=Output(width=1280, height=720),
    )

    with pytest.raises(CompileError, match="exact same-track successor"):
        _compile_spec(composition)


def test_between_transition_rejects_gap_before_renderer() -> None:
    composition = Composition(
        timeline=Timeline(
            tracks=[
                Track(
                    clips=[
                        Clip(
                            asset=VideoAsset(type="video", src="a.mp4"),
                            start=0,
                            length=2,
                            transition={"name": "wipe_left", "duration": 0.5},
                        ),
                        Clip(
                            asset=VideoAsset(type="video", src="b.mp4"),
                            start=3,
                            length=2,
                        ),
                    ]
                )
            ]
        ),
        output=Output(width=1280, height=720),
    )

    with pytest.raises(LimitExceededError) as exc_info:
        validate_composition_limits(composition, Settings())

    violation = exc_info.value.violation
    assert violation.field == "timeline.tracks[0].clips[0].transition"
    assert violation.observed == 1.0


def test_between_transition_rejects_same_track_overlap() -> None:
    composition = Composition(
        timeline=Timeline(
            tracks=[
                Track(
                    clips=[
                        Clip(
                            asset=VideoAsset(type="video", src="a.mp4"),
                            start=0,
                            length=2,
                            transition={"name": "wipe_left", "duration": 0.5},
                        ),
                        Clip(
                            asset=VideoAsset(type="video", src="b.mp4"),
                            start=1.5,
                            length=2,
                        ),
                    ]
                )
            ]
        ),
        output=Output(width=1280, height=720),
    )

    with pytest.raises(LimitExceededError) as exc_info:
        validate_composition_limits(composition, Settings())

    violation = exc_info.value.violation
    assert violation.field == "timeline.tracks[0].clips[0].transition"
    assert violation.observed == 1


def test_between_transition_rejects_incoming_duration_overrun() -> None:
    composition = Composition(
        timeline=Timeline(
            tracks=[
                Track(
                    clips=[
                        Clip(
                            asset=VideoAsset(type="video", src="a.mp4"),
                            start=0,
                            length=2,
                            transition={"name": "cross_zoom", "duration": 1.5},
                        ),
                        Clip(
                            asset=VideoAsset(type="video", src="b.mp4"),
                            start=2,
                            length=1,
                        ),
                    ]
                )
            ]
        ),
        output=Output(width=1280, height=720),
    )

    with pytest.raises(LimitExceededError) as exc_info:
        validate_composition_limits(composition, Settings())

    violation = exc_info.value.violation
    assert violation.field == "timeline.tracks[0].clips[0].transition.duration"
    assert violation.limit == 1
    assert violation.observed == 1.5


def test_multiple_transitions_at_same_rendered_boundary_are_rejected() -> None:
    composition = Composition(
        timeline=Timeline(
            tracks=[
                Track(
                    clips=[
                        Clip(
                            asset=VideoAsset(type="video", src="a.mp4"),
                            start=0,
                            length=2,
                            transition={"name": "wipe_left", "duration": 0.4},
                        ),
                        Clip(
                            asset=VideoAsset(type="video", src="b.mp4"),
                            start=2,
                            length=2,
                        ),
                    ]
                ),
                Track(
                    clips=[
                        Clip(
                            asset=VideoAsset(type="video", src="c.mp4"),
                            start=0,
                            length=2,
                            transition={"name": "fade_out", "duration": 0.4},
                        )
                    ]
                ),
            ]
        ),
        output=Output(width=1280, height=720),
    )

    with pytest.raises(LimitExceededError) as exc_info:
        validate_composition_limits(composition, Settings())

    violation = exc_info.value.violation
    assert violation.field == "timeline.transitions.boundaries[2.000000]"
    assert violation.limit == 1
    assert violation.observed == 2


def test_transition_on_audio_clip_is_rejected_before_renderer() -> None:
    composition = Composition(
        timeline=Timeline(
            tracks=[
                Track(
                    clips=[
                        Clip(
                            asset=AudioAsset(type="audio", src="a.mp3"),
                            start=0,
                            length=2,
                            transition={"name": "fade_out", "duration": 0.4},
                        )
                    ]
                )
            ]
        ),
        output=Output(width=1280, height=720),
    )

    with pytest.raises(LimitExceededError) as exc_info:
        validate_composition_limits(composition, Settings())

    assert exc_info.value.violation.field == (
        "timeline.tracks[0].clips[0].transition.name"
    )


def test_advanced_transition_emits_deterministic_editly_name() -> None:
    composition = Composition(
        timeline=Timeline(
            tracks=[
                Track(
                    clips=[
                        Clip(
                            asset=VideoAsset(type="video", src="a.mp4"),
                            start=0,
                            length=2,
                            transition={"name": "wipe_left", "duration": 0.4},
                        ),
                        Clip(
                            asset=VideoAsset(type="video", src="b.mp4"),
                            start=2,
                            length=2,
                        ),
                    ]
                )
            ]
        ),
        output=Output(width=1280, height=720),
    )

    spec = _compile_spec(composition)

    assert spec["clips"][0]["transition"] == {"name": "wipeLeft", "duration": 0.4}
