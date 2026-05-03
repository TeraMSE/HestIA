"""core.services — shared utilities for materiaux and appliances apps.

Re-exports the canonical TokenFactory helpers from social_sim.engine.llm_client
so cross-app imports don't reach into social_sim directly (avoids circular deps).
"""

from social_sim.engine.llm_client import (  # noqa: F401
    OllamaLLMClient,
    LLMCallError,
    call_tokenfactory_vision,
)


def call_tokenfactory(messages: list, temperature: float = 0.7, max_tokens: int = 1024) -> str:
    """Thin wrapper: send a pre-built messages list to TokenFactory.

    Unlike OllamaLLMClient.complete() which takes system+user strings, this
    accepts the raw OpenAI messages list format used by the ported agents.
    """
    import os
    import requests

    api_key = os.getenv("TOKENFACTORY_API_KEY", "").strip()
    base_url = os.getenv("TOKENFACTORY_BASE_URL", "https://tokenfactory.esprit.tn/api").strip()
    model = os.getenv("TOKENFACTORY_PRIMARY_MODEL", "hosted_vllm/Llama-3.1-70B-Instruct").strip()
    verify_ssl = os.getenv("TOKENFACTORY_VERIFY_SSL", "false").strip().lower() in {"1", "true", "yes", "on"}

    endpoint = f"{base_url.rstrip('/')}/chat/completions"
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    payload = {"model": model, "messages": messages, "temperature": temperature, "max_tokens": max_tokens}
    try:
        resp = requests.post(endpoint, headers=headers, json=payload, timeout=120, verify=verify_ssl)
        resp.raise_for_status()
        data = resp.json()
        choices = data.get("choices") or []
        if not choices:
            raise LLMCallError("TokenFactory response missing choices.")
        content = str((choices[0].get("message") or {}).get("content", "")).strip()
        if not content:
            raise LLMCallError("TokenFactory response content is empty.")
        return content
    except requests.HTTPError as exc:
        raise LLMCallError(f"TokenFactory HTTP error: {exc}") from exc
    except requests.RequestException as exc:
        raise LLMCallError(f"TokenFactory request failed: {exc}") from exc
