"""
Stealth patches — injects browser fingerprint overrides to avoid
LinkedIn, Facebook, and similar anti-bot detection.
"""
import random

STEALTH_JS = """
// ======================================================
// Stealth initialization script
// Run on every page load via addInitScript
// ======================================================

// 1. webdriver flag — the biggest red flag
Object.defineProperty(navigator, 'webdriver', {
    get: () => undefined
});

// 2. languages — real browsers always have this
Object.defineProperty(navigator, 'languages', {
    get: () => ['en-US', 'en']
});

// 3. plugins — real browsers have at least a few
Object.defineProperty(navigator, 'plugins', {
    get: () => [
        { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
        { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
        { name: 'Native Client', filename: 'internal-nacl-plugin' }
    ],
    configurable: true
});

// 4. chrome.runtime — sites check this
window.chrome = {
    runtime: {
        connect: () => {},
        sendMessage: () => {},
        onMessage: { addListener: () => {} },
        onConnect: { addListener: () => {} }
    },
    loadTimes: () => {},
    csi: () => {},
    app: { isInstalled: false, InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' }, RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' } }
};

// 5. Permissions — pretend we haven't been queried
if (navigator.permissions) {
    const origQuery = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = (desc) => {
        if (desc.name === 'notifications') {
            return Promise.resolve({ state: 'prompt', onchange: null });
        }
        return origQuery(desc);
    };
}

// 6. WebGL vendor — mask automation
const getParameterProxyHandler = {
    apply: function(target, ctx, args) {
        const param = args[0];
        // UNMASKED_VENDOR_WEBGL
        if (param === 37445) return 'Intel Inc.';
        // UNMASKED_RENDERER_WEBGL
        if (param === 37446) return 'Intel Iris OpenGL Engine';
        return Reflect.apply(target, ctx, args);
    }
};
try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl');
    if (gl) {
        const origGetParameter = gl.getParameter.bind(gl);
        gl.getParameter = new Proxy(origGetParameter, getParameterProxyHandler);
    }
} catch(e) {}

// 7. Canvas fingerprint randomization (minor noise)
try {
    const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function(type, quality) {
        const canvas = this;
        const context = canvas.getContext('2d');
        if (context) {
            // Add a single transparent pixel of noise (undetectable to humans)
            const imageData = context.getImageData(0, 0, 1, 1);
            imageData.data[0] = Math.min(255, imageData.data[0] + 1);
            imageData.data[1] = Math.max(0, imageData.data[1] - 1);
            context.putImageData(imageData, 0, 0);
        }
        return origToDataURL.call(canvas, type, quality);
    };
} catch(e) {}

// 8. Screen dimensions — fake a standard display
Object.defineProperty(screen, 'pixelDepth', { get: () => 24 });
Object.defineProperty(screen, 'colorDepth', { get: () => 24 });

// 9. Hardware concurrency — varies subtly
Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });

// 10. Device memory
Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });

// 11. Connection type — fake a realistic connection
if (navigator.connection) {
    Object.defineProperty(navigator.connection, 'rtt', { get: () => 50 });
    Object.defineProperty(navigator.connection, 'downlink', { get: () => 10 });
    Object.defineProperty(navigator.connection, 'effectiveType', { get: () => '4g' });
}

// 12. Remove phantom "headless" indicators
// headless Chrome doesn't have these media codecs
try {
    const origFn = MediaRecorder.isTypeSupported;
    MediaRecorder.isTypeSupported = (type) => {
        return true;
    };
} catch(e) {}
"""

# User agents by platform — real, current, varied
USER_AGENTS = {
    "linux": [
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    ],
    "windows": [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    ],
    "macos": [
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
    ],
}

# Viewport presets — standard human monitor sizes
VIEWPORTS = [
    {"width": 1920, "height": 1080},
    {"width": 1920, "height": 1200},
    {"width": 1440, "height": 900},
    {"width": 1536, "height": 864},
    {"width": 1366, "height": 768},
  ]

# Timezones matched to UA region
TIMEZONES = {
    "us_east": "America/New_York",
    "us_west": "America/Los_Angeles",
    "us_central": "America/Chicago",
    "eu_west": "Europe/London",
    "eu_central": "Europe/Berlin",
    "asia": "Asia/Kolkata",
}

LOCALES = ["en-US", "en-GB", "en-CA", "en-AU"]


def get_stealth_script() -> str:
    return STEALTH_JS


def pick_user_agent(platform: str = "linux") -> tuple[str, str]:
    """
    Pick a random user agent for the given platform.
    Returns (user_agent_string, platform_label).
    """
    agents = USER_AGENTS.get(platform, USER_AGENTS["linux"])
    return random.choice(agents), platform


def pick_viewport() -> dict:
    return random.choice(VIEWPORTS)


def pick_locale() -> str:
    return random.choice(LOCALES)


def pick_timezone() -> str:
    return random.choice(list(TIMEZONES.values()))
