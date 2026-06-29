from __future__ import annotations

import pytest

from app.models.composition import Captions
from app.services.caption_formats import (
    SRT_MEDIA_TYPE,
    WEBVTT_MEDIA_TYPE,
    ass_text,
    caption_sidecar_bytes,
    caption_sidecar_spec,
    plan_caption_cues,
    srt_text,
    webvtt_text,
)


def _captions(**overrides: object) -> Captions:
    payload: dict[str, object] = {
        "mode": "sidecar",
        "format": "srt",
        "cues": [
            {
                "start": 0.0,
                "end": 1.0,
                "text": "Hello",
            }
        ],
    }
    payload.update(overrides)
    return Captions.model_validate(payload)


def test_plan_caption_cues_orders_by_start_time() -> None:
    captions = _captions(
        cues=[
            {"start": 2.0, "end": 3.0, "text": "Third"},
            {"start": 0.0, "end": 0.5, "text": "First"},
            {"start": 1.0, "end": 1.5, "text": "Second"},
        ]
    )

    planned = plan_caption_cues(captions)

    assert [(cue.index, cue.start, cue.end, cue.text) for cue in planned] == [
        (1, 0.0, 0.5, "First"),
        (2, 1.0, 1.5, "Second"),
        (3, 2.0, 3.0, "Third"),
    ]


def test_srt_serialization_escapes_text_and_uses_deterministic_timestamps() -> None:
    captions = _captions(
        cues=[
            {
                "start": 0.0,
                "end": 1.235,
                "text": "A <tag> --> B\nSecond line",
            },
            {
                "start": 61.0,
                "end": 62.25,
                "text": "Later",
            },
        ]
    )

    text = srt_text(captions)

    assert text == (
        "1\n"
        "00:00:00,000 --> 00:00:01,235\n"
        "A &lt;tag&gt; --&gt; B\n"
        "Second line\n"
        "\n"
        "2\n"
        "00:01:01,000 --> 00:01:02,250\n"
        "Later\n"
    )
    assert caption_sidecar_bytes(captions) == text.encode("utf-8")


def test_webvtt_serialization_has_header_and_escapes_arrow_tokens() -> None:
    captions = _captions(
        format="webvtt",
        cues=[
            {
                "start": 0.25,
                "end": 2.5,
                "text": "One --> two & three",
            }
        ],
    )

    text = webvtt_text(captions)

    assert text == (
        "WEBVTT\n\n00:00:00.250 --> 00:00:02.500\nOne --&gt; two &amp; three\n"
    )
    assert caption_sidecar_bytes(captions) == text.encode("utf-8")


def test_ass_serialization_escapes_burn_in_text_and_maps_style() -> None:
    captions = _captions(
        mode="burn-in",
        cues=[
            {
                "start": 3661.5,
                "end": 3662.75,
                "text": r"C:\tmp {unsafe}" + "\nnext",
            }
        ],
        style={
            "font_family": "Inter",
            "font_size": 36,
            "color": "#336699",
            "outline_color": "#000000",
            "background_color": "#111111",
            "position": "top",
            "align": "right",
            "opacity": 0.5,
            "margin_v": 24,
        },
    )

    text = ass_text(captions)

    assert "Style: Default,Inter,36,&H80996633,&H80996633,&H00000000" in text
    assert ",9,24,24,24,1" in text
    assert (
        r"Dialogue: 0,1:01:01.50,1:01:02.75,Default,,0,0,0,,"
        r"C:\\tmp \{unsafe\}\Nnext"
    ) in text


def test_caption_sidecar_spec_uses_safe_deterministic_names() -> None:
    srt_spec = caption_sidecar_spec("render_abc123", _captions(format="srt"))
    webvtt_spec = caption_sidecar_spec("render_abc123", _captions(format="webvtt"))

    assert srt_spec.suffix == ".srt"
    assert srt_spec.media_type == SRT_MEDIA_TYPE
    assert srt_spec.filename == "render_abc123-captions.srt"
    assert webvtt_spec.suffix == ".vtt"
    assert webvtt_spec.media_type == WEBVTT_MEDIA_TYPE
    assert webvtt_spec.filename == "render_abc123-captions.vtt"


def test_sidecar_bytes_rejects_burn_in_mode() -> None:
    captions = _captions(mode="burn-in")

    with pytest.raises(ValueError, match="Only sidecar caption mode"):
        caption_sidecar_bytes(captions)


def test_sidecar_spec_rejects_path_like_render_ids() -> None:
    with pytest.raises(ValueError, match="Invalid render ID"):
        caption_sidecar_spec("../render", _captions())
