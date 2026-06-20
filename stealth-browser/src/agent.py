"""
Browser Agent — DOM-based AI agent inspired by browser-use.
No screenshots. Extracts page elements as text, sends to LLM,
gets action decisions, executes them via Playwright.

Works with any OpenAI-compatible API: OpenAI, DeepSeek, Google Gemini, etc.
"""
import asyncio
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
    "google": {
        "api_key": os.getenv("GOOGLE_API_KEY"),
        "base_url": "https://generativelanguage.googleapis.com/v1beta/openai",
        "model": os.getenv("GOOGLE_MODEL_ID", "gemini-2.0-flash"),
    },
}

DEFAULT_PROVIDER = os.getenv("DEFAULT_AI_PROVIDER", "openai")


def get_client_and_model(provider: str = None, max_retries: int = 1) -> tuple:
    """Get client and model. Returns (None, error_msg) if no keys configured."""
    provider = provider or DEFAULT_PROVIDER
    cfg = PROVIDERS.get(provider, PROVIDERS["openai"])
    api_key = cfg["api_key"]

    if not api_key:
        # Try fallback chain
        for name, fallback in PROVIDERS.items():
            if fallback["api_key"]:
                cfg = fallback
                api_key = fallback["api_key"]
                provider = name
                logger.info(f"Falling back to LLM provider: {name}")
                break

    if not api_key:
        return None, "No LLM API keys configured. Set OPENAI_API_KEY, DEEPSEEK_API_KEY, or GOOGLE_API_KEY in .env"

    if not api_key.startswith("sk-") and provider == "deepseek":
        # DeepSeek keys start with sk-
        logger.warning("DeepSeek key doesn't start with sk- — may fail")

    client = AsyncOpenAI(api_key=api_key, base_url=cfg["base_url"], max_retries=max_retries)
    return (client, cfg["model"]), None


# ── Page element extraction (DOM-based, no screenshots) ─────────────────────

async def extract_page_state(page) -> str:
    """Get a structured view of the current page — interactive elements + text."""
    try:
        state = await page.evaluate("""
            () => {
                const results = [];
                const seen = new Set();
                const scrollY = window.scrollY;
                const viewH = window.innerHeight;

                // Collect all clickable/interactive elements
                const selectors = [
                    'button', 'a[href]', 'input:not([type=hidden]):not([type=submit])',
                    'textarea', 'select', '[role=button]', '[role=link]',
                    '[role=textbox]', '[role=tab]', '[role=menuitem]',
                    '[contenteditable=true]', 'label',
                    '[aria-label]', '[aria-pressed]', '[aria-checked]',
                    '[tabindex]:not([tabindex=-1])',
                    '.artdeco-button',  // LinkedIn specific
                ];

                document.querySelectorAll(selectors.join(',')).forEach(el => {
                    const rect = el.getBoundingClientRect();
                    if (rect.width < 3 || rect.height < 3) return;
                    if (rect.top > viewH + 200 || rect.bottom < -200) return; // visible area

                    const tag = el.tagName.toLowerCase();
                    const textParts = [];
                    el.childNodes.forEach(n => {
                        if (n.nodeType === 3) textParts.push(n.textContent.trim());
                        if (n.nodeType === 1 && !['script','style'].includes(n.tagName.toLowerCase())) {
                            const t = n.textContent.trim();
                            if (t.length < 100) textParts.push(t);
                        }
                    });
                    const text = textParts.filter(Boolean).join(' ').slice(0, 100);
                    const aria = el.getAttribute('aria-label') || '';
                    const ph = el.getAttribute('placeholder') || '';
                    const href = el.getAttribute('href') || '';
                    const name = el.getAttribute('name') || '';
                    const cls = (el.className || '').slice(0, 60);
                    const dataCtrl = el.getAttribute('data-control-name') || '';
                    const testId = el.getAttribute('data-test-id') || '';
                    const testModule = el.getAttribute('data-test-module') || '';

                    // Skip empty/trivial elements
                    const label = text || aria || ph || '';
                    if (!label && !href && !aria && !dataCtrl) return;

                    const key = `${tag}|${label.slice(0,30)}|${cls.slice(0,20)}|${href.slice(0,30)}`;
                    if (seen.has(key)) return;
                    seen.add(key);

                    results.push({
                        id: results.length + 1,
                        tag,
                        text: label.slice(0, 80),
                        href: href.slice(0, 120),
                        cls: cls,
                        attr: (aria || ph || name || '').slice(0, 60),
                        ctrl: dataCtrl,
                        visible: rect.top < viewH && rect.bottom > 0,
                    });
                });

                // Get page title and URL
                const info = {
                    title: document.title,
                    url: window.location.href,
                    elements: results.slice(0, 80),
                    text: (document.body.innerText || '').slice(0, 3000),
                };
                return info;
            }
        """)

        # Format as readable text
        lines = [f"URL: {state['url']}", f"Title: {state['title']}", ""]

        if state.get("elements"):
            lines.append("--- Interactive elements ---")
            for el in state["elements"]:
                parts = [f"[{el['id']}] <{el['tag']}>"]
                if el['text']:
                    parts.append(f'"{el["text"]}"')
                if el['href']:
                    parts.append(f"→{el['href']}")
                if el['ctrl']:
                    parts.append(f"(ctrl:{el['ctrl']})")
                lines.append("  " + " ".join(parts))

        lines.append("")
        lines.append("--- Page text (first 3000 chars) ---")
        lines.append(state.get("text", ""))

        return "\n".join(lines)

    except Exception as e:
        logger.warning(f"Page state extraction failed: {e}")
        return f"URL: {page.url}\nError extracting page state: {e}"


