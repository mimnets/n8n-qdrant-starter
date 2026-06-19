"""
Human-like behaviors — delays, typing, mouse movement, scrolling.
These mimic real user patterns to avoid behavioral detection.
"""
import asyncio
import random
import math


def human_delay(min_s: float = 0.8, max_s: float = 3.5) -> float:
    """
    Generate a human-like delay using a skewed beta distribution.
    Most delays fall in the lower range, with occasional longer pauses.
    """
    # Beta(2, 3) gives a right-skewed distribution
    return min_s + (max_s - min_s) * random.betavariate(2, 3)


def action_delay() -> float:
    """Short delay between actions (0.3-1.5s)."""
    return random.uniform(0.3, 1.5)


def tiny_pause() -> float:
    """Pause between individual keystrokes (40-250ms)."""
    return random.uniform(0.04, 0.25)


def thinking_pause() -> float:
    """Pause when a human would be 'thinking' (1-4s)."""
    return random.uniform(1.0, 4.0)


def scroll_pause() -> float:
    """Pause after scrolling (0.5-3s)."""
    return random.uniform(0.5, 3.0)


def reading_pause(text_length: int) -> float:
    """
    Simulate reading time based on text length.
    ~200 words/min reading speed, with variance.
    """
    words = text_length / 5  # rough word count
    seconds = (words / 200) * 60
    # Add 30% variance
    return seconds * random.uniform(0.7, 1.3)


def random_bezier_point(start: float, end: float, t: float) -> float:
    """Calculate a cubic bezier curve point for smooth interpolation."""
    cp1 = start + (end - start) * random.uniform(0.2, 0.5)
    cp2 = start + (end - start) * random.uniform(0.5, 0.8)
    t2 = t * t
    t3 = t2 * t
    mt = 1 - t
    mt2 = mt * mt
    mt3 = mt2 * mt
    return mt3 * start + 3 * mt2 * t * cp1 + 3 * mt * t2 * cp2 + t3 * end


async def async_sleep(min_s: float, max_s: float = None):
    """Sleep for a human-like random duration."""
    if max_s is None:
        max_s = min_s * 1.5
    await asyncio.sleep(human_delay(min_s, max_s))


async def human_type(page, selector: str, text: str):
    """
    Type text like a human — variable speed, occasional pauses.
    Also simulates the human looking at what they typed.
    """
    element = page.locator(selector)
    await element.click()
    await asyncio.sleep(random.uniform(0.3, 0.8))

    for i, char in enumerate(text):
        await element.type(char, delay=tiny_pause() * 1000)

        # ~3% chance of a pause mid-word (thinking what to write)
        if random.random() < 0.03:
            await asyncio.sleep(random.uniform(0.8, 2.5))

        # ~15% pause after punctuation
        if char in '.!?' and random.random() < 0.15:
            await asyncio.sleep(random.uniform(1.0, 2.0))

        # ~5% pause after comma
        if char == ',' and random.random() < 0.05:
            await asyncio.sleep(random.uniform(0.5, 1.2))

        # ~2% chance of a typo -> backspace correction
        if random.random() < 0.02 and i < len(text) - 1:
            wrong_char = random.choice('qwertyuiopasdfghjklzxcvbnm')
            await element.type(wrong_char, delay=50)
            await asyncio.sleep(random.uniform(0.2, 0.5))
            await page.keyboard.press('Backspace')
            await asyncio.sleep(random.uniform(0.1, 0.3))

    # Brief pause after finishing typing (reviewing)
    await asyncio.sleep(random.uniform(0.5, 1.5))


async def human_scroll(page, distance: int = None, steps: int = None):
    """
    Scroll the page like a human — starts fast, slows down, then stops.
    """
    if distance is None:
        # Random scroll distance (300-800px)
        distance = random.randint(300, 800)

    if steps is None:
        steps = random.randint(4, 10)

    step_size = distance / steps

    for i in range(steps):
        # Variable step sizes — first few are larger, last few taper off
        progress = i / steps
        if progress < 0.3:
            # Starting phase — small acceleration
            multiplier = random.uniform(0.8, 1.2)
        elif progress < 0.7:
            # Middle — full speed
            multiplier = random.uniform(1.0, 1.5)
        else:
            # End — deceleration
            multiplier = random.uniform(0.3, 0.8)

        scroll_amount = int(step_size * multiplier)
        await page.evaluate(f"window.scrollBy(0, {scroll_amount})")
        await asyncio.sleep(random.uniform(0.05, 0.3))

    # Pause after scrolling
    await asyncio.sleep(scroll_pause())


async def human_mouse_move(page, target_x: int, target_y: int, steps: int = None):
    """
    Move mouse to a target with bezier curve path and variable speed.
    Not all automation frameworks expose this — best effort.
    """
    if steps is None:
        steps = random.randint(8, 20)

    current_pos = await page.evaluate("({x: window.mouseX || 0, y: window.mouseY || 0})")

    for i in range(steps + 1):
        t = i / steps
        x = random_bezier_point(current_pos.get('x', 0), target_x, t)
        y = random_bezier_point(current_pos.get('y', 0), target_y, t)
        await page.mouse.move(x, y)
        # Variable pause — faster in middle, slower at ends
        if t < 0.1 or t > 0.9:
            await asyncio.sleep(random.uniform(0.01, 0.03))
        else:
            await asyncio.sleep(random.uniform(0.002, 0.01))


async def human_click(page, selector: str):
    """
    Click an element like a human — move to it first, slight pause, then click.
    """
    element = page.locator(selector)
    box = await element.bounding_box()
    if box:
        # Move to a random point within the element
        target_x = box['x'] + box['width'] * random.uniform(0.2, 0.8)
        target_y = box['y'] + box['height'] * random.uniform(0.2, 0.8)
        await human_mouse_move(page, target_x, target_y)
        await asyncio.sleep(random.uniform(0.1, 0.3))
    await element.click()
    await asyncio.sleep(action_delay())


async def simulate_page_load_noise(page):
    """
    Simulate natural page interaction noise:
    - Small scrolls
    - Hovering over elements
    - Pauses
    """
    # 50% chance of scrolling a bit
    if random.random() < 0.5:
        await human_scroll(page, random.randint(100, 400))

    # 30% chance of hovering over something
    if random.random() < 0.3:
        try:
            links = page.locator('a')
            count = await links.count()
            if count > 0:
                idx = random.randint(0, min(count - 1, 5))
                link = links.nth(idx)
                box = await link.bounding_box()
                if box:
                    x = box['x'] + box['width'] * random.uniform(0.3, 0.7)
                    y = box['y'] + box['height'] * random.uniform(0.3, 0.7)
                    await page.mouse.move(x, y)
                    await asyncio.sleep(random.uniform(0.5, 1.5))
        except Exception:
            pass
