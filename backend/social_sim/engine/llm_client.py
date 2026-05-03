"""LLM client with automatic fallback chain: TokenFactory → Groq → Ollama."""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass, field
from enum import Enum
from typing import List

import requests
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)


class LLMCallError(Exception):
    pass


class StructuredOutputError(Exception):
    pass


class LLMBackend(str, Enum):
    OLLAMA = "ollama"
    TOKENFACTORY = "tokenfactory"
    GROQ = "groq"


@dataclass
class LLMConfig:
    # TokenFactory (primary)
    tokenfactory_api_key: str
    tokenfactory_base_url: str
    tokenfactory_primary_model: str
    tokenfactory_fast_model: str
    tokenfactory_verify_ssl: bool

    # Groq (first fallback)
    groq_api_key: str
    groq_base_url: str
    groq_model: str
    groq_fast_model: str

    # Ollama (last resort)
    ollama_model: str
    ollama_base_url: str

    # Ordered fallback chain
    provider_chain: List[str] = field(default_factory=list)

    @classmethod
    def from_env(cls) -> "LLMConfig":
        # TokenFactory
        tf_key = os.getenv("TOKENFACTORY_API_KEY", "").strip()
        tf_base = os.getenv("TOKENFACTORY_BASE_URL", "https://tokenfactory.esprit.tn/api").strip()
        tf_primary = os.getenv("TOKENFACTORY_PRIMARY_MODEL", "hosted_vllm/Llama-3.1-70B-Instruct").strip()
        tf_fast = os.getenv("TOKENFACTORY_FAST_MODEL", "hosted_vllm/Llama-3.1-70B-Instruct").strip()
        tf_verify_ssl = os.getenv("TOKENFACTORY_VERIFY_SSL", "false").strip().lower() in {"1", "true", "yes", "on"}

        # Groq
        groq_key = os.getenv("GROQ_API_KEY", "").strip()
        groq_base = os.getenv("GROQ_BASE_URL", "https://api.groq.com/openai/v1").strip()
        groq_model = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile").strip()
        groq_fast = os.getenv("GROQ_FAST_MODEL", "llama-3.1-8b-instant").strip()

        # Ollama
        ollama_model = os.getenv("OLLAMA_MODEL", "llama3.2:3b")
        ollama_base = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")

        # Build the provider chain based on what keys are available
        explicit_backend = os.getenv("LLM_BACKEND", "").strip().lower()
        chain: List[str] = []

        if explicit_backend == LLMBackend.OLLAMA.value:
            chain = [LLMBackend.OLLAMA.value]
        elif explicit_backend == LLMBackend.GROQ.value:
            chain = [LLMBackend.GROQ.value, LLMBackend.OLLAMA.value]
        elif explicit_backend == LLMBackend.TOKENFACTORY.value:
            chain = [LLMBackend.TOKENFACTORY.value]
            if groq_key:
                chain.append(LLMBackend.GROQ.value)
            chain.append(LLMBackend.OLLAMA.value)
        else:
            # Auto-detect: always try available providers in priority order
            if tf_key:
                chain.append(LLMBackend.TOKENFACTORY.value)
            if groq_key:
                chain.append(LLMBackend.GROQ.value)
            chain.append(LLMBackend.OLLAMA.value)

        if not chain:
            chain = [LLMBackend.OLLAMA.value]

        logger.info("LLM provider chain: %s", " → ".join(chain))

        return cls(
            tokenfactory_api_key=tf_key,
            tokenfactory_base_url=tf_base,
            tokenfactory_primary_model=tf_primary,
            tokenfactory_fast_model=tf_fast,
            tokenfactory_verify_ssl=tf_verify_ssl,
            groq_api_key=groq_key,
            groq_base_url=groq_base,
            groq_model=groq_model,
            groq_fast_model=groq_fast,
            ollama_model=ollama_model,
            ollama_base_url=ollama_base,
            provider_chain=chain,
        )


