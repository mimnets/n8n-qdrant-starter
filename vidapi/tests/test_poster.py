from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

from app.renderers.poster import (
    PosterError,
    build_poster_command,
    generate_poster,
)


class TestBuildPosterCommand:
    def test_basic_command(self, tmp_path: Path):
        video = tmp_path / "output.mp4"
        poster = tmp_path / "poster.jpg"

        cmd = build_poster_command(
            video_path=video,
            output_path=poster,
            seek_seconds=2.5,
            quality=85,
        )

        assert cmd[0] == "ffmpeg"
        assert "-y" in cmd
        assert "-ss" in cmd
        ss_idx = cmd.index("-ss")
        assert cmd[ss_idx + 1] == "2.500"
        assert "-i" in cmd
        i_idx = cmd.index("-i")
        assert cmd[i_idx + 1] == str(video)
        assert "-frames:v" in cmd
        assert "1" in cmd
        assert str(poster) == cmd[-1]

    def test_quality_parameter(self, tmp_path: Path):
        video = tmp_path / "output.mp4"
        poster = tmp_path / "poster.jpg"

        cmd = build_poster_command(
            video_path=video,
            output_path=poster,
            seek_seconds=0.0,
            quality=50,
        )

        qv_idx = cmd.index("-q:v")
        q_val = int(cmd[qv_idx + 1])
        assert 1 <= q_val <= 31

    def test_seek_zero(self, tmp_path: Path):
        video = tmp_path / "output.mp4"
        poster = tmp_path / "poster.jpg"

        cmd = build_poster_command(
            video_path=video,
            output_path=poster,
            seek_seconds=0.0,
            quality=85,
        )

        ss_idx = cmd.index("-ss")
        assert cmd[ss_idx + 1] == "0.000"


@pytest.mark.asyncio
class TestGeneratePoster:
    async def test_missing_video_raises(self, tmp_path: Path):
        video = tmp_path / "nonexistent.mp4"
        poster = tmp_path / "poster.jpg"

        with pytest.raises(PosterError, match="Video file not found"):
            await generate_poster(video, poster)

    async def test_ffmpeg_not_found(self, tmp_path: Path):
        video = tmp_path / "output.mp4"
        video.write_bytes(b"fake video data")
        poster = tmp_path / "poster.jpg"

        with patch("app.renderers.poster.asyncio.create_subprocess_exec") as mock_exec:
            mock_exec.side_effect = FileNotFoundError("ffmpeg")
            with pytest.raises(PosterError, match="ffmpeg not found"):
                await generate_poster(video, poster)

    async def test_timeout_handling(self, tmp_path: Path):
        video = tmp_path / "output.mp4"
        video.write_bytes(b"fake video data")
        poster = tmp_path / "poster.jpg"

        mock_proc = AsyncMock()
        mock_proc.communicate = AsyncMock(side_effect=TimeoutError)
        mock_proc.kill = lambda: None
        mock_proc.wait = AsyncMock(return_value=None)

        with patch("app.renderers.poster.asyncio.create_subprocess_exec") as mock_exec:
            mock_exec.return_value = mock_proc
            with pytest.raises(PosterError, match="timed out"):
                await generate_poster(video, poster)
