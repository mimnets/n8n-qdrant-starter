from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlparse

import structlog

from app.api.errors import AssetFetchError

logger = structlog.get_logger(__name__)

_BLOCKED_HOSTNAMES = frozenset(
    {
        "metadata.google.internal",
        "metadata.google",
        "169.254.169.254",
    }
)

_CLOUD_METADATA_PATHS = frozenset(
    {
        "/computeMetadata/",
        "/latest/meta-data/",
        "/metadata/instance",
    }
)


class SSRFValidationError(AssetFetchError):
    error_code = "SSRF_BLOCKED"
    status_code = 403
    detail = "URL blocked by SSRF protection."


def _is_blocked_ip(addr: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    """Return True if the IP address belongs to a blocked network."""
    if isinstance(addr, ipaddress.IPv6Address):
        mapped = addr.ipv4_mapped
        if mapped is not None:
            return _is_blocked_ip(mapped)
        return addr.is_loopback or addr.is_link_local or addr.is_private

    return (
        addr.is_loopback
        or addr.is_private
        or addr.is_link_local
        or addr.is_reserved
        or addr.is_multicast
        or addr == ipaddress.IPv4Address("0.0.0.0")
    )


def validate_url(url: str, *, allow_http: bool = False) -> str:
    """Validate a URL against SSRF attacks.

    Returns the validated URL string on success.
    Raises ``SSRFValidationError`` on any blocked pattern.
    """
    parsed = urlparse(url)

    if not parsed.scheme:
        raise SSRFValidationError(
            detail="URL has no scheme",
            context={"url": url},
        )

    allowed_schemes = {"https"}
    if allow_http:
        allowed_schemes.add("http")

    if parsed.scheme not in allowed_schemes:
        raise SSRFValidationError(
            detail=f"Scheme '{parsed.scheme}' is not allowed",
            context={"url": url, "scheme": parsed.scheme},
        )

    if not parsed.hostname:
        raise SSRFValidationError(
            detail="URL has no hostname",
            context={"url": url},
        )

    hostname = parsed.hostname.lower().rstrip(".")

    if parsed.username or parsed.password:
        raise SSRFValidationError(
            detail="URL must not contain credentials",
            context={"url": url},
        )

    if hostname in _BLOCKED_HOSTNAMES:
        raise SSRFValidationError(
            detail="Hostname is blocked",
            context={"url": url, "hostname": hostname},
        )

    for meta_path in _CLOUD_METADATA_PATHS:
        if parsed.path.startswith(meta_path):
            raise SSRFValidationError(
                detail="Cloud metadata path is blocked",
                context={"url": url, "path": parsed.path},
            )

    _check_hostname_ip(hostname, url)

    return url


def validate_redirect_url(url: str, *, allow_http: bool = False) -> str:
    """Validate a redirect target URL.

    Same rules as ``validate_url`` but called during redirect following.
    """
    return validate_url(url, allow_http=allow_http)


def _check_hostname_ip(hostname: str, url: str) -> None:
    """Resolve hostname to IP addresses and block private/reserved ones."""
    try:
        addr = ipaddress.ip_address(hostname)
        if _is_blocked_ip(addr):
            raise SSRFValidationError(
                detail="IP address is blocked",
                context={"url": url, "ip": str(addr)},
            )
        return
    except ValueError:
        pass

    try:
        results = socket.getaddrinfo(
            hostname,
            None,
            socket.AF_UNSPEC,
            socket.SOCK_STREAM,
        )
    except socket.gaierror as exc:
        raise SSRFValidationError(
            detail=f"DNS resolution failed for {hostname}",
            context={"url": url, "hostname": hostname},
        ) from exc

    if not results:
        raise SSRFValidationError(
            detail=f"No DNS results for {hostname}",
            context={"url": url, "hostname": hostname},
        )

    for _family, _type, _proto, _canonname, sockaddr in results:
        ip_str = sockaddr[0]
        try:
            addr = ipaddress.ip_address(ip_str)
        except ValueError:
            continue
        if _is_blocked_ip(addr):
            logger.warning(
                "ssrf_dns_blocked",
                url=url,
                hostname=hostname,
                resolved_ip=ip_str,
            )
            raise SSRFValidationError(
                detail="Hostname resolves to a blocked IP address",
                context={
                    "url": url,
                    "hostname": hostname,
                    "resolved_ip": ip_str,
                },
            )
