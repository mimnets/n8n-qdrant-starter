from __future__ import annotations

from app.models.composition import (
    Clip,
    ColorAsset,
    ImageAsset,
    TextAsset,
    Track,
    VideoAsset,
)
from app.renderers.editly import (
    EPSILON,
    collect_boundaries,
    compute_total_duration,
    generate_segments,
)


def _video_clip(start: float, length: float, src: str = "video.mp4") -> Clip:
    return Clip(asset=VideoAsset(type="video", src=src), start=start, length=length)


def _image_clip(start: float, length: float, src: str = "img.png") -> Clip:
    return Clip(asset=ImageAsset(type="image", src=src), start=start, length=length)


def _text_clip(start: float, length: float, text: str = "Hello") -> Clip:
    return Clip(asset=TextAsset(type="text", text=text), start=start, length=length)


def _color_clip(start: float, length: float, color: str = "#ff0000") -> Clip:
    return Clip(asset=ColorAsset(type="color", color=color), start=start, length=length)


class TestCollectBoundaries:
    def test_single_clip(self):
        tracks = [Track(clips=[_video_clip(0.0, 5.0)])]
        result = collect_boundaries(tracks, 5.0)
        assert result == [0.0, 5.0]

    def test_two_sequential_clips(self):
        tracks = [Track(clips=[_video_clip(0.0, 3.0), _video_clip(3.0, 2.0)])]
        result = collect_boundaries(tracks, 5.0)
        assert result == [0.0, 3.0, 5.0]

    def test_overlapping_clips_on_different_tracks(self):
        tracks = [
            Track(clips=[_video_clip(0.0, 5.0)]),
            Track(clips=[_image_clip(2.0, 3.0)]),
        ]
        result = collect_boundaries(tracks, 5.0)
        assert result == [0.0, 2.0, 5.0]

    def test_gap_between_clips(self):
        tracks = [Track(clips=[_video_clip(0.0, 2.0), _video_clip(4.0, 1.0)])]
        result = collect_boundaries(tracks, 5.0)
        assert result == [0.0, 2.0, 4.0, 5.0]

    def test_deduplicates_epsilon_boundaries(self):
        tracks = [
            Track(clips=[_video_clip(0.0, 3.0)]),
            Track(clips=[_video_clip(3.0 - EPSILON / 2, 2.0)]),
        ]
        result = collect_boundaries(tracks, 5.0)
        assert len(result) >= 2
        for i in range(len(result) - 1):
            assert result[i + 1] - result[i] > EPSILON


class TestComputeTotalDuration:
    def test_single_clip(self):
        tracks = [Track(clips=[_video_clip(0.0, 5.0)])]
        assert compute_total_duration(tracks) == 5.0

    def test_multiple_tracks(self):
        tracks = [
            Track(clips=[_video_clip(0.0, 3.0)]),
            Track(clips=[_image_clip(2.0, 5.0)]),
        ]
        assert compute_total_duration(tracks) == 7.0


