"""
AI Agent — drives the browser using LLM vision instead of hardcoded handlers.
Works with OpenAI, DeepSeek, Anthropic, Google Gemini (any OpenAI-compatible API).
"""
import asyncio
import base64
import json
import os
import re
import logging
from typing import Optional

from openai import AsyncOpenAI

logger = logging.getLogger(__name__)

# ── Provider config ──────────────────────────────────────────────────────────

PROVIDERS = {
    "openai": {
        "api_key": os.getenv("OPENAI_API_KEY"),
        "base_url": os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1"),
        "model": os.getenv("OPENAI_MODEL_ID", "gpt-4o"),
    },
    "deepseek": {
        "api_key": os.getenv("DEEPSEEK_API_KEY"),
        "base_url": os.getenv("DEEPSEEK_ENDPOINT", "https://api.deepseek.com"),
        "model": os.getenv("DEEPSEEK_MODEL_ID", "deepseek-chat"),
    },
    "anthropic": {
        "api_key": os.getenv("ANTHROPIC_API_KEY"),
        "base_url": os.getenv("ANTHROPIC_ENDPOINT", "https://api.anthropic.com"),
        "model": os.getenv("ANTHROPIC_MODEL_ID", "claude-sonnet-4-6"),
    },
    "google": {
        "api_key": os.getenv("GOOGLE_API_KEY"),
        "base_url": "https://generativelanguage.googleapis.com/v1beta/openai",
        "model": os.getenv("GOOGLE_MODEL_ID", "gemini-2.0-flash"),
    },
}

DEFAULT_PROVIDER = os.getenv("DEFAULT_AI_PROVIDER", "openai")


def get_client(provider: str = None) -> tuple[AsyncOpenAI, str]:
    """Get an OpenAI-compatible client and model name for the given provider."""
    provider = provider or DEFAULT_PROVIDER
    cfg = PROVIDERS.get(provider, PROVIDERS["openai"])
    api_key = cfg["api_key"]
    if not api_key:
        # Fallback chain
        for fallback in PROVIDERS.values():
            if fallback["api_key"]:
                cfg = fallback
                api_key = fallback["api_key"]
                break
        if not api_key:
            raise ValueError(f"No API keys configured. Set at least one LLM provider in .env")

    client = AsyncOpenAI(api_key=api_key, base_url=cfg["base_url"])
    return client, cfg["model"]


# ── Interactive element extraction ───────────────────────────────────────────

async def get_page_elements(page) -> str:
    """Extract clickable/text elements from the page as structured text."""
    try:
        elements = await page.evaluate("""
            () => {
                const results = [];
                const seen = new Set();

                // Collect interactive elements
                const selectors = [
                    'button', 'a[href]', 'input:not([type=hidden])',
                    'textarea', 'select', '[role=button]', '[role=link]',
                    '[role=textbox]', '[contenteditable=true]',
                    '[tabindex]:not([tabindex=-1])',
                    'label', '[aria-label]'
                ];

                document.querySelectorAll(selectors.join(',')).forEach(el => {
                    const rect = el.getBoundingClientRect();
                    // Skip invisible elements
                    if (rect.width < 5 || rect.height < 5) return;
                    if (el.offsetParent === null) return;

                    const tag = el.tagName.toLowerCase();
                    const text = (el.textContent || '').trim().slice(0, 80);
                    const aria = el.getAttribute('aria-label') || '';
                    const placeholder = el.getAttribute('placeholder') || '';
                    const href = el.getAttribute('href') || '';
                    const name = el.getAttribute('name') || '';
                    const type = el.getAttribute('type') || '';

                    const key = `${tag}|${text}|${aria}|${href.slice(0,30)}`;
                    if (seen.has(key)) return;
                    seen.add(key);

                    results.push({
                        tag, text: text || aria || placeholder,
                        x: Math.round(rect.left + rect.width/2),
                        y: Math.round(rect.top + rect.height/2),
                        w: Math.round(rect.width),
                        h: Math.round(rect.height),
                        href: href.slice(0, 100),
                        name, type,
                        visible: rect.top < window.innerHeight && rect.left < window.innerWidth
                    });
                });

                return JSON.stringify(results.slice(0, 100));
            }
        """)
        return elements
    except Exception as e:
        logger.warning(f"Element extraction failed: {e}")
        return "[]"


async def get_page_text(page) -> str:
    """Get visible page text."""
    try:
        text = await page.evaluate("""
            () => {
                const main = document.querySelector(
                    'main, [role=main], article, .post-content, body'
                );
                const t = (main || document.body).innerText || '';
                return t.slice(0, 4000);
            }
        """)
        return text
    except Exception:
        return ""


