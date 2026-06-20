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
from .humanize import (
    human_delay, async_sleep, human_click, human_scroll,
    simulate_page_load_noise, human_type,
)

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

# ─── Task Runner ────────────────────────────────────────

async def run_browser_task(task_desc: str, page, context) -> str:
    """
    Execute a browser automation task with human-like behavior.
    The task description explains what to do — the AI interprets it.
    For now, this follows a structured approach to common tasks.
    """
    task_lower = task_desc.lower()
    steps_taken = 0
    result_parts = []

    # Extract sensitive data placeholders
    # We do a simple substitution of {{var}} patterns
    # The caller sends sensitive_data dict

    try:
        # Phase 1: Navigate / Load page
        if "go to" in task_lower or "navigate" in task_lower or "open" in task_lower:
            # Extract URL (last URL-like word)
            import re
            urls = re.findall(r'https?://[^\s]+', task_desc)
            if urls:
                target_url = urls[0]
                logger.info(f"Navigating to {target_url}")
                await page.goto(target_url, wait_until="domcontentloaded")
                await asyncio.sleep(human_delay(2, 4))
                await simulate_page_load_noise(page)
                result_parts.append(f"Navigated to {target_url}")
                steps_taken += 1

        # Phase 2: Wait for the page to stabilize
        await asyncio.sleep(human_delay(1, 3))

        # Phase 3: Handle common patterns
        if "post" in task_lower or "write" in task_lower or "create" in task_lower:
            if "linkedin" in task_lower or "linkedin.com" in task_lower or "linked in" in task_lower:
                logger.info("Detected LinkedIn post task")
                result = await _handle_linkedin_post(page, task_desc)
                result_parts.append(result)
                steps_taken += 1
            elif "facebook" in task_lower or "fb" in task_lower or "facebook.com" in task_lower:
                logger.info("Detected Facebook post task")
                result = await _handle_facebook_post(page, task_desc)
                result_parts.append(result)
                steps_taken += 1

        # Phase 4: Extract content if asked
        if "get" in task_lower or "extract" in task_lower or "return" in task_lower or "list" in task_lower:
            title = await page.title()
            # Try to extract main content
            try:
                body_text = await page.evaluate("""
                    () => {
                        const selectors = [
                            'article', '[role="main"]', 'main',
                            '.post-content', '.entry-content', '.content',
                            'body'
                        ];
                        for (const sel of selectors) {
                            const el = document.querySelector(sel);
                            if (el) return el.innerText.slice(0, 5000);
                        }
                        return document.body.innerText.slice(0, 5000);
                    }
                """)
                result_parts.append(f"Title: {title}")
                result_parts.append(f"Content: {body_text[:2000]}")
            except Exception as e:
                result_parts.append(f"Title: {title}")
                logger.warning(f"Content extraction failed: {e}")

        # If no patterns matched, just get page info
        if not result_parts:
            title = await page.title()
            url = page.url
            result_parts.append(f"Page: {title} ({url})")

        return "\n".join(result_parts)

    except Exception as e:
        logger.error(f"Task execution error: {e}")
        raise


async def _handle_linkedin_post(page, task_desc: str) -> str:
    """Post to LinkedIn with human-like behavior."""
    # Extract post content
    content = _extract_post_content(task_desc)

    # Navigate to feed if not already there
    current_url = page.url
    if "linkedin.com/feed" not in current_url:
        await page.goto("https://www.linkedin.com/feed/", wait_until="domcontentloaded")
        await asyncio.sleep(human_delay(2, 5))

    # Natural scroll
    await human_scroll(page)
    await asyncio.sleep(human_delay(1, 2))

    # Click "Start a post" button
    logger.info("Looking for 'Start a post' button")
    try:
        start_post = page.locator("button[aria-label*='Start a post'], button:has-text('Start a post')")
        await start_post.wait_for(timeout=10000)
        await asyncio.sleep(human_delay(1, 2))
        await human_click(page, "button[aria-label*='Start a post'], button:has-text('Start a post')")
    except Exception:
        # Try alternative selector
        try:
            start_post = page.locator("div[aria-label*='Start a post'], div:has-text('Start a post')")
            await start_post.wait_for(timeout=5000)
            await asyncio.sleep(human_delay(1, 2))
            await start_post.click()
        except Exception:
            return "❌ Could not find 'Start a post' button"

    await asyncio.sleep(human_delay(2, 4))

    # Type into the editor
    logger.info("Typing post content")
    try:
        editor = page.locator("div[role='textbox'][aria-label*='editor']")
        await editor.wait_for(timeout=10000)
        await asyncio.sleep(human_delay(0.5, 1.5))
        await human_type(page, "div[role='textbox'][aria-label*='editor']", content)
    except Exception:
        # Fallback selector
        try:
            editor = page.locator("div[role='textbox']").first
            await editor.wait_for(timeout=5000)
            await asyncio.sleep(human_delay(0.5, 1.5))
            await editor.click()
            await asyncio.sleep(human_delay(0.3, 0.8))
            await editor.fill(content)
        except Exception:
            return "❌ Could not find text editor"

    await asyncio.sleep(human_delay(1, 3))

    # Upload image if mentioned
    if "image" in task_desc.lower() or "photo" in task_desc.lower() or "picture" in task_desc.lower():
        logger.info("Looking for image upload")
        try:
            # Extract image path from task
            import re
            image_paths = re.findall(r'(/[\w/.-]+\.(png|jpg|jpeg|gif))', task_desc)
            if image_paths:
                img_path = image_paths[0][0]
                file_input = page.locator("input[type='file']")
                if await file_input.count() > 0:
                    await file_input.set_input_files(img_path)
                    await asyncio.sleep(human_delay(3, 7))
                    logger.info(f"Uploaded image: {img_path}")
        except Exception as e:
            logger.warning(f"Image upload failed: {e}")

    # Review before posting
    await asyncio.sleep(human_delay(1, 3))

    # Click Post button
    logger.info("Clicking Post button")
    try:
        post_btn = page.locator("button[data-control-name='post_submit'], button:has-text('Post')")
        await post_btn.wait_for(timeout=10000)
        await asyncio.sleep(human_delay(0.5, 1.5))
        await post_btn.click()
        await asyncio.sleep(human_delay(2, 4))
        return f"✅ LinkedIn post created: \"{content[:80]}...\""
    except Exception as e:
        return f"❌ Post button click failed: {e}"


