from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from app.workers.workspace import WorkspaceManager


class TestConcurrentWorkspaceIsolation:
    """Verify that multiple simultaneous renders get independent workspaces."""

    @pytest.mark.asyncio
    async def test_concurrent_creates_independent_directories(self, tmp_path: Path):
        """Multiple concurrent workspace creates produce separate directories."""
        mgr = WorkspaceManager(workspace_root=tmp_path)
        render_ids = [f"render_{i:03d}" for i in range(10)]

        workspaces = await asyncio.gather(*[mgr.create(rid) for rid in render_ids])

        paths = set()
        for ws in workspaces:
            assert ws.exists()
            assert ws.is_dir()
            paths.add(ws)

        assert len(paths) == 10

    @pytest.mark.asyncio
    async def test_concurrent_writes_do_not_interfere(self, tmp_path: Path):
        """Files written in one workspace do not appear in another."""
        mgr = WorkspaceManager(workspace_root=tmp_path)

        ws_a = await mgr.create("render_a")
        ws_b = await mgr.create("render_b")

        (ws_a / "output.mp4").write_bytes(b"video_a")
        (ws_b / "output.mp4").write_bytes(b"video_b")

        assert (ws_a / "output.mp4").read_bytes() == b"video_a"
        assert (ws_b / "output.mp4").read_bytes() == b"video_b"

    @pytest.mark.asyncio
    async def test_concurrent_cleanup_does_not_affect_others(self, tmp_path: Path):
        """Cleaning up one workspace does not remove another."""
        mgr = WorkspaceManager(workspace_root=tmp_path)

        ws_a = await mgr.create("render_cleanup_a")
        ws_b = await mgr.create("render_cleanup_b")
        (ws_a / "file.txt").write_text("a", encoding="utf-8")
        (ws_b / "file.txt").write_text("b", encoding="utf-8")

        await mgr.cleanup_success(ws_a)

        assert not ws_a.exists()
        assert ws_b.exists()
        assert (ws_b / "file.txt").read_text(encoding="utf-8") == "b"

    @pytest.mark.asyncio
    async def test_parallel_pipeline_simulation(self, tmp_path: Path):
        """Simulate parallel pipeline: create, write, cleanup concurrently."""
        mgr = WorkspaceManager(workspace_root=tmp_path)

        async def _simulate_render(render_id: str) -> str:
            ws = await mgr.create(render_id)
            (ws / "input.json").write_text(f'{{"id": "{render_id}"}}', encoding="utf-8")
            await asyncio.sleep(0.01)
            (ws / "output.mp4").write_bytes(render_id.encode())
            content = (ws / "input.json").read_text(encoding="utf-8")
            assert render_id in content
            await mgr.cleanup_success(ws)
            return render_id

        results = await asyncio.gather(
            *[_simulate_render(f"sim_{i}") for i in range(20)]
        )
        assert len(results) == 20
        assert len(set(results)) == 20