def build_prompt(task: str, url: str, elements_json: str, page_text: str, step: int, max_steps: int) -> list:
    """Build the LLM prompt messages."""
    system = f"""You are a browser automation AI. Your job is to complete this task step by step:

TASK: {task}

You are on page: {url}

Available interactive elements (tag, text, position x,y, size w,h):
{elements_json[:3000]}

Visible page text:
{page_text[:2000]}

Step {step}/{max_steps}. Respond with ONE action in JSON format:

For clicking:   {{"action": "click", "x": <number>, "y": <number>, "reason": "why"}}
For typing:     {{"action": "type", "text": "text to type", "reason": "why"}}
For scroll:     {{"action": "scroll", "direction": "down|up", "amount": <pixels>, "reason": "why"}}
For wait:       {{"action": "wait", "seconds": <number>, "reason": "why"}}
For done:       {{"action": "done", "result": "summary of what happened", "reason": "why"}}
For failed:     {{"action": "failed", "error": "what went wrong", "reason": "why"}}

Rules:
- Click on elements using their x,y coordinates from the element list
- Type text into visible text boxes (click on the text box first, then use the type action)
- If you need to navigate to a URL, look for a link or address bar
- Keep an eye on the page text to confirm actions worked
- When the task is complete, respond with the "done" action
- Be precise with coordinates - click the center of buttons and links
- For posting content, find and use visible post/editor elements"""

    return [
        {"role": "system", "content": system},
        {"role": "user", "content": f"Current step {step}/{max_steps}. What action should I take next?"}
    ]


# ── Main agent loop ──────────────────────────────────────────────────────────

async def run_ai_agent(
    page,
    task: str,
    max_steps: int = 30,
    provider: str = None,
    on_captcha: callable = None,
) -> str:
    """Run an AI agent that drives the browser to complete a task.

    Returns the final result or error message.
    """
    client, model = get_client(provider)
    log_steps = []

    for step in range(1, max_steps + 1):
        logger.info(f"AI Agent step {step}/{max_steps}")

        # Get current page state
        url = page.url
        elements_json = await get_page_elements(page)
        page_text = await get_page_text(page)

        # Take a screenshot for the LLM (base64)
        screenshot_b64 = None
        try:
            screenshot_bytes = await page.screenshot(type="jpeg", quality=60, full_page=False)
            screenshot_b64 = base64.b64encode(screenshot_bytes).decode()
        except Exception as e:
            logger.warning(f"Screenshot failed: {e}")

        # Build prompt and call LLM
        messages = build_prompt(task, url, elements_json, page_text, step, max_steps)

        try:
            # Prepare API call with or without vision
            api_kwargs = {
                "model": model,
                "messages": messages,
                "temperature": 0.1,
                "max_tokens": 500,
            }

            # Add screenshot for vision-capable models
            if screenshot_b64:
                # Some models need the screenshot as a user message with image
                vision_msg = {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": f"Here's what the page looks like (step {step}/{max_steps}):"},
                        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{screenshot_b64}"}},
                    ]
                }
                # Add vision message before the text message
                messages.append(vision_msg)

            response = await client.chat.completions.create(**api_kwargs)
            reply = response.choices[0].message.content.strip()

        except Exception as e:
            logger.error(f"LLM call failed: {e}")
            return f"❌ AI agent error: {str(e)}"

        # Parse action from response
        action = parse_action(reply)
        if not action:
            logger.warning(f"Could not parse action from: {reply[:200]}")
            continue

        log_steps.append(f"Step {step}: {action.get('action')} — {action.get('reason', '')}")
        logger.info(f"Action: {action}")

        # Execute the action
        result = await execute_action(page, action)
        if result:  # Action returned a result message (done, failed)
            return f"{result}\n\nSteps:\n" + "\n".join(log_steps)

        # Brief pause between actions
        await asyncio.sleep(0.5)

    return f"✅ Reached max steps ({max_steps}).\n\nSteps:\n" + "\n".join(log_steps)


def parse_action(reply: str) -> Optional[dict]:
    """Extract JSON action from LLM response."""
    # Try to find JSON block
    json_match = re.search(r'\{[^{}]*\}', reply, re.DOTALL)
    if json_match:
        try:
            return json.loads(json_match.group())
        except json.JSONDecodeError:
            pass
    return None


async def execute_action(page, action: dict) -> Optional[str]:
    """Execute an action on the page. Returns a result string if terminal."""
    action_type = action.get("action", "").lower().strip()

    if action_type == "click":
        x, y = action.get("x"), action.get("y")
        if x is not None and y is not None:
            await page.mouse.move(x, y)
            await asyncio.sleep(0.2)
            await page.mouse.click(x, y)
            await asyncio.sleep(1)
        return None

    elif action_type == "type":
        text = action.get("text", "")
        if text:
            await page.keyboard.type(text, delay=30)
            await asyncio.sleep(0.5)
        return None

    elif action_type == "scroll":
        direction = action.get("direction", "down")
        amount = action.get("amount", 500)
        delta_y = amount if direction == "down" else -amount
        await page.mouse.wheel(0, delta_y)
        await asyncio.sleep(0.5)
        return None

    elif action_type == "wait":
        seconds = action.get("seconds", 2)
        await asyncio.sleep(seconds)
        return None

    elif action_type == "navigate":
        url = action.get("url", "")
        if url:
            await page.goto(url, wait_until="domcontentloaded")
            await asyncio.sleep(2)
        return None

    elif action_type == "done":
        result = action.get("result", "Task completed")
        return f"✅ {result}"

    elif action_type == "failed":
        error = action.get("error", "Unknown error")
        return f"❌ {error}"

    else:
        logger.warning(f"Unknown action type: {action_type}")
        return None