async def _handle_facebook_post(page, task_desc: str) -> str:
    """Post to Facebook with human-like behavior."""
    content = _extract_post_content(task_desc)

    current_url = page.url
    if "facebook.com" not in current_url:
        await page.goto("https://www.facebook.com/", wait_until="domcontentloaded")
        await asyncio.sleep(human_delay(3, 6))

    # Try to find the "What's on your mind" box
    logger.info("Looking for Facebook status composer")
    await asyncio.sleep(human_delay(2, 4))

    try:
        composer = page.locator("div[role='button']:has-text('What'), div[aria-label*='What'], span:has-text('What')")
        await composer.first.wait_for(timeout=15000)
        await asyncio.sleep(human_delay(1, 2))
        await composer.first.click()
    except Exception:
        try:
            composer = page.locator("div[role='button']:has-text('on your mind')")
            await composer.wait_for(timeout=5000)
            await asyncio.sleep(human_delay(1, 2))
            await composer.click()
        except Exception as e:
            return f"❌ Could not find Facebook composer: {e}"

    await asyncio.sleep(human_delay(2, 4))

    # Type content
    logger.info("Typing Facebook post content")
    try:
        editor = page.locator("div[role='textbox'][aria-label*='What'], div[role='textbox'][aria-label*='Post']").first
        await editor.wait_for(timeout=10000)
        await asyncio.sleep(human_delay(0.5, 1.5))
        await human_type(page, editor, content)
    except Exception:
        try:
            # Try fill approach as fallback
            editor = page.locator("div[role='textbox']").first
            await editor.wait_for(timeout=5000)
            await editor.click()
            await asyncio.sleep(human_delay(0.3, 0.8))
            await editor.fill(content)
        except Exception as e:
            return f"❌ Could not type in Facebook editor: {e}"

    await asyncio.sleep(human_delay(2, 4))

    # Click Post
    logger.info("Clicking Facebook Post button")
    try:
        post_btn = page.locator("div[role='button']:has-text('Post'):not(:has-text('Photo'))").first
        await post_btn.wait_for(timeout=10000)
        await asyncio.sleep(human_delay(0.5, 1.5))
        await post_btn.click()
        await asyncio.sleep(human_delay(3, 6))
        return f"✅ Facebook post created: \"{content[:80]}...\""
    except Exception as e:
        return f"❌ Facebook Post button failed: {e}"


def _extract_post_content(task_desc: str) -> str:
    """Extract the actual post content from a task description."""
    # If the task contains quoted text
    import re
    quotes = re.findall(r'"([^"]{10,})"', task_desc)
    if quotes:
        return quotes[0]

    # Try to find content after keywords
    keywords = [
        r'say[:\s]+(.+)',
        r'post[:\s]+(.+)',
        r'content[:\s]+(.+)',
        r'text[:\s]+(.+)',
        r'message[:\s]+(.+)',
    ]
    for pattern in keywords:
        match = re.search(pattern, task_desc, re.IGNORECASE)
        if match:
            text = match.group(1).strip()
            if len(text) > 10:
                return text

    # Fallback: use the whole description
    # Remove common prefixes
    for prefix in [
        "post to linkedin", "post on linkedin", "linkedin post",
        "post to facebook", "post on facebook", "facebook post",
        "write a post", "create a post", "submit a post",
        "go to linkedin", "go to facebook",
    ]:
        task_desc = task_desc.lower().replace(prefix, "").strip()

    # Clean up
    task_desc = re.sub(r'\b(and|with|using|for|about)\b', '', task_desc).strip()
    return task_desc[:1000] or "Automated post"


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

        # Run the AI agent
        result = await run_ai_agent(
            page=page,
            task=req.task,
            max_steps=req.max_steps,
            provider=req.llm_provider,
        )

        # Save cookies after task
        cookie_count = await browser.save_session(req.profile)

        await session_manager.complete_task(result, steps=req.max_steps)
        return {
            "success": not result.startswith("❌"),
            "task_id": task_id,
            "result": result,
            "steps_taken": req.max_steps,
            "cookies_saved": cookie_count,
            "error": None if not result.startswith("❌") else result,
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