class TestGenerateSegments:
    def test_single_clip_full_timeline(self):
        tracks = [Track(clips=[_video_clip(0.0, 5.0)])]
        boundaries = collect_boundaries(tracks, 5.0)
        segments = generate_segments(boundaries, tracks)

        assert len(segments) == 1
        assert abs(segments[0].start - 0.0) < EPSILON
        assert abs(segments[0].end - 5.0) < EPSILON
        assert len(segments[0].active_clips) == 1
        assert segments[0].active_clips[0].track_index == 0

    def test_two_sequential_clips(self):
        tracks = [Track(clips=[_video_clip(0.0, 3.0), _video_clip(3.0, 2.0)])]
        boundaries = collect_boundaries(tracks, 5.0)
        segments = generate_segments(boundaries, tracks)

        assert len(segments) == 2
        assert abs(segments[0].duration - 3.0) < EPSILON
        assert abs(segments[1].duration - 2.0) < EPSILON
        assert len(segments[0].active_clips) == 1
        assert len(segments[1].active_clips) == 1

    def test_overlapping_clips_on_different_tracks(self):
        tracks = [
            Track(clips=[_video_clip(0.0, 5.0)]),
            Track(clips=[_image_clip(2.0, 3.0)]),
        ]
        boundaries = collect_boundaries(tracks, 5.0)
        segments = generate_segments(boundaries, tracks)

        assert len(segments) == 2
        # First segment: only video
        assert abs(segments[0].start - 0.0) < EPSILON
        assert abs(segments[0].end - 2.0) < EPSILON
        assert len(segments[0].active_clips) == 1
        assert segments[0].active_clips[0].track_index == 0

        # Second segment: video + image overlay
        assert abs(segments[1].start - 2.0) < EPSILON
        assert abs(segments[1].end - 5.0) < EPSILON
        assert len(segments[1].active_clips) == 2
        assert segments[1].active_clips[0].track_index == 0
        assert segments[1].active_clips[1].track_index == 1

    def test_gap_between_clips(self):
        tracks = [Track(clips=[_video_clip(0.0, 2.0), _video_clip(4.0, 1.0)])]
        boundaries = collect_boundaries(tracks, 5.0)
        segments = generate_segments(boundaries, tracks)

        assert len(segments) == 3
        # First segment has video
        assert len(segments[0].active_clips) == 1
        # Gap segment has no clips
        assert len(segments[1].active_clips) == 0
        assert abs(segments[1].start - 2.0) < EPSILON
        assert abs(segments[1].end - 4.0) < EPSILON
        # Third segment has video
        assert len(segments[2].active_clips) == 1

    def test_text_overlay_partial_coverage(self):
        tracks = [
            Track(clips=[_color_clip(0.0, 10.0)]),
            Track(clips=[_text_clip(3.0, 4.0)]),
        ]
        boundaries = collect_boundaries(tracks, 10.0)
        segments = generate_segments(boundaries, tracks)

        assert len(segments) == 3
        # Segment 0-3: only background
        assert len(segments[0].active_clips) == 1
        # Segment 3-7: background + text
        assert len(segments[1].active_clips) == 2
        assert abs(segments[1].start - 3.0) < EPSILON
        assert abs(segments[1].end - 7.0) < EPSILON
        # Segment 7-10: only background
        assert len(segments[2].active_clips) == 1

    def test_track_z_order_preservation(self):
        """Higher track index = higher z-order (rendered on top)."""
        tracks = [
            Track(clips=[_color_clip(0.0, 5.0, "#000000")]),
            Track(clips=[_video_clip(0.0, 5.0)]),
            Track(clips=[_text_clip(0.0, 5.0)]),
        ]
        boundaries = collect_boundaries(tracks, 5.0)
        segments = generate_segments(boundaries, tracks)

        assert len(segments) == 1
        active = segments[0].active_clips
        assert len(active) == 3
        assert active[0].track_index == 0
        assert active[1].track_index == 1
        assert active[2].track_index == 2

    def test_clip_offset_calculation(self):
        """When a segment starts after the clip start, the offset is computed."""
        tracks = [Track(clips=[_video_clip(0.0, 10.0)])]
        boundaries = [0.0, 3.0, 10.0]
        segments = generate_segments(boundaries, tracks)

        assert len(segments) == 2
        assert abs(segments[0].active_clips[0].clip_offset - 0.0) < EPSILON
        assert abs(segments[1].active_clips[0].clip_offset - 3.0) < EPSILON

    def test_sub_second_segments(self):
        tracks = [
            Track(clips=[_video_clip(0.0, 0.5), _video_clip(0.5, 0.3)]),
        ]
        boundaries = collect_boundaries(tracks, 0.8)
        segments = generate_segments(boundaries, tracks)

        assert len(segments) == 2
        assert abs(segments[0].duration - 0.5) < EPSILON
        assert abs(segments[1].duration - 0.3) < EPSILON

    def test_identical_start_times_different_tracks(self):
        tracks = [
            Track(clips=[_video_clip(0.0, 5.0)]),
            Track(clips=[_image_clip(0.0, 3.0)]),
        ]
        boundaries = collect_boundaries(tracks, 5.0)
        segments = generate_segments(boundaries, tracks)

        assert len(segments) == 2
        # First segment: both active
        assert len(segments[0].active_clips) == 2
        # Second segment: only video from track 0
        assert len(segments[1].active_clips) == 1
        assert segments[1].active_clips[0].track_index == 0

    def test_video_trim_offset(self):
        """Clip with a trim value should propagate through active clip."""
        clip = Clip(
            asset=VideoAsset(type="video", src="v.mp4", trim=2.0),
            start=1.0,
            length=4.0,
        )
        tracks = [Track(clips=[clip])]
        boundaries = collect_boundaries(tracks, 5.0)
        segments = generate_segments(boundaries, tracks)

        # Should have segments: [0-1] gap, [1-5] video
        assert len(segments) == 2
        video_seg = segments[1]
        assert len(video_seg.active_clips) == 1
        assert abs(video_seg.active_clips[0].clip_offset - 0.0) < EPSILON
