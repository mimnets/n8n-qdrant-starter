"""
server.py — single-file FastAPI REST API for browser-use Agent.

Persistent browser with cookie persistence so login sessions survive
between calls and across container restarts.

Endpoints
---------
GET  /health              — health check
POST /api/run             — run a browser task (blocks, returns result)
POST /api/browser/reset   — reset browser + clear cookies
GET  /api/providers       — list configured LLM providers

Design based on browser-use-fastapi-docker-server by gauravdhiman:
https://github.com/gauravdhiman/browser-use-fastapi-docker-server
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from pathlib import Path
from typing import Any, Optional

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from browser_use import Agent, Browser, BrowserConfig
from browser_use.agent.views import AgentHistoryList

from langchain_anthropic import ChatAnthropic
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_mistralai import ChatMistralAI
from langchain_ollama import ChatOllama
from langchain_openai import AzureChatOpenAI, ChatOpenAI

# ---------------------------------------------------------------------------
# Bootstrap
# ---------------------------------------------------------------------------
load_dotenv()

LOG_LEVEL = os.getenv("BROWSER_USE_LOGGING_LEVEL", "info").upper()
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("browser-api")

app = FastAPI(title="Browser Use API", version="1.0.0")

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
COOKIE_PATH = Path("/app/browser_profile/cookies.json")

# ---------------------------------------------------------------------------
# Persistent browser (global, reused across tasks)
# ---------------------------------------------------------------------------
_browser: Optional[Browser] = None
_browser_lock = asyncio.Lock()
_headful = os.getenv("BROWSER_USE_HEADFUL", "false").lower() == "true"


async def _get_browser() -> Browser:
    """Return the persistent browser instance, creating it if needed."""
    global _browser
    if _browser is not None:
        return _browser

    async with _browser_lock:
        if _browser is not None:  # double-check
            return _browser

        kwargs: dict[str, Any] = {"headless": not _headful}
        chrome_path = os.getenv("CHROME_PATH")
        if chrome_path:
            kwargs["chrome_instance_path"] = chrome_path

        config = BrowserConfig(**kwargs)
        _browser = Browser(config=config)

        # Restore cookies from previous session
        if COOKIE_PATH.exists():
            try:
                # browser-use stores cookies as JSON list of dicts
                with open(COOKIE_PATH) as f:
                    cookies = json.load(f)
                if cookies:
                    await _browser.restore_cookies(cookies)
                    logger.info("Loaded %d cookies from %s", len(cookies), COOKIE_PATH)
            except Exception as exc:
                logger.warning("Could not load cookies: %s", exc)

        logger.info("Persistent browser created (headless=%s)", not _headful)
        return _browser


async def _save_cookies() -> None:
    """Persist browser cookies to disk."""
    global _browser
    if _browser is None:
        return
    try:
        cookies = await _browser.get_cookies()
        COOKIE_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(COOKIE_PATH, "w") as f:
            json.dump(cookies, f)
        logger.info("Saved %d cookies to %s", len(cookies), COOKIE_PATH)
    except Exception as exc:
        logger.warning("Could not save cookies: %s", exc)


async def _reset_browser() -> None:
    """Close persistent browser, clear cookies, start fresh."""
    global _browser
    async with _browser_lock:
        if _browser is not None:
            try:
                await _browser.close()
            except Exception as exc:
                logger.warning("Error closing browser: %s", exc)
            _browser = None
        if COOKIE_PATH.exists():
            COOKIE_PATH.unlink()
            logger.info("Deleted %s", COOKIE_PATH)


# ---------------------------------------------------------------------------
# LLM factory (inline — one less file to maintain)
# ---------------------------------------------------------------------------
def _get_llm(provider: str, model: Optional[str] = None, temperature: float = 0.0):
    """Return a LangChain chat model for *provider*."""
    provider = provider.strip().lower()

    if provider == "openai":
        return ChatOpenAI(
            model=model or os.getenv("OPENAI_MODEL_ID", "gpt-4o"),
            temperature=temperature,
            api_key=os.getenv("OPENAI_API_KEY"),
            base_url=os.getenv("OPENAI_BASE_URL"),
        )

    if provider == "deepseek":
        return ChatOpenAI(
            model=model or os.getenv("DEEPSEEK_MODEL_ID", "deepseek-chat"),
            temperature=temperature,
            api_key=os.getenv("DEEPSEEK_API_KEY"),
            base_url=os.getenv("DEEPSEEK_ENDPOINT", "https://api.deepseek.com"),
        )

    if provider == "anthropic":
        return ChatAnthropic(
            model=model or os.getenv("ANTHROPIC_MODEL_ID", "claude-sonnet-4-6"),
            temperature=temperature,
            api_key=os.getenv("ANTHROPIC_API_KEY"),
            base_url=os.getenv("ANTHROPIC_ENDPOINT"),
        )

    if provider == "google":
        return ChatGoogleGenerativeAI(
            model=model or os.getenv("GOOGLE_MODEL_ID", "gemini-2.0-flash"),
            temperature=temperature,
            google_api_key=os.getenv("GOOGLE_API_KEY"),
        )

    if provider == "mistral":
        return ChatMistralAI(
            model=model or os.getenv("MISTRAL_MODEL_ID", "mistral-large-latest"),
            temperature=temperature,
            api_key=os.getenv("MISTRAL_API_KEY"),
            endpoint=os.getenv("MISTRAL_ENDPOINT"),
        )

    if provider == "ollama":
        return ChatOllama(
            model=model or os.getenv("OLLAMA_MODEL_ID", "llama3"),
            temperature=temperature,
            base_url=os.getenv("OLLAMA_ENDPOINT", "http://localhost:11434"),
        )

    if provider == "azure":
        return AzureChatOpenAI(
            azure_deployment=model or os.getenv("AZURE_OPENAI_DEPLOYMENT_NAME", ""),
            openai_api_version=os.getenv("AZURE_OPENAI_API_VERSION", "2025-01-01-preview"),
            azure_endpoint=os.getenv("AZURE_OPENAI_ENDPOINT", ""),
            api_key=os.getenv("AZURE_OPENAI_API_KEY"),
            temperature=temperature,
        )

    raise ValueError(f"Unknown provider: {provider!r}")


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------
class RunRequest(BaseModel):
    task: str = Field(..., description="Natural-language task description")
    llm_provider: str = Field("deepseek", description="deepseek | openai | anthropic | google | mistral | ollama | azure")
    model_name: Optional[str] = Field(None, description="Override model ID")
    max_steps: int = Field(30, ge=1, le=200)
    use_vision: bool = Field(False, description="Enable vision for the agent")
    sensitive_data: dict[str, str] = Field(default_factory=dict, description="Variables substituted into task (e.g. {{email}}, {{password}})")


class RunResponse(BaseModel):
    success: bool
    result: Optional[str] = None
    error: Optional[str] = None
    steps_taken: int = 0


class ResetResponse(BaseModel):
    success: bool
    message: str


# ---------------------------------------------------------------------------
# Sensitive-data interpolation
# ---------------------------------------------------------------------------
_SENSITIVE_RE = re.compile(r"\{\{(\w+)\}\}")


def _interpolate(task: str, sensitive_data: dict[str, str]) -> str:
    """Replace {{variable}} placeholders with values (values are masked in logs)."""
    return _SENSITIVE_RE.sub(lambda m: sensitive_data.get(m.group(1), m.group(0)), task)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/api/run", response_model=RunResponse)
async def run_task(payload: RunRequest):
    """Run a browser task and return the result directly (blocks until done)."""
    if not payload.task.strip():
        raise HTTPException(status_code=400, detail="Task cannot be empty")

    browser = await _get_browser()
    llm = _get_llm(payload.llm_provider, payload.model_name)

    # Interpolate sensitive variables
    task_text = _interpolate(payload.task, payload.sensitive_data)

    # Log task (mask sensitive values)
    masked = task_text
    for key in payload.sensitive_data:
        masked = masked.replace(payload.sensitive_data[key], f"***{key}***")
    logger.info("Running task: %s (provider=%s, max_steps=%d)", masked, payload.llm_provider, payload.max_steps)

    try:
        agent = Agent(
            task=task_text,
            llm=llm,
            browser=browser,
            use_vision=payload.use_vision,
        )
        result: AgentHistoryList = await agent.run(max_steps=payload.max_steps)

        # Save cookies after task (preserve login state)
        await _save_cookies()

        final = result.final_result()
        steps = result.number_of_steps()

        return RunResponse(
            success=True,
            result=final or _collect_extracted(result),
            steps_taken=steps,
        )

    except Exception as exc:
        logger.exception("Task failed")
        return RunResponse(success=False, error=str(exc))


@app.post("/api/browser/reset", response_model=ResetResponse)
async def reset_browser():
    """Reset the browser session and clear saved cookies."""
    await _reset_browser()
    # Lazily recreate browser on next /api/run call
    return ResetResponse(success=True, message="Browser reset — fresh session on next call")


@app.get("/api/providers")
async def list_providers():
    """Return available LLM providers and whether they are configured."""
    providers = {}

    def _check(key: str) -> bool:
        val = os.getenv(key, "")
        return bool(val) and "placeholder" not in val.lower() and "your_" not in val.lower()

    providers["deepseek"] = {
        "available": _check("DEEPSEEK_API_KEY"),
        "model": os.getenv("DEEPSEEK_MODEL_ID", "deepseek-chat"),
    }
    providers["openai"] = {
        "available": _check("OPENAI_API_KEY"),
        "model": os.getenv("OPENAI_MODEL_ID", "gpt-4o"),
    }
    providers["anthropic"] = {
        "available": _check("ANTHROPIC_API_KEY"),
        "model": os.getenv("ANTHROPIC_MODEL_ID", "claude-sonnet-4-6"),
    }
    providers["google"] = {
        "available": _check("GOOGLE_API_KEY"),
        "model": os.getenv("GOOGLE_MODEL_ID", "gemini-2.0-flash"),
    }
    providers["mistral"] = {
        "available": _check("MISTRAL_API_KEY"),
        "model": os.getenv("MISTRAL_MODEL_ID", "mistral-large-latest"),
    }
    providers["ollama"] = {
        "available": bool(os.getenv("OLLAMA_ENDPOINT")),
        "model": os.getenv("OLLAMA_MODEL_ID", "llama3"),
    }
    providers["azure"] = {
        "available": _check("AZURE_OPENAI_API_KEY"),
        "model": os.getenv("AZURE_OPENAI_DEPLOYMENT_NAME", ""),
    }
    default = os.getenv("DEFAULT_AI_PROVIDER", "deepseek")
    return {"default": default, "providers": providers}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _collect_extracted(result: AgentHistoryList) -> str:
    """Collect extracted content from history when final_result() is None."""
    parts = result.extracted_content()
    return "\n".join(parts) if parts else f"Completed in {result.number_of_steps()} steps (no final result)"


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run(app, host="0.0.0.0", port=port)