async def get_element_count(page) -> int:
    """Quick count of interactive elements on the page."""
    try:
        return await page.evaluate("document.querySelectorAll('button, a[href], input, textarea, [role=button], [role=textbox], [aria-label]').length")
    except Exception:
        return 0


# ── Action parsing ──────────────────────────────────────────────────────────

def parse_action(reply: str) -> Optional[dict]:
    """Extract JSON action from LLM response. Handles various formats."""
    # Try to find JSON in code block
    block = re.search(r'```(?:json)?\s*\n?(.*?)```', reply, re.DOTALL)
    if block:
        reply = block.group(1)

    # Find JSON object
    json_match = re.search(r'\{[^{}]*\}', reply, re.DOTALL)
    if json_match:
        try:
            return json.loads(json_match.group())
        except json.JSONDecodeError:
            pass

    # Try to find action keywords
    for action in ["click", "type", "scroll", "wait", "done", "fail", "navigate"]:
        if f'"{action}"' in reply or f"'{action}'" in reply:
            return {"action": action, "error": "partial parse", "raw": reply[:200]}
    return None


# ── Action execution ─────────────────────────────────────────────────────────

async def execute_action(page, action: dict) -> Optional[str]:
    """Execute an action. Returns result string if terminal (done/fail)."""
    action_type = action.get("action", "").lower().strip()

    if action_type == "click":
        element_id = action.get("element_id")
        selector = action.get("selector")

        if element_id:
            # Click by element ID from the extracted list
            try:
                # Use the element_id to find the element by index in the DOM
                result = await page.evaluate(f"""
                    () => {{
                        const all = document.querySelectorAll('button, a[href], input:not([type=hidden]), textarea, select, [role=button], [role=link], [role=textbox], [aria-label], [contenteditable=true], .artdeco-button');
                        const el = all[{element_id} - 1];
                        if (!el) return 'not_found';
                        el.scrollIntoView({{block: 'center'}});
                        el.click();
                        return 'clicked';
                    }}
                """)
                if result == 'not_found':
                    logger.warning(f"Element #{element_id} not found")
                await asyncio.sleep(1)
            except Exception as e:
                logger.warning(f"Click by element_id failed: {e}")

        elif selector:
            try:
                el = page.locator(selector).first
                await el.scroll_into_view_if_needed()
                await el.click(delay=50)
                await asyncio.sleep(1)
            except Exception as e:
                logger.warning(f"Click by selector failed: {e}")
        return None

    elif action_type == "type":
        text = action.get("text", "")
        clear = action.get("clear", True)
        element_id = action.get("element_id")

        if element_id:
            try:
                result = await page.evaluate(f"""
                    () => {{
                        const all = document.querySelectorAll('input:not([type=hidden]), textarea, [role=textbox], [contenteditable=true]');
                        const el = all[{element_id} - 1];
                        if (!el) return 'not_found';
                        el.focus();
                        if ({str(clear).lower()}) el.value = '';
                        el.value = '';
                        return 'focused';
                    }}
                """)
                if result != 'not_found':
                    # Type with human-like delays
                    for chunk in [text[i:i+20] for i in range(0, len(text), 20)]:
                        await page.keyboard.type(chunk, delay=30)
                        await asyncio.sleep(0.05)
                    await asyncio.sleep(0.3)
            except Exception as e:
                logger.warning(f"Type failed: {e}")
        return None

    elif action_type == "scroll":
        direction = action.get("direction", "down")
        amount = action.get("amount", 500)
        delta_y = amount if direction == "down" else -amount
        await page.mouse.wheel(0, delta_y)
        await asyncio.sleep(0.8)
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
        result = action.get("result", action.get("answer", "Task completed"))
        return f"DONE: {result}"

    elif action_type in ("fail", "failed", "error"):
        error = action.get("error", action.get("message", "Task failed"))
        return f"FAILED: {error}"

    else:
        logger.warning(f"Unknown action: {action_type}")
        return None


