from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

from app.services.ffprobe import FFProbeError, _parse_probe_output, probe


class TestParseProbeOutput:
    """Unit tests for ffprobe JSON parsing."""

    def test_parses_video_and_audio_streams(self) -> None:
        data = {
            "format": {
                "duration": "10.5",
                "format_name": "mov,mp4,m4a,3gp,3g2,mj2",
            },
            "streams": [
                {
                    "codec_type": "video",
                    "codec_name": "h264",
                    "width": 1920,
                    "height": 1080,
                },
                {
                    "codec_type": "audio",
                    "codec_name": "aac",
                },
            ],
        }
        info = _parse_probe_output(data)
        assert info.duration == 10.5
        assert info.width == 1920
        assert info.height == 1080
        assert info.video_codec == "h264"
        assert info.audio_codec == "aac"
        assert info.stream_count == 2
        assert info.format_name == "mov,mp4,m4a,3gp,3g2,mj2"

    def test_handles_audio_only(self) -> None:
        data = {
            "format": {"duration": "180.0", "format_name": "mp3"},
            "streams": [
                {"codec_type": "audio", "codec_name": "mp3"},
            ],
        }
        info = _parse_probe_output(data)
        assert info.duration == 180.0
        assert info.video_codec is None
        assert info.audio_codec == "mp3"
        assert info.width is None
        assert info.height is None

    def test_handles_empty_streams(self) -> None:
        data = {"format": {}, "streams": []}
        info = _parse_probe_output(data)
        assert info.stream_count == 0
        assert info.video_codec is None
        assert info.audio_codec is None

    def test_handles_missing_format(self) -> None:
        data = {"streams": []}
        info = _parse_probe_output(data)
        assert info.duration is None
        assert info.format_name is None

    def test_handles_non_numeric_duration(self) -> None:
        data = {"format": {"duration": "N/A"}, "streams": []}
        info = _parse_probe_output(data)
        assert info.duration is None


class TestProbeAsync:
    """Async probe function tests with mocked subprocess."""

    @pytest.mark.asyncio
    async def test_probe_success(self, tmp_path: Path) -> None:
        probe_output = json.dumps(
            {
                "format": {"duration": "5.0", "format_name": "mp4"},
                "streams": [
                    {
                        "codec_type": "video",
                        "codec_name": "h264",
                        "width": 640,
                        "height": 480,
                    },
                ],
            }
        ).encode()

        mock_proc = AsyncMock()
        mock_proc.communicate = AsyncMock(return_value=(probe_output, b""))
        mock_proc.returncode = 0

        with patch(
            "app.services.ffprobe.asyncio.create_subprocess_exec",
            return_value=mock_proc,
        ):
            info = await probe(tmp_path / "test.mp4")

        assert info.duration == 5.0
        assert info.video_codec == "h264"
        assert info.width == 640

    @pytest.mark.asyncio
    async def test_probe_nonzero_exit(self, tmp_path: Path) -> None:
        mock_proc = AsyncMock()
        mock_proc.communicate = AsyncMock(
            return_value=(b"", b"error message"),
        )
        mock_proc.returncode = 1

        with (
            patch(
                "app.services.ffprobe.asyncio.create_subprocess_exec",
                return_value=mock_proc,
            ),
            pytest.raises(FFProbeError, match="exited with code 1"),
        ):
            await probe(tmp_path / "bad.mp4")

    @pytest.mark.asyncio
    async def test_probe_invalid_json(self, tmp_path: Path) -> None:
        mock_proc = AsyncMock()
        mock_proc.communicate = AsyncMock(
            return_value=(b"not json", b""),
        )
        mock_proc.returncode = 0

        with (
            patch(
                "app.services.ffprobe.asyncio.create_subprocess_exec",
                return_value=mock_proc,
            ),
            pytest.raises(FFProbeError, match="parse"),
        ):
            await probe(tmp_path / "test.mp4")
