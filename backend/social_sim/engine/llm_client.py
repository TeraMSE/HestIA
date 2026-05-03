"""LLM client supporting TokenFactory (OpenAI-compatible) and Ollama backends."""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from enum import Enum

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


@dataclass
class LLMConfig:
    backend: str
    ollama_model: str
    ollama_base_url: str
    tokenfactory_api_key: str
    tokenfactory_base_url: str
    tokenfactory_primary_model: str
    tokenfactory_fast_model: str
    tokenfactory_verify_ssl: bool

    @classmethod
    def from_env(cls) -> "LLMConfig":
        ollama_model = os.getenv("OLLAMA_MODEL", "llama3.2:3b")
        ollama_base_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
        tokenfactory_api_key = os.getenv("TOKENFACTORY_API_KEY", "").strip()
        tokenfactory_base_url = os.getenv(
            "TOKENFACTORY_BASE_URL", "https://tokenfactory.esprit.tn/api"
        ).strip()
        tokenfactory_primary_model = os.getenv(
            "TOKENFACTORY_PRIMARY_MODEL", "hosted_vllm/Llama-3.1-70B-Instruct"
        ).strip()
        tokenfactory_fast_model = os.getenv(
            "TOKENFACTORY_FAST_MODEL", "hosted_vllm/Llama-3.1-70B-Instruct"
        ).strip()
        tokenfactory_verify_ssl = (
            os.getenv("TOKENFACTORY_VERIFY_SSL", "false").strip().lower()
            in {"1", "true", "yes", "on"}
        )
        requested_backend = os.getenv("LLM_BACKEND", "").strip().lower()

        if requested_backend == LLMBackend.TOKENFACTORY.value:
            if tokenfactory_api_key:
                backend = LLMBackend.TOKENFACTORY.value
            else:
                logger.warning(
                    "LLM_BACKEND=tokenfactory but TOKENFACTORY_API_KEY is missing. Falling back to Ollama."
                )
                backend = LLMBackend.OLLAMA.value
        elif requested_backend == LLMBackend.OLLAMA.value:
            backend = LLMBackend.OLLAMA.value
        elif tokenfactory_api_key:
            backend = LLMBackend.TOKENFACTORY.value
            logger.info("TOKENFACTORY_API_KEY found — using TokenFactory backend.")
        else:
            backend = LLMBackend.OLLAMA.value
            logger.warning(
                "No TOKENFACTORY_API_KEY found. Falling back to local Ollama. "
                "Make sure Ollama is running with: ollama serve"
            )

        return cls(
            backend=backend,
            ollama_model=ollama_model,
            ollama_base_url=ollama_base_url,
            tokenfactory_api_key=tokenfactory_api_key,
            tokenfactory_base_url=tokenfactory_base_url,
            tokenfactory_primary_model=tokenfactory_primary_model,
            tokenfactory_fast_model=tokenfactory_fast_model,
            tokenfactory_verify_ssl=tokenfactory_verify_ssl,
        )


class OllamaLLMClient:
    """Unified LLM client for HestIA social simulation (TokenFactory or Ollama)."""

    def __init__(self) -> None:
        self.config = LLMConfig.from_env()
        logger.info(
            "OllamaLLMClient: backend=%s", self.config.backend
        )

    def complete(
        self,
        system_prompt: str,
        user_message: str,
        temperature: float = 0.7,
        use_fast_model: bool = False,
    ) -> str:
        try:
            if self.config.backend == LLMBackend.TOKENFACTORY.value:
                return self._complete_tokenfactory(
                    system_prompt=system_prompt,
                    user_message=user_message,
                    temperature=temperature,
                    use_fast_model=use_fast_model,
                )
            return self._complete_ollama(
                system_prompt=system_prompt,
                user_message=user_message,
                temperature=temperature,
            )
        except LLMCallError:
            raise
        except Exception as exc:
            logger.error("LLM completion failed: %s", exc)
            raise LLMCallError(f"LLM completion failed: {exc}") from exc

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

    def is_tokenfactory(self) -> bool:
        return self.config.backend == LLMBackend.TOKENFACTORY.value

    def get_backend_info(self) -> dict:
        if self.is_tokenfactory():
            primary = self.config.tokenfactory_primary_model
            fast = self.config.tokenfactory_fast_model
            note = (
                f"TokenFactory (OpenAI-compatible). "
                f"TLS verification={'enabled' if self.config.tokenfactory_verify_ssl else 'disabled'}."
            )
        else:
            primary = fast = self.config.ollama_model
            note = "Local Ollama — ensure 'ollama serve' is running."
        return {"backend": self.config.backend, "primary_model": primary, "fast_model": fast, "note": note}

    def _complete_tokenfactory(
        self,
        system_prompt: str,
        user_message: str,
        temperature: float,
        use_fast_model: bool,
    ) -> str:
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
                timeout=90,
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
        except requests.HTTPError as exc:
            logger.error("TokenFactory HTTP error: %s", exc)
            raise LLMCallError(f"TokenFactory HTTP error: {exc}") from exc
        except requests.RequestException as exc:
            logger.error("TokenFactory request failed: %s", exc)
            raise LLMCallError(f"TokenFactory request failed: {exc}") from exc

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
            logger.error("Ollama call failed: %s", exc)
            raise LLMCallError(f"Ollama call failed: {exc}") from exc

    def get_backend_info(self) -> dict:
        """Return metadata about the active LLM backend."""
        if self.config.backend == LLMBackend.TOKENFACTORY.value:
            return {
                "backend": "tokenfactory",
                "primary_model": self.config.tokenfactory_primary_model,
                "fast_model": self.config.tokenfactory_fast_model,
                "base_url": self.config.tokenfactory_base_url,
            }
        return {
            "backend": "ollama",
            "model": self.config.ollama_model,
            "base_url": self.config.ollama_base_url,
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


# Aliases for compatibility
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
