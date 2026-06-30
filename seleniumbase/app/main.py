"""
SeleniumBase Stealth Browser REST API Service
Drop-in replacement for Camoufox — compatible API, SeleniumBase CDP stealth.
Run with: uvicorn app.main:app --host 0.0.0.0 --port 9377
"""

import os
import logging
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query, Body
from fastapi.responses import JSONResponse
from fastapi import Request
from pydantic import BaseModel
from typing import Optional

from app.browser_manager import BrowserManager

# ── Logging ────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("seleniumbase-api")

# ── Globals ────────────────────────────────────────────────────────────────
browser = BrowserManager()
API_KEY = os.environ.get("SELENIUMBASE_API_KEY", "")
HEADLESS = os.environ.get("HEADLESS", "true").lower() == "true"

# ── API Models ─────────────────────────────────────────────────────────────
class NavigateRequest(BaseModel):
    url: str
    timeout: int = 30

class ClickRequest(BaseModel):
    selector: str
    timeout: int = 10

class TypeRequest(BaseModel):
    selector: str
    text: str
    timeout: int = 10

class ExecuteJSRequest(BaseModel):
    script: str

class ScreenshotRequest(BaseModel):
    selector: Optional[str] = None

class ScrollRequest(BaseModel):
    selector: str

class TextRequest(BaseModel):
    selector: str

class WaitRequest(BaseModel):
    seconds: float = 1.0

class CookiesRequest(BaseModel):
    cookies: list


# ── Lifespan ───────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Start browser in background thread so asyncio doesn't conflict
    def _bg_start():
        result = browser.start(headless=HEADLESS)
        logger.info("Browser start result: %s", result)
    t = threading.Thread(target=_bg_start, daemon=True)
    t.start()
    yield
    browser.stop()
    logger.info("Browser stopped")


# ── App ────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="SeleniumBase Stealth Browser Service",
    description="REST API for stealth browser automation via SeleniumBase CDP Mode. Drop-in Camoufox replacement for n8n.",
    version="2.0.0",
    lifespan=lifespan,
)


# ── Middleware: API Key Auth ────────────────────────────────────────────────
@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    if not API_KEY:
        return await call_next(request)
    if request.url.path == "/health":
        return await call_next(request)
    auth_header = request.headers.get("Authorization", "")
    expected = f"Bearer {API_KEY}"
    if auth_header != expected:
        # Also accept as query param for Camoufox compatibility
        if request.query_params.get("api_key") == API_KEY:
            return await call_next(request)
        return JSONResponse(status_code=401, content={"status": "error", "error": "Unauthorized"})
    return await call_next(request)


# ── Endpoints ──────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    """Health check — used by Docker healthchecks and n8n."""
    return {
        "status": "ok",
        "service": "seleniumbase",
        "browser_active": browser.is_active,
    }


@app.get("/status")
async def status():
    """Get browser status."""
    return browser.status()


@app.post("/start")
async def start():
    """Start the stealth browser."""
    return browser.start(headless=HEADLESS)


@app.post("/stop")
async def stop():
    """Stop the browser."""
    return browser.stop()


@app.post("/navigate")
async def navigate(req: NavigateRequest):
    """Navigate to a URL."""
    return browser.navigate(req.url, req.timeout)


@app.post("/click")
async def click(req: ClickRequest):
    """Click an element by CSS selector."""
    return browser.click(req.selector, req.timeout)


@app.post("/type")
async def type_text(req: TypeRequest):
    """Type text into an element."""
    return browser.type_text(req.selector, req.text, req.timeout)


@app.post("/screenshot")
async def screenshot(req: ScreenshotRequest = None):
    """Take a screenshot. Returns base64 PNG."""
    sel = req.selector if req else None
    return browser.screenshot(sel)


@app.post("/execute")
async def execute_js(req: ExecuteJSRequest):
    """Execute JavaScript in the page context."""
    return browser.execute_js(req.script)


@app.get("/pagesource")
async def page_source():
    """Get full page HTML."""
    return browser.get_page_source()


@app.get("/tabs")
async def tabs():
    """Get open tabs info."""
    return browser.get_tabs()


@app.get("/cookies")
async def get_cookies():
    """Get all browser cookies."""
    return browser.get_cookies()


@app.post("/cookies")
async def set_cookies(req: CookiesRequest):
    """Set browser cookies from a list."""
    return browser.set_cookies(req.cookies)


@app.post("/wait")
async def wait(req: WaitRequest):
    """Sleep for given seconds."""
    return browser.wait(req.seconds)


@app.post("/scroll")
async def scroll_to(req: ScrollRequest):
    """Scroll element into view."""
    return browser.scroll_to(req.selector)


@app.post("/text")
async def get_text(req: TextRequest):
    """Get text content of an element by CSS selector."""
    return browser.get_text(req.selector)
