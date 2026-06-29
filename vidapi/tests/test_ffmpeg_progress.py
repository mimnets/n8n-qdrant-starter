"""Unit tests for FFmpeg stderr progress parser."""

from __future__ import annotations

from app.services.ffmpeg_progress import compute_progress_percent, parse_time_from_line


class TestParseTimeFromLine:
    """Tests for parse_time_from_line()."""

    def test_normal_time_output(self):
        line = (
            "frame=  120 fps= 30 q=28.0 size=     256kB"
            " time=00:00:04.00 bitrate= 524.3kbits/s"
        )
        assert parse_time_from_line(line) == 4.0

    def test_time_with_hours(self):
        line = (
            "frame= 7200 fps= 30 q=28.0 size=   12800kB"
            " time=01:02:30.50 bitrate= 524.3kbits/s"
        )
        result = parse_time_from_line(line)
        assert result is not None
        assert abs(result - 3750.5) < 0.01

    def test_time_with_milliseconds(self):
        line = (
            "frame=  60 fps= 30 q=28.0 size=     128kB"
            " time=00:00:02.500 bitrate= 524.3kbits/s"
        )
        result = parse_time_from_line(line)
        assert result is not None
        assert abs(result - 2.5) < 0.001

    def test_time_at_zero(self):
        line = "frame=    0 fps=0.0 q=0.0 size=       0kB time=00:00:00.00 bitrate=N/A"
        assert parse_time_from_line(line) == 0.0

    def test_time_exactly_100_seconds(self):
        line = (
            "frame= 3000 fps= 30 q=28.0 size=    5120kB"
            " time=00:01:40.00 bitrate= 524.3kbits/s"
        )
        assert parse_time_from_line(line) == 100.0

    def test_malformed_line_no_time(self):
        line = "Press [q] to stop, [?] for help"
        assert parse_time_from_line(line) is None

    def test_empty_input(self):
        assert parse_time_from_line("") is None

    def test_only_whitespace(self):
        assert parse_time_from_line("   \t  ") is None

    def test_negative_time_returns_none(self):
        line = "frame=    0 fps=0.0 q=0.0 size=       0kB time=-00:00:00.01 bitrate=N/A"
        assert parse_time_from_line(line) is None

    def test_partial_time_marker(self):
        line = "time="
        assert parse_time_from_line(line) is None

    def test_time_with_space_after_equals(self):
        line = (
            "frame=  120 fps= 30 q=28.0 size=     256kB"
            " time= 00:00:10.50 bitrate= 524.3kbits/s"
        )
        result = parse_time_from_line(line)
        assert result is not None
        assert abs(result - 10.5) < 0.01

    def test_very_long_duration(self):
        line = (
            "frame=360000 fps= 30 q=28.0 size=  640000kB"
            " time=100:00:00.00 bitrate= 524.3kbits/s"
        )
        result = parse_time_from_line(line)
        assert result is not None
        assert result == 360000.0

    def test_non_ffmpeg_output(self):
        line = "[info] Encoding video..."
        assert parse_time_from_line(line) is None

    def test_garbled_time_value(self):
        line = "time=xx:yy:zz.aa"
        assert parse_time_from_line(line) is None


class TestComputeProgressPercent:
    """Tests for compute_progress_percent()."""

    def test_zero_elapsed(self):
        assert compute_progress_percent(0.0, 10.0) == 0

    def test_half_progress(self):
        assert compute_progress_percent(5.0, 10.0) == 50

    def test_full_progress(self):
        assert compute_progress_percent(10.0, 10.0) == 100

    def test_over_100_clamped(self):
        assert compute_progress_percent(15.0, 10.0) == 100

    def test_zero_duration_returns_zero(self):
        assert compute_progress_percent(5.0, 0.0) == 0

    def test_negative_duration_returns_zero(self):
        assert compute_progress_percent(5.0, -1.0) == 0

    def test_negative_elapsed_clamped(self):
        assert compute_progress_percent(-1.0, 10.0) == 0

    def test_small_progress_floors(self):
        result = compute_progress_percent(0.1, 10.0)
        assert result == 1

    def test_very_short_duration(self):
        result = compute_progress_percent(0.01, 0.02)
        assert result == 50

    def test_very_long_duration(self):
        result = compute_progress_percent(1800.0, 3600.0)
        assert result == 50

    def test_99_percent(self):
        result = compute_progress_percent(9.9, 10.0)
        assert result == 99
