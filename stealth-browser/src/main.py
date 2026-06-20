"""
Stealth Browser API — FastAPI service for LinkedIn/Facebook automation.
Drop-in replacement for browser-use with full anti-detection.

n8n workflow: POST http://stealth-browser:8001/api/run
VNC:          http://<host>:6081/vnc.html
"""
import asyncio
import json
import logging
import os
import sys
import uuid

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .browser import StealthBrowser
from .session_manager import SessionManager
from .agent import run_ai_agent
from .humanize import human_delay

# ─── Logging ─────────────────────────────────────────────
logging.basicConfig(
    level=getattr(logging, os.getenv("LOG_LEVEL", "INFO").upper()),
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger("stealth-browser")

# ─── Config ──────────────────────────────────────────────
PROFILE_DIR = os.getenv("PROFILE_DIR", "/app/profiles")
COOKIE_DIR = os.getenv("COOKIE_DIR", "/app/cookies")
HEADLESS = os.getenv("HEADLESS", "false").lower() == "true"
PROXY = os.getenv("CHROME_PROXY", None)
API_PORT = int(os.getenv("API_PORT", "8001"))

# ─── App ────────────────────────────────────────────────
app = FastAPI(title="Stealth Browser API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

browser = StealthBrowser(
    profile_dir=PROFILE_DIR,
    cookie_dir=COOKIE_DIR,
    headless=HEADLESS,
    proxy=PROXY,
)
session_manager = SessionManager()

# ─── Pydantic Models ────────────────────────────────────

class RunRequest(BaseModel):
    task: str = Field(..., description="Task description for the browser agent")
    profile: str = Field("default", description="Browser profile name")
    url: str = Field(None, description="Starting URL (optional)")
    max_steps: int = Field(30, ge=1, le=200, description="Maximum action steps")
    llm_provider: str = Field("openai", description="LLM provider: openai, deepseek, anthropic, google")
    pause_on_captcha: bool = Field(False, description="Pause if captcha detected")
    sensitive_data: dict = Field({}, description="Sensitive values (masked in logs)")

class NavigateRequest(BaseModel):
    url: str = Field(..., description="URL to navigate to")
    profile: str = Field("default", description="Browser profile name")

class SessionSaveRequest(BaseModel):
    profile: str = Field("default", description="Profile name to save")

class CookiesRequest(BaseModel):
    domain: str = Field(None, description="Filter cookies by domain")

# ─── API Endpoints ──────────────────────────────────────

# Note: No hardcoded handlers. The AI agent (agent.py) handles all tasks.
# It uses an LLM to see the page via screenshots and decide actions.


# ─── API Endpoints ──────────────────────────────────────

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "browser_running": browser.is_running,
        "busy": session_manager.is_busy,
        "current_profile": browser.current_profile,
    }


@app.get("/status")
async def status():
    """Detailed service status."""
    return session_manager.get_status()


@app.post("/api/run")
async def run_task(req: RunRequest):
    """Execute a browser automation task with full stealth measures."""
    if session_manager.is_busy:
        raise HTTPException(429, "A task is already running")

    task_id = str(uuid.uuid4())[:8]
    if not await session_manager.start_task(task_id, req.task):
        raise HTTPException(429, "Could not start task (concurrency)")

    try:
        # Launch browser if not running
        if not browser.is_running:
            await browser.launch(profile_name=req.profile)

        page = browser.page
        if not page:
            raise RuntimeError("No page available")

        # Navigate to starting URL if provided
        if req.url:
            await page.goto(req.url, wait_until="domcontentloaded")
            await asyncio.sleep(human_delay(2, 4))

        # Run the AI agent — uses LLM vision to drive the browser
        result = await run_ai_agent(
            page=page,
            task=req.task,
            max_steps=req.max_steps,
            provider=req.llm_provider,
        )

        # Save cookies after task
        cookie_count = await browser.save_session(req.profile)

        is_success = not (result.startswith("❌") or "❌" in result)
        await session_manager.complete_task(result, steps=req.max_steps)
        return {
            "success": is_success,
            "task_id": task_id,
            "result": result,
            "steps_taken": req.max_steps,
            "cookies_saved": cookie_count,
            "error": None if is_success else result,
        }

    except Exception as e:
        logger.exception("Task failed")
        await session_manager.fail_task(str(e))
        return {
            "success": False,
            "task_id": task_id,
            "result": None,
            "steps_taken": 0,
            "cookies_saved": 0,
            "error": str(e),
        }


@app.post("/api/navigate")
async def navigate(req: NavigateRequest):
    """
    Open a URL in the browser (no AI agent).
    Keeps the browser alive for manual VNC login.
    """
    try:
        if not browser.is_running:
            await browser.launch(profile_name=req.profile)

        page = browser.page
        if not page:
            raise RuntimeError("No page available")

        await page.goto(req.url, wait_until="domcontentloaded")
        await asyncio.sleep(1)

        return {
            "success": True,
            "url": req.url,
            "title": await page.title(),
            "message": f"Opened {req.url}. Use VNC to interact manually. Call /api/session/save after login.",
        }
    except Exception as e:
        logger.exception("Navigate failed")
        return {"success": False, "error": str(e)}


@app.post("/api/session/save")
async def save_session(req: SessionSaveRequest):
    """Manually save cookies (call after VNC login)."""
    try:
        count = await browser.save_session(req.profile)
        return {"success": True, "cookies_saved": count, "profile": req.profile}
    except Exception as e:
        return {"success": False, "error": str(e)}


@app.get("/api/cookies")
async def get_cookies(domain: str = None):
    """Check saved cookies, optionally filtered by domain."""
    try:
        info = await browser.get_cookies(domain)
        return {"success": True, **info}
    except Exception as e:
        return {"success": False, "error": str(e)}


@app.post("/api/browser/reset")
async def reset_browser():
    """Reset the browser (clear cookies + restart)."""
    try:
        await browser.reset()
        return {"success": True, "message": "Browser reset. Cookies cleared."}
    except Exception as e:
        return {"success": False, "error": str(e)}


@app.on_event("startup")
async def startup():
    logger.info("Stealth Browser API starting up...")
    logger.info(f"Profile dir: {PROFILE_DIR}")
    logger.info(f"Cookie dir: {COOKIE_DIR}")
    logger.info(f"Headless: {HEADLESS}")


@app.on_event("shutdown")
async def shutdown():
    logger.info("Shutting down...")
    await browser.close()


# ─── Main ────────────────────────────────────────────────

def main():
    import uvicorn
    uvicorn.run(
        "stealth_browser.src.main:app",
        host="0.0.0.0",
        port=API_PORT,
        reload=False,
        log_level=os.getenv("LOG_LEVEL", "info").lower(),
    )


if __name__ == "__main__":
    main()