class OllamaLLMClient:
    """Unified LLM client: TokenFactory → Groq → Ollama fallback chain."""

    def __init__(self) -> None:
        self.config = LLMConfig.from_env()

    def complete(
        self,
        system_prompt: str,
        user_message: str,
        temperature: float = 0.7,
        use_fast_model: bool = False,
    ) -> str:
        last_error: Exception | None = None
        for provider in self.config.provider_chain:
            try:
                if provider == LLMBackend.TOKENFACTORY.value:
                    return self._complete_tokenfactory(system_prompt, user_message, temperature, use_fast_model)
                elif provider == LLMBackend.GROQ.value:
                    return self._complete_groq(system_prompt, user_message, temperature, use_fast_model)
                elif provider == LLMBackend.OLLAMA.value:
                    return self._complete_ollama(system_prompt, user_message, temperature)
            except LLMCallError as exc:
                logger.warning("Provider '%s' failed: %s — trying next.", provider, exc)
                last_error = exc
            except Exception as exc:
                logger.warning("Provider '%s' unexpected error: %s — trying next.", provider, exc)
                last_error = exc

        raise LLMCallError(
            f"All LLM providers exhausted. Last error: {last_error}"
        ) from last_error

    def complete_structured(
        self,
        system_prompt: str,
        user_message: str,
        output_schema: dict,
        use_fast_model: bool = False,
        temperature: float = 0.2,
    ) -> dict:
        schema_text = json.dumps(output_schema, indent=2)
        augmented = (
            f"{system_prompt}\n\n"
            "IMPORTANT: Respond ONLY with valid JSON matching this schema exactly. "
            "No explanation, no markdown, no code blocks:\n"
            f"{schema_text}"
        )
        raw = self.complete(augmented, user_message, temperature=temperature, use_fast_model=use_fast_model)
        cleaned = _strip_fences(raw)
        try:
            return json.loads(cleaned)
        except json.JSONDecodeError:
            retry = self.complete(augmented, user_message, temperature=0.1, use_fast_model=use_fast_model)
            cleaned2 = _strip_fences(retry)
            try:
                return json.loads(cleaned2)
            except json.JSONDecodeError as exc:
                raise StructuredOutputError("Failed to parse structured JSON from LLM.") from exc

    # ── Provider implementations ───────────────────────────────────────────────

    def _complete_tokenfactory(
        self,
        system_prompt: str,
        user_message: str,
        temperature: float,
        use_fast_model: bool,
    ) -> str:
        if not self.config.tokenfactory_api_key:
            raise LLMCallError("TokenFactory API key not configured.")
        model = (
            self.config.tokenfactory_fast_model
            if use_fast_model
            else self.config.tokenfactory_primary_model
        )
        endpoint = f"{self.config.tokenfactory_base_url.rstrip('/')}/chat/completions"
        headers = {
            "Authorization": f"Bearer {self.config.tokenfactory_api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message},
            ],
            "temperature": temperature,
            "max_tokens": 1024,
        }
        try:
            resp = requests.post(
                endpoint,
                headers=headers,
                json=payload,
                timeout=30,  # Reduced from 90s — fail fast so Groq fallback kicks in
                verify=self.config.tokenfactory_verify_ssl,
            )
            resp.raise_for_status()
            data = resp.json()
            choices = data.get("choices") or []
            if not choices:
                raise LLMCallError("TokenFactory response did not include choices.")
            content = str((choices[0].get("message") or {}).get("content", "")).strip()
            if not content:
                raise LLMCallError("TokenFactory response content is empty.")
            return content
        except requests.Timeout as exc:
            raise LLMCallError(f"TokenFactory timed out: {exc}") from exc
        except requests.HTTPError as exc:
            raise LLMCallError(f"TokenFactory HTTP error: {exc}") from exc
        except requests.RequestException as exc:
            raise LLMCallError(f"TokenFactory request failed: {exc}") from exc

    def _complete_groq(
        self,
        system_prompt: str,
        user_message: str,
        temperature: float,
        use_fast_model: bool,
    ) -> str:
        if not self.config.groq_api_key:
            raise LLMCallError("Groq API key not configured.")
        model = self.config.groq_fast_model if use_fast_model else self.config.groq_model
        endpoint = f"{self.config.groq_base_url.rstrip('/')}/chat/completions"
        headers = {
            "Authorization": f"Bearer {self.config.groq_api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message},
            ],
            "temperature": temperature,
            "max_tokens": 1024,
        }
        try:
            resp = requests.post(endpoint, headers=headers, json=payload, timeout=45)
            resp.raise_for_status()
            data = resp.json()
            choices = data.get("choices") or []
            if not choices:
                raise LLMCallError("Groq response did not include choices.")
            content = str((choices[0].get("message") or {}).get("content", "")).strip()
            if not content:
                raise LLMCallError("Groq response content is empty.")
            return content
        except requests.Timeout as exc:
            raise LLMCallError(f"Groq timed out: {exc}") from exc
        except requests.HTTPError as exc:
            # Groq rate-limit (429) — propagate so next provider is tried
            raise LLMCallError(f"Groq HTTP error: {exc}") from exc
        except requests.RequestException as exc:
            raise LLMCallError(f"Groq request failed: {exc}") from exc

    def _complete_ollama(
        self,
        system_prompt: str,
        user_message: str,
        temperature: float,
    ) -> str:
        payload = {
            "model": self.config.ollama_model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message},
            ],
            "stream": False,
            "options": {"temperature": temperature},
        }
        try:
            resp = requests.post(
                f"{self.config.ollama_base_url}/api/chat", json=payload, timeout=120
            )
            resp.raise_for_status()
            data = resp.json()
            return (data.get("message", {}).get("content") or "").strip()
        except Exception as exc:
            raise LLMCallError(f"Ollama call failed: {exc}") from exc

    # ── Info helpers ───────────────────────────────────────────────────────────

    def is_tokenfactory(self) -> bool:
        return self.config.provider_chain[0] == LLMBackend.TOKENFACTORY.value if self.config.provider_chain else False

    def get_backend_info(self) -> dict:
        primary = self.config.provider_chain[0] if self.config.provider_chain else "ollama"
        model_map = {
            LLMBackend.TOKENFACTORY.value: self.config.tokenfactory_primary_model,
            LLMBackend.GROQ.value: self.config.groq_model,
            LLMBackend.OLLAMA.value: self.config.ollama_model,
        }
        return {
            "backend": primary,
            "provider_chain": self.config.provider_chain,
            "primary_model": model_map.get(primary, "unknown"),
        }


