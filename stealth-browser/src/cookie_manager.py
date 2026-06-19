"""
Cookie management — save/load cookies from disk with domain filtering.
Cookies persist across container restarts via Docker volume mount.
"""
import json
import logging
import os
from pathlib import Path

logger = logging.getLogger(__name__)


class CookieManager:
    """Manages persistent cookie storage for browser automation."""

    def __init__(self, cookie_dir: str):
        self.cookie_dir = Path(cookie_dir)
        self.cookie_dir.mkdir(parents=True, exist_ok=True)
        logger.info(f"Cookie store initialized at {self.cookie_dir}")

    def _profile_path(self, profile_name: str) -> Path:
        """Get the cookie file path for a named profile."""
        return self.cookie_dir / f"{profile_name}.json"

    def save_cookies(self, cookies: list, profile_name: str = "default"):
        """Save cookies to disk."""
        path = self._profile_path(profile_name)
        try:
            with open(path, 'w') as f:
                json.dump(cookies, f, indent=2)
            logger.info(f"Saved {len(cookies)} cookies to {path}")
            return True
        except Exception as e:
            logger.error(f"Failed to save cookies: {e}")
            return False

    def load_cookies(self, profile_name: str = "default") -> list:
        """Load cookies from disk. Returns empty list if no cookies found."""
        path = self._profile_path(profile_name)
        if not path.exists():
            logger.info(f"No cookie file found at {path}")
            return []

        try:
            with open(path, 'r') as f:
                cookies = json.load(f)
            logger.info(f"Loaded {len(cookies)} cookies from {path}")
            return cookies
        except Exception as e:
            logger.error(f"Failed to load cookies: {e}")
            return []

    def has_session(self, profile_name: str = "default", domain: str = None) -> bool:
        """Check if we have saved cookies, optionally filtered by domain."""
        cookies = self.load_cookies(profile_name)
        if not cookies:
            return False

        if domain:
            # Check if any cookie matches the domain
            for cookie in cookies:
                cookie_domain = cookie.get('domain', '')
                if domain in cookie_domain or cookie_domain in domain:
                    return True
            return False

        return len(cookies) > 0

    def filter_by_domain(self, cookies: list, domain: str) -> list:
        """Filter cookies that match a given domain."""
        return [
            c for c in cookies
            if domain in c.get('domain', '')
        ]

    def clear_cookies(self, profile_name: str = "default"):
        """Delete saved cookies for a profile."""
        path = self._profile_path(profile_name)
        if path.exists():
            path.unlink()
            logger.info(f"Cleared cookies for profile '{profile_name}'")

    def get_cookie_info(self, profile_name: str = "default", domain: str = None) -> dict:
        """Get info about saved cookies (count, names, filtered by domain if given)."""
        cookies = self.load_cookies(profile_name)
        if domain:
            relevant = self.filter_by_domain(cookies, domain)
        else:
            relevant = cookies

        return {
            "profile": profile_name,
            "total_cookies": len(cookies),
            "domain_cookies": len(relevant) if domain else len(cookies),
            "filtered_domain": domain,
            "has_session": len(relevant) > 0,
            "cookie_names": [c.get('name') for c in relevant[:20]],
            "cookie_domains": list(set(c.get('domain', '') for c in relevant)),
        }
