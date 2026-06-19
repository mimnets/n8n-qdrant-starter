"""
Browser lifecycle management — launch, configure, close.
Manages persistent user data directories for session preservation.
"""
import asyncio
import logging
import os
import random
from pathlib import Path
from typing import Optional

from playwright.async_api import async_playwright, Browser, BrowserContext, Page

from .stealth import (
    get_stealth_script, pick_user_agent, pick_viewport,
    pick_locale, pick_timezone,
)
from .cookie_manager import CookieManager

logger = logging.getLogger(__name__)

STEALTH_SCRIPT = get_stealth_script()


class StealthBrowser:
    """Manages a stealth browser instance with session persistence."""

    def __init__(
        self,
        profile_dir: str = "/app/profiles",
        cookie_dir: str = "/app/cookies",
        headless: bool = False,
        proxy: Optional[str] = None,
    ):
        self.profile_dir = Path(profile_dir)
        self.cookie_dir = Path(cookie_dir)
        self.headless = headless
        self.proxy = proxy

        self.cookie_manager = CookieManager(self.cookie_dir)

        self._playwright = None
        self._browser: Optional[Browser] = None
        self._context: Optional[BrowserContext] = None
        self._page: Optional[Page] = None
        self._current_profile: Optional[str] = None
        self._current_ua: Optional[str] = None
        self._current_viewport: Optional[dict] = None
        self._current_locale: Optional[str] = None
        self._current_tz: Optional[str] = None
        self._locked = False  # True when a task is running

        self.profile_dir.mkdir(parents=True, exist_ok=True)
        self.cookie_dir.mkdir(parents=True, exist_ok=True)

        logger.info(f"StealthBrowser initialized")
        logger.info(f"  Profile dir: {self.profile_dir}")
        logger.info(f"  Cookie dir: {self.cookie_dir}")
        logger.info(f"  Headless: {self.headless}")
        logger.info(f"  Proxy: {self.proxy or 'None'}")

    @property
    def is_running(self) -> bool:
        return self._browser is not None

    @property
    def is_locked(self) -> bool:
        return self._locked

    @property
    def current_profile(self) -> Optional[str]:
        return self._current_profile

    @property
    def browser(self) -> Optional[Browser]:
        return self._browser

    @property
    def context(self) -> Optional[BrowserContext]:
        return self._context

    @property
    def page(self) -> Optional[Page]:
        return self._page

    async def launch(self, profile_name: str = "default", force_new: bool = False):
        """
        Launch or reuse a browser for the given profile.
        If the browser is already running with the same profile, returns existing.
        If force_new is True or profile changed, creates a fresh context.
        """
        profile_path = self.profile_dir / profile_name
        user_data_dir = profile_path / "user_data"
        user_data_dir.mkdir(parents=True, exist_ok=True)

        # Pick random fingerprint for this session
        ua, platform = pick_user_agent("linux")
        viewport = pick_viewport()
        locale = pick_locale()
        tz = pick_timezone()

        # Log but don't expose to bot — these are stealth measures
        logger.info(f"Launching browser for profile '{profile_name}'")
        logger.info(f"  UA: {ua[:60]}...")
        logger.info(f"  Viewport: {viewport['width']}x{viewport['height']}")
        logger.info(f"  Locale: {locale}")
        logger.info(f"  Timezone: {tz}")

        self._current_ua = ua
        self._current_viewport = viewport
        self._current_locale = locale
        self._current_tz = tz

        self._playwright = await async_playwright().start()

        launch_args = [
            "--disable-blink-features=AutomationControlled",
            "--disable-features=IsolateOrigins,site-per-process",
            "--no-sandbox",
            "--disable-dev-shm-usage",
            "--disable-setuid-sandbox",
            "--disable-accelerated-2d-canvas",
            "--disable-gpu",
            f"--window-size={viewport['width']},{viewport['height']}",
        ]

        if self.proxy:
            launch_args.append(f"--proxy-server={self.proxy}")

        self._browser = await self._playwright.chromium.launch(
            headless=self.headless,
            args=launch_args,
        )

        self._context = await self._browser.new_context(
            user_agent=ua,
            viewport=viewport,
            locale=locale,
            timezone_id=tz,
            no_viewport=False,
            permissions=[],
        )

        # Inject stealth script on every page
        await self._context.add_init_script(STEALTH_SCRIPT)

        # Load saved cookies
        saved_cookies = self.cookie_manager.load_cookies(profile_name)
        if saved_cookies:
            try:
                await self._context.add_cookies(saved_cookies)
                logger.info(f"Restored {len(saved_cookies)} cookies for '{profile_name}'")
            except Exception as e:
                logger.warning(f"Failed to restore some cookies: {e}")

        self._page = await self._context.new_page()
        self._current_profile = profile_name

        logger.info(f"Browser launched for profile '{profile_name}'")
        return self._page

    async def navigate(self, url: str, wait_until: str = "domcontentloaded"):
        """Navigate to a URL."""
        if not self._page:
            raise RuntimeError("Browser not launched")

        logger.info(f"Navigating to {url}")
        await self._page.goto(url, wait_until=wait_until)
        logger.info(f"Page loaded: {self._page.url}")
        return self._page.url

    async def save_session(self, profile_name: str = None):
        """Save all current cookies to disk."""
        if not self._context:
            raise RuntimeError("No active context")

        profile = profile_name or self._current_profile or "default"
        cookies = await self._context.cookies()
        self.cookie_manager.save_cookies(cookies, profile)
        logger.info(f"Session saved for '{profile}' ({len(cookies)} cookies)")
        return len(cookies)

    async def check_session(self, profile_name: str = None, domain: str = None) -> dict:
        """Check if we have a valid session."""
        if not self._context:
            return {"browser_running": False, "has_session": False}

        profile = profile_name or self._current_profile or "default"

        # Check disk cookies
        disk_info = self.cookie_manager.get_cookie_info(profile, domain)

        # Check live cookies
        live_cookies = await self._context.cookies()
        live_filtered = self.cookie_manager.filter_by_domain(live_cookies, domain) if domain else live_cookies

        return {
            "browser_running": True,
            "profile": profile,
            "has_session": len(live_filtered) > 0 or disk_info["has_session"],
            "live_cookies": len(live_cookies),
            "live_domain_cookies": len(live_filtered) if domain else len(live_cookies),
            "disk_cookies": disk_info["total_cookies"],
            "domain": domain,
            "cookie_websites": list(set(c.get('domain', '') for c in live_cookies[:20])),
        }

    async def get_cookies(self, domain: str = None) -> dict:
        """Get cookie info for API response."""
        if not self._context:
            return {"error": "No active browser"}

        profile = self._current_profile or "default"
        return self.cookie_manager.get_cookie_info(profile, domain)

    async def clear_session(self, profile_name: str = None):
        """Clear all cookies for a profile."""
        if self._context:
            await self._context.clear_cookies()

        profile = profile_name or self._current_profile or "default"
        self.cookie_manager.clear_cookies(profile)
        logger.info(f"Session cleared for '{profile}'")

    async def close(self):
        """Close the browser and clean up."""
        logger.info("Closing browser...")
        if self._page:
            try:
                await self._page.close()
            except Exception:
                pass
            self._page = None

        if self._context:
            try:
                await self._context.close()
            except Exception:
                pass
            self._context = None

        if self._browser:
            try:
                await self._browser.close()
            except Exception:
                pass
            self._browser = None

        if self._playwright:
            try:
                await self._playwright.stop()
            except Exception:
                pass
            self._playwright = None

        self._current_profile = None
        self._current_ua = None
        self._current_viewport = None
        logger.info("Browser closed")

    async def reset(self):
        """Completely reset the browser (clear everything + restart)."""
        profile = self._current_profile
        await self.close()
        if profile:
            await self.clear_session(profile)
        logger.info("Browser reset complete")