# ── Main agent loop ──────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are a browser automation AI. Your job is to complete the user's task by controlling a web browser.

You will receive:
1. The current page state (URL, title, interactive elements with IDs, visible text)
2. Your task

Each interactive element has an ID number. Use these IDs to interact with them.

Respond with EXACTLY ONE action in JSON format. No other text.

Available actions:

1. Click an element:
{"action": "click", "element_id": 5, "reason": "Click the Start a post button"}

2. Type text:
{"action": "type", "element_id": 3, "text": "Hello world", "clear": true, "reason": "Type post content"}

3. Scroll:
{"action": "scroll", "direction": "down", "amount": 500, "reason": "Scroll to see more"}

4. Navigate to URL:
{"action": "navigate", "url": "https://...", "reason": "Go to login page"}

5. Wait:
{"action": "wait", "seconds": 3, "reason": "Wait for page to load"}

6. Task complete:
{"action": "done", "result": "Successfully posted to LinkedIn", "reason": "All done"}

7. Task failed:
{"action": "fail", "error": "Could not find the post button", "reason": "Element not found"}

RULES:
- Use element IDs from the page state to click/type
- If a page asks for login, find the email/password fields and type credentials
- If you see a login page, log in first using credentials from the task
- For LinkedIn: find "Start a post" or "Create a post" buttons
- For typing text boxes: click first, then use type action
- Scroll down if you need to find more elements
- When the task is done, use the "done" action
- Be precise — one action at a time
- Try different approaches if something doesn't work immediately"""


async def run_browser_agent(
    page,
    task: str,
    max_steps: int = 30,
    provider: str = None,
    sensitive_data: dict = None,
) -> str:
    """Run a DOM-based browser agent. No screenshots."""
    # Get LLM
    result = get_client_and_model(provider)
    if isinstance(result, tuple) and len(result) == 2:
        client_model, error = result
        if error:
            return f"❌ {error}"
        client, model = client_model
    else:
        return "❌ No LLM configured"

    steps_taken = 0
    log = []

    for step in range(1, max_steps + 1):
        steps_taken = step
        logger.info(f"Step {step}/{max_steps}")

        # Get page state
        page_state = await extract_page_state(page)

        # Replace sensitive data placeholders in task
        current_task = task
        if sensitive_data:
            for key, value in sensitive_data.items():
                placeholder = "{{" + key + "}}"
                current_task = current_task.replace(placeholder, value)

        # Build the user message with context
        user_msg = f"""Step {step}/{max_steps}

TASK: {current_task}

CURRENT PAGE:
{page_state}

What action should I take next?"""

        # Call LLM
        try:
            response = await client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_msg},
                ],
                temperature=0.1,
                max_tokens=600,
            )
            reply = response.choices[0].message.content.strip()
        except Exception as e:
            logger.error(f"LLM call failed: {e}")
            return f"❌ LLM error: {e}"

        # Parse action
        action = parse_action(reply)
        if not action:
            logger.warning(f"Could not parse: {reply[:200]}")
            continue

        logger.info(f"Action: {action.get('action')} — {action.get('reason', '')[:80]}")

        # Execute
        result = await execute_action(page, action)
        log.append(f"Step {step}: {action.get('action')} - {action.get('reason', '')}")

        if result:
            if result.startswith("DONE:"):
                return f"✅ {result[5:].strip()}\n\nSteps taken: {steps_taken}\n" + "\n".join(log[-5:])
            elif result.startswith("FAILED:"):
                return f"❌ {result[7:].strip()}"
            return result

    return f"✅ Task reached max steps ({max_steps})\n\n" + "\n".join(log[-5:])
