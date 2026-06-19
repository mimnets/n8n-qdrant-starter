"""
Task session management — tracks running tasks, prevents concurrent
tasks, and provides status information.
"""
import asyncio
import logging
import time
from typing import Optional

logger = logging.getLogger(__name__)


class TaskSession:
    """Tracks a single running automation task."""

    def __init__(self, task_id: str, description: str):
        self.task_id = task_id
        self.description = description
        self.start_time = time.time()
        self.status = "running"  # running, completed, failed
        self.result: Optional[str] = None
        self.error: Optional[str] = None
        self.steps_taken: int = 0

    def elapsed(self) -> float:
        return time.time() - self.start_time

    def to_dict(self) -> dict:
        return {
            "task_id": self.task_id,
            "description": self.description[:100],
            "status": self.status,
            "elapsed_seconds": round(self.elapsed(), 1),
            "steps_taken": self.steps_taken,
            "has_result": self.result is not None,
        }


class SessionManager:
    """Manages task sessions and concurrency."""

    def __init__(self):
        self._current_task: Optional[TaskSession] = None
        self._history: list[TaskSession] = []
        self._lock = asyncio.Lock()
        self._cancel_event: Optional[asyncio.Event] = None

    @property
    def is_busy(self) -> bool:
        return self._current_task is not None and self._current_task.status == "running"

    @property
    def current_task(self) -> Optional[TaskSession]:
        return self._current_task

    async def start_task(self, task_id: str, description: str) -> bool:
        """Start tracking a new task. Returns False if already busy."""
        if self.is_busy:
            return False

        self._cancel_event = asyncio.Event()
        self._current_task = TaskSession(task_id, description)
        logger.info(f"Task started: {task_id} — {description[:80]}")
        return True

    async def complete_task(self, result: str, steps: int = 0):
        """Mark current task as completed."""
        if self._current_task:
            self._current_task.status = "completed"
            self._current_task.result = result
            self._current_task.steps_taken = steps
            self._history.append(self._current_task)
            logger.info(f"Task completed: {self._current_task.task_id} ({steps} steps, {self._current_task.elapsed():.1f}s)")
            self._current_task = None
        self._cancel_event = None

    async def fail_task(self, error: str, steps: int = 0):
        """Mark current task as failed."""
        if self._current_task:
            self._current_task.status = "failed"
            self._current_task.error = error
            self._current_task.steps_taken = steps
            self._history.append(self._current_task)
            logger.error(f"Task failed: {self._current_task.task_id} — {error[:200]}")
            self._current_task = None
        self._cancel_event = None

    def should_cancel(self) -> bool:
        """Check if the current task should be cancelled."""
        return self._cancel_event is not None and self._cancel_event.is_set()

    def cancel(self):
        """Request cancellation of the current task."""
        if self._cancel_event:
            self._cancel_event.set()
            logger.info("Cancel requested for current task")

    def get_status(self) -> dict:
        """Get full status of the session manager."""
        return {
            "busy": self.is_busy,
            "current_task": self._current_task.to_dict() if self._current_task else None,
            "recent_tasks": [
                t.to_dict() for t in self._history[-5:]
            ],
            "total_tasks_completed": sum(1 for t in self._history if t.status == "completed"),
            "total_tasks_failed": sum(1 for t in self._history if t.status == "failed"),
        }

    def get_history(self, limit: int = 10) -> list:
        """Get task history."""
        return [t.to_dict() for t in self._history[-limit:]]
