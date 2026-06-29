from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import pytest

from app.api.errors import StorageError
from app.db.models import Render
from app.storage.base import ArtifactType, StorageBackend, StorageUrlMode
from app.storage.local import LocalStorage
from app.storage.urls import StorageUrlResolver


class FakeS3Storage:
    backend = StorageBackend.S3

    def __init__(self, presigned_url: str) -> None:
        self.presigned_url = presigned_url
        self.presign_calls: list[tuple[str, int]] = []

    async def presign_uri(self, uri: str, *, expires_in_seconds: int) -> str:
        self.presign_calls.append((uri, expires_in_seconds))
        return self.presigned_url


def _render(**overrides) -> Render:
    defaults = {
        "id": "render_abc123",
        "status": "succeeded",
        "output_path": "/tmp/output.mp4",
        "output_format": "mp4",
        "output_media_type": "video/mp4",
        "output_filename": "render_abc123.mp4",
        "poster_path": "/tmp/poster.jpg",
        "completed_at": datetime(2026, 5, 5, 12, 0, 0, tzinfo=UTC),
    }
    defaults.update(overrides)
    return Render(**defaults)


def test_proxy_mode_returns_relative_download_and_poster_urls(tmp_path: Path) -> None:
    storage = LocalStorage(workspace_root=tmp_path)
    resolver = StorageUrlResolver(
        storage=storage,
        url_mode=StorageUrlMode.PROXY,
        signed_url_expiry_seconds=900,
    )

    assert resolver.proxy_url("render_abc123", ArtifactType.OUTPUT) == (
        "/v1/renders/render_abc123/download"
    )
    assert resolver.proxy_url("render_abc123", ArtifactType.POSTER) == (
        "/v1/renders/render_abc123/poster"
    )
    assert resolver.proxy_url("render_abc123", ArtifactType.CAPTION_SIDECAR) == (
        "/v1/renders/render_abc123/captions"
    )


@pytest.mark.asyncio
async def test_output_url_returns_none_when_render_not_succeeded(
    tmp_path: Path,
) -> None:
    storage = LocalStorage(workspace_root=tmp_path)
    resolver = StorageUrlResolver(
        storage=storage,
        url_mode=StorageUrlMode.PROXY,
        signed_url_expiry_seconds=900,
    )

    url = await resolver.output_url(_render(status="failed"))

    assert url is None


@pytest.mark.asyncio
async def test_signed_mode_uses_storage_presign() -> None:
    storage = FakeS3Storage("https://signed.example/output.mp4?sig=abc")
    resolver = StorageUrlResolver(
        storage=storage,  # type: ignore[arg-type]
        url_mode=StorageUrlMode.SIGNED,
        signed_url_expiry_seconds=300,
    )

    url = await resolver.artifact_url(
        "render_abc123",
        "s3://vidapi-renders/renders/render_abc123/output.mp4",
        ArtifactType.OUTPUT,
    )

    assert url == "https://signed.example/output.mp4?sig=abc"
    assert storage.presign_calls == [
        ("s3://vidapi-renders/renders/render_abc123/output.mp4", 300)
    ]


@pytest.mark.asyncio
async def test_signed_mode_rejects_secret_leak() -> None:
    storage = FakeS3Storage("https://signed.example/object?token=secret-value")
    resolver = StorageUrlResolver(
        storage=storage,  # type: ignore[arg-type]
        url_mode=StorageUrlMode.SIGNED,
        signed_url_expiry_seconds=300,
        forbidden_signed_fragments=("secret-value",),
    )

    with pytest.raises(StorageError, match="expose credentials"):
        await resolver.artifact_url(
            "render_abc123",
            "s3://vidapi-renders/renders/render_abc123/output.mp4",
            ArtifactType.OUTPUT,
        )


@pytest.mark.asyncio
async def test_local_signed_mode_falls_back_to_proxy(tmp_path: Path) -> None:
    storage = LocalStorage(workspace_root=tmp_path)
    resolver = StorageUrlResolver(
        storage=storage,
        url_mode=StorageUrlMode.SIGNED,
        signed_url_expiry_seconds=300,
    )

    url = await resolver.artifact_url(
        "render_abc123",
        "/tmp/output.mp4",
        ArtifactType.OUTPUT,
    )

    assert url == "/v1/renders/render_abc123/download"


@pytest.mark.asyncio
async def test_public_mode_builds_public_s3_url() -> None:
    storage = FakeS3Storage("unused")
    resolver = StorageUrlResolver(
        storage=storage,  # type: ignore[arg-type]
        url_mode=StorageUrlMode.PUBLIC,
        signed_url_expiry_seconds=900,
        public_base_url="https://cdn.example.com/base",
        forbidden_public_fragments=("access-key", "secret-key"),
    )

    url = await resolver.artifact_url(
        "render_abc123",
        "s3://vidapi-renders/renders/render_abc123/output.mp4",
        ArtifactType.OUTPUT,
    )

    assert url == "https://cdn.example.com/base/renders/render_abc123/output.mp4"
    assert "access-key" not in url
    assert "secret-key" not in url


