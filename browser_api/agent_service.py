"""
Agent lifecycle manager — wraps ``browser_use.Agent`` directly (the same library
the official ``browser-use/web-ui`` uses) and exposes async start / pause / resume /
stop operations.

Task state is held in memory (a dict) and every task is run inside an
``asyncio.Task`` so the FastAPI request thread is never blocked.
"""

from __future__ import annotations

import asyncio
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from browser_use import Agent, Browser, BrowserProfile
from browser_use.agent.views import AgentHistoryList

from .llm_factory import get_llm

logger = logging.getLogger("browser-api.agent")

# ---------------------------------------------------------------------------
# In-memory task store
# ---------------------------------------------------------------------------
_tasks: dict[str, dict[str, Any]] = {}


# ---------------------------------------------------------------------------
# TaskManager — the public API consumed by app.py
# ---------------------------------------------------------------------------
class TaskManager:
    """Create, run, and control a browser-use Agent task."""

    @staticmethod
    def create(
        instruction: str,
        ai_provider: str = "openai",
        headful: Optional[bool] = None,
        use_custom_chrome: Optional[bool] = None,
        max_steps: int = 50,
        save_browser_data: bool = False,
    ) -> str:
        """
        Register a new task and kick off async execution.

        Returns the *task_id* immediately.
        """
        task_id = str(uuid.uuid4())
        now = _utcnow()

        # Resolve headful mode: task-level arg > env var > default (headless)
        if headful is None:
            headful = os.getenv("BROWSER_USE_HEADFUL", "false").lower() == "true"

        _tasks[task_id] = {
            "id": task_id,
            "task": instruction,
            "ai_provider": ai_provider,
            "status": "created",
            "created_at": now,
            "finished_at": None,
            "output": None,
            "error": None,
            "steps": [],
            "agent": None,
            "browser_session": None,
            "save_browser_data": save_browser_data,
            "browser_data": None,
            "max_steps": max_steps,
            "headful": headful,
            "use_custom_chrome": use_custom_chrome,
            "live_url": f"/live/{task_id}",
        }

        # Fire-and-forget the background execution
        asyncio.create_task(_execute(task_id, instruction, ai_provider, headful,
                                     use_custom_chrome, max_steps, save_browser_data))

        return task_id

    @staticmethod
    def get(task_id: str) -> Optional[dict[str, Any]]:
        """Return full task dict (minus the agent / browser objects)."""
        t = _tasks.get(task_id)
        if t is None:
            return None
        return {k: v for k, v in t.items() if k not in ("agent", "browser_session")}

    @staticmethod
    def status(task_id: str) -> Optional[dict[str, Any]]:
        """Return lightweight status dict."""
        t = _tasks.get(task_id)
        if t is None:
            return None
        return {
            "status": t["status"],
            "result": t.get("output"),
            "error": t.get("error"),
        }

    @staticmethod
    def list_tasks() -> list[dict[str, Any]]:
        """Return summary list of every task."""
        return [
            {
                "id": t["id"],
                "status": t["status"],
                "task": t.get("task", ""),
                "created_at": t.get("created_at", ""),
                "finished_at": t.get("finished_at"),
                "live_url": t.get("live_url", f"/live/{t['id']}"),
            }
            for t in _tasks.values()
        ]

    @staticmethod
    async def stop(task_id: str) -> Optional[str]:
        """Request a running task to stop.  Returns a human message."""
        t = _tasks.get(task_id)
        if t is None:
            return None
        if t["status"] in ("finished", "failed", "stopped"):
            return f"Task already in terminal state: {t['status']}"

        agent = t.get("agent")
        if agent is not None:
            agent.stop()
            t["status"] = "stopping"
            return "Task stopping"
        t["status"] = "stopped"
        t["finished_at"] = _utcnow()
        return "Task stopped (no agent found)"

    @staticmethod
    async def pause(task_id: str) -> Optional[str]:
        """Pause a running task."""
        t = _tasks.get(task_id)
        if t is None:
            return None
        if t["status"] != "running":
            return f"Task not running: {t['status']}"

        agent = t.get("agent")
        if agent is not None:
            agent.pause()
            t["status"] = "paused"
            return "Task paused"
        return "Task could not be paused (no agent found)"

    @staticmethod
    async def resume(task_id: str) -> Optional[str]:
        """Resume a paused task."""
        t = _tasks.get(task_id)
        if t is None:
            return None
        if t["status"] != "paused":
            return f"Task not paused: {t['status']}"

        agent = t.get("agent")
        if agent is not None:
            agent.resume()
            t["status"] = "running"
            return "Task resumed"
        return "Task could not be resumed (no agent found)"

    @staticmethod
    def browser_config() -> dict[str, Any]:
        """Return the current browser configuration (from env vars)."""
        headful = os.getenv("BROWSER_USE_HEADFUL", "false").lower() == "true"
        chrome_path = os.getenv("CHROME_PATH")
        chrome_user_data = os.getenv("CHROME_USER_DATA")
        return {
            "headful": headful,
            "headless": not headful,
            "chrome_path": chrome_path,
            "chrome_user_data": chrome_user_data,
            "using_custom_chrome": chrome_path is not None,
            "using_user_data": chrome_user_data is not None,
        }


