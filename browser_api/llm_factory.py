"""
LLM provider factory — returns LangChain chat model instances for all supported
providers. Environment variables drive the configuration so no secrets live in code.

Supported providers:
    openai, anthropic, deepseek, google, mistral, ollama, azure

DeepSeek is routed through ChatOpenAI with base_url overridden.
"""

from __future__ import annotations

import os
from typing import Optional

from langchain_anthropic import ChatAnthropic
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_mistralai import ChatMistralAI
from langchain_ollama import ChatOllama
from langchain_openai import AzureChatOpenAI, ChatOpenAI


def get_llm(
    provider: str,
    model: Optional[str] = None,
    temperature: float = 0.0,
):
    """
    Return a LangChain chat model for *provider*.

    Parameters
    ----------
    provider : str
        One of ``openai``, ``anthropic``, ``deepseek``, ``google``, ``mistral``,
        ``ollama``, ``azure``.
    model : str | None
        Override the model ID.  When omitted the env-var default is used.
    temperature : float
        Sampling temperature (default 0 for deterministic agent behaviour).
    """
    provider = provider.strip().lower()
    llm = None

    # -- OpenAI -----------------------------------------------------------
    if provider == "openai":
        llm = ChatOpenAI(
            model=model or os.getenv("OPENAI_MODEL_ID", "gpt-4o"),
            temperature=temperature,
            api_key=os.getenv("OPENAI_API_KEY"),
            base_url=os.getenv("OPENAI_BASE_URL"),
        )

    # -- DeepSeek (OpenAI-compatible endpoint) ----------------------------
    elif provider == "deepseek":
        llm = ChatOpenAI(
            model=model or os.getenv("DEEPSEEK_MODEL_ID", "deepseek-chat"),
            temperature=temperature,
            api_key=os.getenv("DEEPSEEK_API_KEY"),
            base_url=os.getenv(
                "DEEPSEEK_ENDPOINT", "https://api.deepseek.com"
            ),
        )

    # -- Anthropic ---------------------------------------------------------
    elif provider == "anthropic":
        llm = ChatAnthropic(
            model=model or os.getenv("ANTHROPIC_MODEL_ID", "claude-sonnet-4-6"),
            temperature=temperature,
            api_key=os.getenv("ANTHROPIC_API_KEY"),
            base_url=os.getenv("ANTHROPIC_ENDPOINT"),
        )

    # -- Google Gemini -----------------------------------------------------
    elif provider == "google":
        llm = ChatGoogleGenerativeAI(
            model=model or os.getenv("GOOGLE_MODEL_ID", "gemini-2.0-flash"),
            temperature=temperature,
            google_api_key=os.getenv("GOOGLE_API_KEY"),
        )

    # -- Mistral -----------------------------------------------------------
    elif provider == "mistral":
        llm = ChatMistralAI(
            model=model or os.getenv("MISTRAL_MODEL_ID", "mistral-large-latest"),
            temperature=temperature,
            api_key=os.getenv("MISTRAL_API_KEY"),
            endpoint=os.getenv("MISTRAL_ENDPOINT"),
        )

    # -- Ollama (local) ----------------------------------------------------
    elif provider == "ollama":
        llm = ChatOllama(
            model=model or os.getenv("OLLAMA_MODEL_ID", "llama3"),
            temperature=temperature,
            base_url=os.getenv("OLLAMA_ENDPOINT", "http://localhost:11434"),
        )

    # -- Azure OpenAI ------------------------------------------------------
    elif provider == "azure":
        llm = AzureChatOpenAI(
            azure_deployment=model or os.getenv(
                "AZURE_OPENAI_DEPLOYMENT_NAME", ""
            ),
            openai_api_version=os.getenv(
                "AZURE_OPENAI_API_VERSION", "2025-01-01-preview"
            ),
            azure_endpoint=os.getenv("AZURE_OPENAI_ENDPOINT", ""),
            api_key=os.getenv("AZURE_OPENAI_API_KEY"),
            temperature=temperature,
        )

    else:
        raise ValueError(
            f"Unknown AI provider: {provider!r}. "
            f"Choose one of: openai, deepseek, anthropic, google, mistral, ollama, azure"
        )

    # browser-use Agent expects LLM instances to carry a .provider attribute
    # so it can auto-detect function-calling / tool support.
    if not hasattr(llm, "provider"):
        setattr(llm, "provider", provider)
    return llm
