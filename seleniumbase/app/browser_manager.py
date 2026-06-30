"""
SeleniumBase Browser Manager
Manages a persistent stealth browser session via SeleniumBase CDP Mode.
ALL browser interaction happens in a single dedicated thread to keep
sb_cdp's internal asyncio loop happy.
Drop-in Camoufox replacement for n8n workflows.
"""

import os
import time
import logging
import threading
import queue
from typing import Optional, Any

logger = logging.getLogger("seleniumbase-service")


class BrowserManager:
    """
    Wraps sb_cdp.Chrome. All sb_cdp calls are dispatched to a single
    background thread via a command queue, keeping the asyncio loop
    on the thread that created it.
    """

    def __init__(self):
        self._sb: Any = None
        self._active = False
        self._q: "queue.Queue[list]" = queue.Queue()
        self._result_q: "queue.Queue[dict]" = queue.Queue()
        self._ready = threading.Event()

    def _worker(self, headless: bool, locale: str):
        """Background thread: owns asyncio loop + sb_cdp browser."""
        try:
            from seleniumbase import sb_cdp
            logger.info("Launching CDP browser (headless=%s)...", headless)
            sb = sb_cdp.Chrome(
                headless=headless, locale=locale,
                ad_block=True, disable_js=False,
            )
            self._sb = sb
            self._active = True
            self._ready.set()
            logger.info("Browser ready: %s", sb.get_endpoint_url())
        except Exception as e:
            logger.error("Browser launch failed: %s", e)
            self._ready.set()
            return

        # Command dispatch loop — runs in THIS thread forever
        while self._active:
            try:
                cmd = self._q.get(timeout=1.0)
            except queue.Empty:
                continue
            if cmd is None:
                break
            method, args, kwargs, result_q = cmd
            try:
                result = method(*args, **kwargs)
                result_q.put({"status": "ok", "result": result})
            except Exception as e:
                logger.error("Command failed: %s", e)
                result_q.put({"status": "error", "error": str(e)})

        try:
            self._sb.quit()
        except Exception:
            pass
        self._sb = None
        self._active = False

    def _call(self, method, *args, **kwargs) -> dict:
        """Dispatch a method call to the browser thread and wait for result."""
        if not self._active:
            return {"status": "error", "error": "No active browser"}
        rq: "queue.Queue[dict]" = queue.Queue()
        self._q.put((method, args, kwargs, rq))
        try:
            return rq.get(timeout=120)
        except queue.Empty:
            return {"status": "error", "error": "Command timed out"}

    # ── Lifecycle ──────────────────────────────────────────────────────

    def start(self, headless: bool = True, locale: str = "en") -> dict:
        if self._active:
            return {"status": "already_running"}
        t = threading.Thread(target=self._worker, args=(headless, locale), daemon=True)
        t.start()
        self._ready.wait(timeout=90)
        if self._active:
            return {"status": "started"}
        return {"status": "error", "error": "Browser launch timed out"}

    def stop(self) -> dict:
        if self._active:
            self._q.put(None)  # signal worker to quit
        self._active = False
        return {"status": "stopped"}

    # ── Browser commands (dispatched to worker thread) ──────────────────

    def navigate(self, url: str, timeout: int = 30) -> dict:
        r = self._call(self._sb.goto, url)
        if r["status"] == "ok":
            import time as _time
            _time.sleep(1)  # let page settle
            return {
                "status": "ok",
                "url": self._call(self._sb.get_current_url)["result"],
                "title": self._call(self._sb.get_title)["result"],
            }
        return r

    def click(self, selector: str, timeout: int = 10) -> dict:
        r = self._call(self._sb.wait_for_element_visible, selector, timeout=timeout)
        if r["status"] != "ok":
            return r
        return self._call(self._sb.click, selector)

    def type_text(self, selector: str, text: str, timeout: int = 10) -> dict:
        r = self._call(self._sb.wait_for_element_visible, selector, timeout=timeout)
        if r["status"] != "ok":
            return r
        self._call(self._sb.clear, selector)
        return self._call(self._sb.type, selector, text)

    def screenshot(self, selector: Optional[str] = None) -> dict:
        if selector:
            self._call(self._sb.wait_for_element_visible, selector, timeout=10)
        # Use sb_cdp screenshot with name param, read file back as base64
        import base64, tempfile
        tmp = tempfile.NamedTemporaryFile(suffix=".png", delete=False)
        tmp.close()
        r = self._call(self._sb.save_screenshot, tmp.name)
        if r["status"] == "ok" or (r["status"] == "error" and "PNG" not in r.get("error","")):
            try:
                with open(tmp.name, "rb") as f:
                    b64 = base64.b64encode(f.read()).decode()
                import os as _os
                _os.unlink(tmp.name)
                return {"status": "ok", "image": b64, "format": "base64_png"}
            except Exception as e:
                return {"status": "error", "error": str(e)}
        return r

    def execute_js(self, script: str) -> dict:
        r = self._call(self._sb.execute_script, script)
        if r["status"] == "ok":
            return {"status": "ok", "result": str(r["result"])}
        return r

    def get_page_source(self) -> dict:
        r = self._call(self._sb.get_page_source)
        if r["status"] == "ok":
            return {"status": "ok", "html": r["result"], "length": len(r["result"])}
        return r

    def get_tabs(self) -> dict:
        url = self._call(self._sb.get_current_url)
        title = self._call(self._sb.get_title)
        return {
            "status": "ok",
            "tabs": [{"id": 0, "url": url.get("result",""), "title": title.get("result",""), "active": True}],
            "count": 1,
        }

    def get_cookies(self) -> dict:
        r = self._call(self._sb.get_cookies)
        if r["status"] == "ok":
            return {"status": "ok", "cookies": r["result"], "count": len(r["result"])}
        return r

    def set_cookies(self, cookies: list) -> dict:
        for c in cookies:
            self._call(self._sb.add_cookie, c)
        return {"status": "ok", "set": len(cookies)}

    def wait(self, seconds: float) -> dict:
        time.sleep(seconds)
        return {"status": "ok", "slept": seconds}

    def scroll_to(self, selector: str) -> dict:
        return self._call(self._sb.scroll_to, selector)

    def get_text(self, selector: str) -> dict:
        r = self._call(self._sb.wait_for_element_visible, selector, timeout=10)
        if r["status"] != "ok":
            return r
        r2 = self._call(self._sb.get_text, selector)
        if r2["status"] == "ok":
            return {"status": "ok", "text": r2["result"], "selector": selector}
        return r2

    def status(self) -> dict:
        if not self._active:
            return {"active": False}
        try:
            url = self._call(self._sb.get_current_url)
            title = self._call(self._sb.get_title)
            return {"active": True, "url": url.get("result",""), "title": title.get("result","")}
        except Exception:
            return {"active": True}

    @property
    def is_active(self) -> bool:
        return self._active
