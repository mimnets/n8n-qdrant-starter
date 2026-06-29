from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from app.core.config import Settings
from app.models.composition import Captions, PosterOptions
from app.renderers.base import RenderArtifact
from app.renderers.poster import PosterError, generate_poster, resolve_poster_plan
from app.services.caption_finishing import (
    CaptionFinisher,
    CaptionFinishingError,
    build_caption_burn_in_command,
    caption_burn_in_media_type,
    escape_subtitles_filter_path,
)


class FakeProcess:
    def __init__(
        self,
        *,
        returncode: int | None = 0,
        stderr: bytes = b"",
        sleep_forever: bool = False,
    ) -> None:
        self.returncode = returncode
        self._stderr = stderr
        self._sleep_forever = sleep_forever
        self.was_terminated = False
        self.was_killed = False

    async def communicate(self) -> tuple[bytes, bytes]:
        if self._sleep_forever:
            await asyncio.sleep(60)
        return b"", self._stderr

    def terminate(self) -> None:
        self.was_terminated = True
        self.returncode = -15

    def kill(self) -> None:
        self.was_killed = True
        self.returncode = -9

    async def wait(self) -> int | None:
        return self.returncode


def _captions(**overrides: object) -> Captions:
    payload: dict[str, object] = {
        "mode": "sidecar",
        "format": "srt",
        "cues": [
            {"start": 0.0, "end": 1.0, "text": "Hello"},
        ],
    }
    payload.update(overrides)
    return Captions.model_validate(payload)


def _artifact(tmp_path: Path) -> RenderArtifact:
    output_path = tmp_path / "input.mp4"
    output_path.write_bytes(b"video")
    log_path = tmp_path / "render.log"
    log_path.write_text("render log", encoding="utf-8")
    return RenderArtifact(
        output_path=output_path,
        poster_path=None,
        log_path=log_path,
        duration_seconds=2.0,
        exit_code=0,
    )


def test_caption_burn_in_command_escapes_filter_path() -> None:
    input_path = Path("/tmp/input.mp4")
    ass_path = Path("/tmp/captions:a,b[0]'x.ass")
    output_path = Path("/tmp/output.mp4")

    command = build_caption_burn_in_command(
        "ffmpeg",
        input_path,
        ass_path,
        output_path,
    )

    assert command[:4] == ["ffmpeg", "-y", "-i", str(input_path)]
    filter_arg = command[command.index("-vf") + 1]
    assert filter_arg == f"subtitles={escape_subtitles_filter_path(ass_path)}"
    assert r"\:" in filter_arg
    assert r"\," in filter_arg
    assert r"\[" in filter_arg
    assert r"\'" in filter_arg
    assert command[-5:] == [
        "-c:a",
        "copy",
        "-movflags",
        "+faststart",
        str(output_path),
    ]


@pytest.mark.asyncio
async def test_prepare_sidecar_writes_deterministic_caption_file(
    tmp_path: Path,
) -> None:
    finisher = CaptionFinisher(Settings())

    sidecar = await finisher.prepare_sidecar(
        captions=_captions(),
        render_id="render_abc123",
        workspace=tmp_path,
    )

    assert sidecar.path.name == "render_abc123-captions.srt"
    assert sidecar.spec.media_type == "application/x-subrip"
    assert sidecar.path.read_text(encoding="utf-8").startswith(
        "1\n00:00:00,000 --> 00:00:01,000\nHello\n"
    )


@pytest.mark.asyncio
async def test_burn_in_builds_command_and_returns_captioned_artifact(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    captured_command: list[str] = []

    async def _fake_run(
        self: CaptionFinisher,
        command: list[str],
        *,
        log_path: Path,
    ) -> None:
        captured_command.extend(command)
        Path(command[-1]).write_bytes(b"captioned-video")
        log_path.write_text("ffmpeg ok", encoding="utf-8")

    monkeypatch.setattr(CaptionFinisher, "_run_ffmpeg", _fake_run)
    finisher = CaptionFinisher(Settings(ffmpeg_bin="ffmpeg-test"))

    result = await finisher.burn_in(
        captions=_captions(mode="burn-in"),
        artifact=_artifact(tmp_path),
        render_id="render_abc123",
        workspace=tmp_path,
    )

    assert captured_command[0] == "ffmpeg-test"
    assert captured_command[-1] == str(tmp_path / "render_abc123-captioned.mp4")
    assert (tmp_path / "render_abc123-captions.ass").is_file()
    assert result.video_artifact.output_path.read_bytes() == b"captioned-video"
    assert result.burn_in_log_path == tmp_path / "render_abc123-caption-burn-in.log"
    assert caption_burn_in_media_type() == "text/x-ssa; charset=utf-8"


@pytest.mark.asyncio
async def test_ffmpeg_timeout_writes_bounded_log_and_terminates(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    fake_process = FakeProcess(returncode=None, sleep_forever=True)

    async def _fake_exec(*args: object, **kwargs: object) -> FakeProcess:
        return fake_process

    monkeypatch.setattr(asyncio, "create_subprocess_exec", _fake_exec)
    finisher = CaptionFinisher(
        Settings(
            caption_burn_in_timeout_seconds=1,
            subprocess_kill_grace_seconds=1,
            max_subprocess_stderr_bytes=4096,
        )
    )
    log_path = tmp_path / "caption.log"

    with pytest.raises(CaptionFinishingError) as exc_info:
        await finisher._run_ffmpeg(["ffmpeg", "-version"], log_path=log_path)

    assert exc_info.value.error_type == "timeout"
    assert fake_process.was_terminated is True
    assert "TIMEOUT" in log_path.read_text(encoding="utf-8")


@pytest.mark.asyncio
async def test_ffmpeg_failure_bounds_diagnostics(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    stderr = b"x" * 5000

    async def _fake_exec(*args: object, **kwargs: object) -> FakeProcess:
        return FakeProcess(returncode=1, stderr=stderr)

    monkeypatch.setattr(asyncio, "create_subprocess_exec", _fake_exec)
    finisher = CaptionFinisher(Settings(max_subprocess_stderr_bytes=4096))
    log_path = tmp_path / "caption.log"

    with pytest.raises(CaptionFinishingError) as exc_info:
        await finisher._run_ffmpeg(["ffmpeg", "-bad"], log_path=log_path)

    assert exc_info.value.error_type == "exit_error"
    assert len(exc_info.value.stderr) == 4096
    assert len(log_path.read_text(encoding="utf-8")) == 4096


def test_disabled_poster_mode_resolves_to_no_generation() -> None:
    plan = resolve_poster_plan(
        PosterOptions(mode="disabled"),
        settings=Settings(),
        video_duration=2.0,
    )

    assert plan.should_generate is False
    assert plan.seek_seconds is None


@pytest.mark.asyncio
async def test_generate_poster_disabled_mode_fails_before_subprocess(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    video = tmp_path / "output.mp4"
    video.write_bytes(b"video")
    poster = tmp_path / "poster.jpg"
    called = False

    async def _fake_exec(*args: object, **kwargs: object) -> FakeProcess:
        nonlocal called
        called = True
        return FakeProcess()

    monkeypatch.setattr(asyncio, "create_subprocess_exec", _fake_exec)

    with pytest.raises(PosterError, match="disabled"):
        await generate_poster(
            video,
            poster,
            settings=Settings(),
            video_duration=2.0,
            poster_options=PosterOptions(mode="disabled"),
        )

    assert called is False