# ---------------------------------------------------------------------------
# Internal execution
# ---------------------------------------------------------------------------
async def _execute(
    task_id: str,
    instruction: str,
    ai_provider: str,
    headful: bool,
    use_custom_chrome: Optional[bool],
    max_steps: int,
    save_browser_data: bool,
) -> None:
    """Background coroutine that creates the Agent, runs it, and records results."""
    browser_session = None
    try:
        _tasks[task_id]["status"] = "running"
        llm = get_llm(ai_provider)

        # -- Browser setup ------------------------------------------------
        chrome_path = os.getenv("CHROME_PATH")
        chrome_user_data = os.getenv("CHROME_USER_DATA")

        # Build BrowserProfile kwargs
        profile_kwargs: dict[str, Any] = {
            "headless": not headful,
        }

        # Docker needs chromium_sandbox=False
        if os.getenv("IN_DOCKER", "").lower() == "true" or os.path.exists("/.dockerenv"):
            profile_kwargs["chromium_sandbox"] = False
            logger.info("Task %s: Docker detected — disabling Chromium sandbox", task_id)

        if use_custom_chrome is not False and chrome_path:
            profile_kwargs["executable_path"] = chrome_path
            logger.info("Task %s: Using custom Chrome at %s", task_id, chrome_path)

        if use_custom_chrome is not False and chrome_user_data:
            profile_kwargs["user_data_dir"] = chrome_user_data
            logger.info("Task %s: Using Chrome user data dir %s",
                        task_id, chrome_user_data)

        browser_profile = BrowserProfile(**profile_kwargs)

        # BrowserSession (Browser is an alias for BrowserSession)
        browser_session = Browser(browser_profile=browser_profile)
        _tasks[task_id]["browser_session"] = browser_session

        # Start the browser
        await browser_session.start()
        logger.info("Task %s: Browser session started", task_id)

        # -- Agent setup --------------------------------------------------
        agent = Agent(
            task=instruction,
            llm=llm,
            browser_session=browser_session,
        )
        _tasks[task_id]["agent"] = agent

        # -- Run ----------------------------------------------------------
        result: AgentHistoryList = await agent.run(max_steps=max_steps)
        _tasks[task_id]["finished_at"] = _utcnow()
        _tasks[task_id]["status"] = "finished"

        # Extract meaningful result (not raw AgentHistoryList dump)
        final = result.final_result()
        if final:
            _tasks[task_id]["output"] = final
        else:
            # Collect extracted content from action results
            contents = result.extracted_content()
            _tasks[task_id]["output"] = "\n".join(contents) if contents else (
                f"Task completed in {result.number_of_steps()} steps "
                f"(done={result.is_done()}, errors={len(result.errors())})"
            )

        # Collect step summaries for the live-view
        step_list = []
        for i, h in enumerate(result.history):
            mo = h.model_output
            extracted = ""
            if h.result:
                extracted = h.result[0].extracted_content or h.result[0].long_term_memory or ""
            step_list.append({
                "step": i + 1,
                "next_goal": str(mo) if mo else "",
                "evaluation_previous_goal": extracted,
            })
        _tasks[task_id]["steps"] = step_list

        # Log summary
        logger.info(
            "Task %s finished — %.1fs | steps: %d | tokens IN: %d OUT: %d",
            task_id,
            result.total_duration_seconds(),
            result.number_of_steps(),
            result.total_input_tokens(),
            result.total_output_tokens(),
        )

    except Exception as exc:
        logger.exception("Task %s failed", task_id)
        _tasks[task_id]["status"] = "failed"
        _tasks[task_id]["error"] = str(exc)
        _tasks[task_id]["finished_at"] = _utcnow()

    finally:
        if browser_session is not None:
            try:
                await browser_session.stop()
                logger.debug("Browser session stopped for task %s", task_id)
            except Exception as exc:
                logger.error("Error stopping browser for task %s: %s", task_id, exc)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _utcnow() -> str:
    """ISO-8601 UTC timestamp string."""
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
