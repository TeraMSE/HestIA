"""
Unified LLM client — adapted from Domus AI for HestIA backend.
Reads from environment variables set in .env (or Django settings).
Supports: TokenFactory, Groq, Ollama.
"""

from __future__ import annotations

import json
import logging
import os
import time
from typing import Any

import requests

logger = logging.getLogger(__name__)


class LLMCallError(Exception):
    pass


class StructuredOutputError(Exception):
    pass


class UnifiedLLMClient:
    """Single LLM interface for the personality builder."""

    def __init__(self) -> None:
        self.backend = os.getenv("LLM_BACKEND", "ollama").strip().lower()
        self.groq_api_key = os.getenv("GROQ_API_KEY", "").strip()
        self.groq_primary_model = os.getenv("GROQ_PRIMARY_MODEL", "llama-3.3-70b-versatile")
        self.groq_fast_model = os.getenv("GROQ_FAST_MODEL", "llama-3.1-8b-instant")
        self.ollama_model = os.getenv("OLLAMA_MODEL", "llama3.2:3b")
        self.ollama_base_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
        self.tokenfactory_api_key = os.getenv("TOKENFACTORY_API_KEY", "").strip()
        self.tokenfactory_base_url = os.getenv(
            "TOKENFACTORY_BASE_URL", "https://tokenfactory.esprit.tn/api"
        ).strip()
        self.tokenfactory_primary_model = os.getenv(
            "TOKENFACTORY_PRIMARY_MODEL", "hosted_vllm/Llama-3.1-70B-Instruct"
        ).strip()
        self.tokenfactory_fast_model = os.getenv(
            "TOKENFACTORY_FAST_MODEL", "hosted_vllm/Llama-3.1-70B-Instruct"
        ).strip()
        self.tokenfactory_verify_ssl = os.getenv(
            "TOKENFACTORY_VERIFY_SSL", "false"
        ).strip().lower() in {"1", "true", "yes", "on"}

        # Resolve effective backend
        if self.backend == "tokenfactory":
            if not self.tokenfactory_api_key:
                logger.warning("LLM_BACKEND=tokenfactory but TOKENFACTORY_API_KEY missing. Falling back to Ollama.")
                self.backend = "ollama"
        elif self.backend == "groq":
            if not self.groq_api_key:
                logger.warning("LLM_BACKEND=groq but GROQ_API_KEY missing. Falling back to Ollama.")
                self.backend = "ollama"
        else:
            # Auto-detect
            if self.tokenfactory_api_key:
                self.backend = "tokenfactory"
            elif self.groq_api_key:
                self.backend = "groq"
            else:
                self.backend = "ollama"

        self._groq_client = None
        self._ollama_client = None
        if self.backend == "groq":
            from groq import Groq
            self._groq_client = Groq(api_key=self.groq_api_key)

        logger.info("UnifiedLLMClient initialized with backend=%s", self.backend)

    # ── Public API ────────────────────────────────────────────────────────────

    def complete(
        self,
        system_prompt: str,
        user_message: str,
        temperature: float = 0.7,
        use_fast_model: bool = False,
    ) -> str:
        try:
            if self.backend == "groq":
                return self._complete_groq(system_prompt, user_message, temperature, use_fast_model)
            if self.backend == "tokenfactory":
                return self._complete_tokenfactory(system_prompt, user_message, temperature, use_fast_model)
            return self._complete_ollama(system_prompt, user_message, temperature)
        except LLMCallError:
            raise
        except Exception as exc:
            logger.error("LLM completion failed: %s", exc, exc_info=True)
            raise LLMCallError(f"LLM completion failed: {exc}") from exc

    def complete_structured(
        self,
        system_prompt: str,
        user_message: str,
        output_schema: dict,
        use_fast_model: bool = False,
        temperature: float = 0.2,
    ) -> dict:
        schema_text = json.dumps(
            output_schema, indent=2,
            default=lambda v: getattr(v, "__name__", str(v)),
        )
        augmented = (
            f"{system_prompt}\n\n"
            "IMPORTANT: Respond ONLY with valid JSON that strictly matches this schema. "
            "No explanation, no markdown, no code blocks:\n"
            f"{schema_text}"
        )
        raw = self.complete(augmented, user_message, temperature=temperature, use_fast_model=use_fast_model)
        cleaned = self._strip_markdown_fences(raw)
        try:
            return json.loads(cleaned)
        except json.JSONDecodeError:
            retry_raw = self.complete(augmented, user_message, temperature=0.1, use_fast_model=use_fast_model)
            retry_cleaned = self._strip_markdown_fences(retry_raw)
            try:
                return json.loads(retry_cleaned)
            except json.JSONDecodeError as exc:
                err = StructuredOutputError("Failed to parse structured JSON response from LLM.")
                err.raw_response = retry_raw  # type: ignore[attr-defined]
                raise err from exc

    def get_backend_info(self) -> dict:
        return {"backend": self.backend, "primary_model": self.tokenfactory_primary_model if self.backend == "tokenfactory" else self.groq_primary_model if self.backend == "groq" else self.ollama_model}

    # ── Private helpers ────────────────────────────────────────────────────────

    def _complete_groq(self, system_prompt: str, user_message: str, temperature: float, use_fast_model: bool) -> str:
        model = self.groq_fast_model if use_fast_model else self.groq_primary_model
        try:
            response = self._groq_client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_message},
                ],
                temperature=temperature,
                max_tokens=1024,
            )
            return (response.choices[0].message.content or "").strip()
        except Exception as exc:
            raise LLMCallError(f"Groq request failed: {exc}") from exc

    def _complete_ollama(self, system_prompt: str, user_message: str, temperature: float) -> str:
        if self._ollama_client is None:
            import ollama
            self._ollama_client = ollama
        try:
            response = self._ollama_client.chat(
                model=self.ollama_model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_message},
                ],
                options={"temperature": temperature},
            )
            return (response["message"]["content"] or "").strip()
        except Exception as exc:
            raise LLMCallError(f"Ollama request failed: {exc}") from exc

    def _complete_tokenfactory(self, system_prompt: str, user_message: str, temperature: float, use_fast_model: bool) -> str:
        model = self.tokenfactory_fast_model if use_fast_model else self.tokenfactory_primary_model
        endpoint = f"{self.tokenfactory_base_url.rstrip('/')}/chat/completions"
        headers = {
            "Authorization": f"Bearer {self.tokenfactory_api_key}",
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
            response = requests.post(
                endpoint, headers=headers, json=payload,
                timeout=90, verify=self.tokenfactory_verify_ssl,
            )
            response.raise_for_status()
            data = response.json()
            choices = data.get("choices") or []
            if not choices:
                raise LLMCallError("TokenFactory response did not include choices.")
            content = str((choices[0].get("message") or {}).get("content", "")).strip()
            if not content:
                raise LLMCallError("TokenFactory response content is empty.")
            return content
        except requests.HTTPError as exc:
            raise LLMCallError(f"TokenFactory HTTP error: {exc}") from exc
        except requests.RequestException as exc:
            raise LLMCallError(f"TokenFactory request failed: {exc}") from exc

    @staticmethod
    def _strip_markdown_fences(text: str) -> str:
        cleaned = text.strip()
        if cleaned.startswith("```"):
            lines = cleaned.splitlines()
            if lines and lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].strip() == "```":
                lines = lines[:-1]
            cleaned = "\n".join(lines).strip()
        return cleaned