@pytest.mark.asyncio
async def test_output_metadata_includes_manifest_url_in_proxy_mode(
    tmp_path: Path,
) -> None:
    storage = LocalStorage(workspace_root=tmp_path)
    resolver = StorageUrlResolver(
        storage=storage,
        url_mode=StorageUrlMode.PROXY,
        signed_url_expiry_seconds=900,
    )

    metadata = await resolver.output_metadata(
        _render(
            output_format="png-sequence",
            output_media_type="application/zip",
            output_filename="render_abc123.zip",
            output_frame_count=2,
            output_manifest_path="/tmp/manifest.json",
        )
    )

    assert metadata is not None
    assert metadata.manifest_url == "/v1/renders/render_abc123/artifacts/manifest.json"


@pytest.mark.asyncio
async def test_caption_and_poster_metadata_include_proxy_urls(
    tmp_path: Path,
) -> None:
    storage = LocalStorage(workspace_root=tmp_path)
    resolver = StorageUrlResolver(
        storage=storage,
        url_mode=StorageUrlMode.PROXY,
        signed_url_expiry_seconds=900,
    )
    render = _render(
        caption_mode="sidecar",
        caption_format="srt",
        caption_sidecar_path="/tmp/captions.srt",
        caption_sidecar_media_type="application/x-subrip",
        caption_sidecar_filename="render_abc123-captions.srt",
        caption_cue_count=2,
        caption_burned_in=False,
        poster_mode="timestamp",
        poster_timestamp_seconds=1.25,
        poster_media_type="image/jpeg",
        poster_filename="render_abc123.jpg",
    )

    captions = await resolver.caption_metadata(render)
    poster = await resolver.poster_metadata(render)

    assert captions is not None
    assert captions.sidecar_url == "/v1/renders/render_abc123/captions"
    assert captions.filename == "render_abc123-captions.srt"
    assert poster is not None
    assert poster.url == "/v1/renders/render_abc123/poster"
    assert poster.timestamp_seconds == 1.25


@pytest.mark.asyncio
async def test_signed_mode_resolves_caption_sidecar_metadata_url() -> None:
    storage = FakeS3Storage("https://signed.example/captions.srt?sig=abc")
    resolver = StorageUrlResolver(
        storage=storage,  # type: ignore[arg-type]
        url_mode=StorageUrlMode.SIGNED,
        signed_url_expiry_seconds=300,
    )
    render = _render(
        caption_mode="sidecar",
        caption_format="srt",
        caption_sidecar_path="s3://vidapi-renders/renders/render_abc123/captions.srt",
        caption_sidecar_media_type="application/x-subrip",
        caption_sidecar_filename="render_abc123-captions.srt",
        caption_cue_count=1,
        caption_burned_in=False,
    )

    captions = await resolver.caption_metadata(render)

    assert captions is not None
    assert captions.sidecar_url == "https://signed.example/captions.srt?sig=abc"
    assert storage.presign_calls == [
        ("s3://vidapi-renders/renders/render_abc123/captions.srt", 300)
    ]


@pytest.mark.asyncio
async def test_public_mode_resolves_poster_metadata_url() -> None:
    storage = FakeS3Storage("unused")
    resolver = StorageUrlResolver(
        storage=storage,  # type: ignore[arg-type]
        url_mode=StorageUrlMode.PUBLIC,
        signed_url_expiry_seconds=900,
        public_base_url="https://cdn.example.com/base",
    )
    render = _render(
        poster_path="s3://vidapi-renders/renders/render_abc123/poster.jpg",
        poster_mode="default",
        poster_timestamp_seconds=0.5,
        poster_media_type="image/jpeg",
        poster_filename="render_abc123.jpg",
    )

    poster = await resolver.poster_metadata(render)

    assert poster is not None
    assert poster.url == "https://cdn.example.com/base/renders/render_abc123/poster.jpg"


@pytest.mark.asyncio
async def test_public_mode_rejects_credential_leak() -> None:
    storage = FakeS3Storage("unused")
    resolver = StorageUrlResolver(
        storage=storage,  # type: ignore[arg-type]
        url_mode=StorageUrlMode.PUBLIC,
        signed_url_expiry_seconds=900,
        public_base_url="https://cdn.example.com/secret-key",
        forbidden_public_fragments=("secret-key",),
    )

    with pytest.raises(StorageError, match="expose credentials"):
        await resolver.artifact_url(
            "render_abc123",
            "s3://vidapi-renders/renders/render_abc123/output.mp4",
            ArtifactType.OUTPUT,
        )


@pytest.mark.asyncio
async def test_endpoint_redirect_url_is_none_in_proxy_mode(tmp_path: Path) -> None:
    storage = LocalStorage(workspace_root=tmp_path)
    resolver = StorageUrlResolver(
        storage=storage,
        url_mode=StorageUrlMode.PROXY,
        signed_url_expiry_seconds=900,
    )

    redirect = await resolver.endpoint_redirect_url(
        "render_abc123",
        "/tmp/output.mp4",
        ArtifactType.OUTPUT,
    )

    assert redirect is None