def _strip_fences(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    return text


# Aliases for compatibility with existing imports
UnifiedLLMClient = OllamaLLMClient
LLMClient = OllamaLLMClient


def call_tokenfactory_vision(
    image_bytes: bytes,
    prompt: str,
    temperature: float = 0.1,
    max_tokens: int = 1400,
) -> str:
    """Send a vision request to TokenFactory using the OpenAI image_url format.

    This is a module-level helper so ``materiaux`` and ``appliances`` apps
    can import it directly without instantiating OllamaLLMClient.
    """
    import base64

    cfg = LLMConfig.from_env()
    if cfg.backend != LLMBackend.TOKENFACTORY.value:
        raise LLMCallError(
            "call_tokenfactory_vision requires TokenFactory backend. "
            "Set TOKENFACTORY_API_KEY in your .env."
        )
    image_b64 = base64.b64encode(image_bytes).decode()
    endpoint = f"{cfg.tokenfactory_base_url.rstrip('/')}/chat/completions"
    headers = {
        "Authorization": f"Bearer {cfg.tokenfactory_api_key}",
        "Content-Type": "application/json",
    }
    import os
    vision_model = os.getenv("TOKENFACTORY_VISION_MODEL", "hosted_vllm/llava-1.5-7b-hf").strip()

    payload = {
        "model": vision_model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/jpeg;base64,{image_b64}"},
                    },
                    {"type": "text", "text": prompt},
                ],
            }
        ],
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    try:
        resp = requests.post(
            endpoint,
            headers=headers,
            json=payload,
            timeout=120,
            verify=cfg.tokenfactory_verify_ssl,
        )
        resp.raise_for_status()
        data = resp.json()
        choices = data.get("choices") or []
        if not choices:
            raise LLMCallError("TokenFactory vision response missing choices.")
        content = str((choices[0].get("message") or {}).get("content", "")).strip()
        if not content:
            raise LLMCallError("TokenFactory vision response content is empty.")
        return content
    except requests.HTTPError as exc:
        logger.error("TokenFactory vision HTTP error: %s", exc)
        raise LLMCallError(f"TokenFactory vision HTTP error: {exc}") from exc
    except requests.RequestException as exc:
        logger.error("TokenFactory vision request failed: %s", exc)
        raise LLMCallError(f"TokenFactory vision request failed: {exc}") from exc
