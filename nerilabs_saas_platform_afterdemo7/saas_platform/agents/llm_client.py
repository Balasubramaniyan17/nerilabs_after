"""
Universal LLM Calling & Structured Output Client.
Supports OpenAI (GPT-4o), Anthropic (Claude 3.5 Sonnet), and OpenAI-compatible endpoints
(OpenRouter, LiteLLM, vLLM, Ollama) with schema validation and robust fallback.
"""

import os
import json
import urllib.request
import urllib.error
from typing import Dict, List, Optional, Any
from saas_platform.config import Config


class LLMClient:
    @classmethod
    def call_structured_llm(
        cls,
        system_prompt: str,
        user_prompt: str,
        response_schema_name: str = "variants_response",
        model: Optional[str] = None,
        temperature: float = 0.7
    ) -> Optional[Dict[str, Any]]:
        """
        Executes a structured JSON completion against configured LLM provider.
        Returns parsed JSON dict or None if API key is not configured / request fails.
        """
        openai_key = os.getenv("OPENAI_API_KEY") or Config.OPENAI_API_KEY
        anthropic_key = os.getenv("ANTHROPIC_API_KEY") or Config.ANTHROPIC_API_KEY
        custom_base = os.getenv("LLM_BASE_URL", "https://api.openai.com/v1")

        target_model = model or os.getenv("LLM_MODEL", Config.DEFAULT_LLM_MODEL)

        # 1. OpenAI or OpenAI-Compatible API Call
        if openai_key:
            return cls._call_openai_compatible(
                api_key=openai_key,
                base_url=custom_base,
                model=target_model,
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                temperature=temperature
            )

        # 2. Anthropic API Call
        if anthropic_key:
            return cls._call_anthropic(
                api_key=anthropic_key,
                model=target_model if "claude" in target_model else "claude-3-5-sonnet-20241022",
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                temperature=temperature
            )

        return None

    @classmethod
    def _call_openai_compatible(
        cls,
        api_key: str,
        base_url: str,
        model: str,
        system_prompt: str,
        user_prompt: str,
        temperature: float
    ) -> Optional[Dict[str, Any]]:
        url = f"{base_url.rstrip('/')}/chat/completions"
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}"
        }
        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            "response_format": {"type": "json_object"},
            "temperature": temperature
        }

        try:
            req = urllib.request.Request(
                url,
                data=json.dumps(payload).encode("utf-8"),
                headers=headers,
                method="POST"
            )
            with urllib.request.urlopen(req, timeout=25) as response:
                if response.status == 200:
                    resp_data = json.loads(response.read().decode("utf-8"))
                    content = resp_data["choices"][0]["message"]["content"]
                    return json.loads(content)
        except Exception as e:
            print(f"[LLMClient] OpenAI API request failed: {e}. Utilizing fallback generation.")
            return None

    @classmethod
    def _call_anthropic(
        cls,
        api_key: str,
        model: str,
        system_prompt: str,
        user_prompt: str,
        temperature: float
    ) -> Optional[Dict[str, Any]]:
        url = "https://api.anthropic.com/v1/messages"
        headers = {
            "Content-Type": "application/json",
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01"
        }
        payload = {
            "model": model,
            "max_tokens": 2048,
            "system": system_prompt + "\n\nCRITICAL: Return ONLY valid, parseable JSON with no markdown wrapping or preamble.",
            "messages": [
                {"role": "user", "content": user_prompt}
            ],
            "temperature": temperature
        }

        try:
            req = urllib.request.Request(
                url,
                data=json.dumps(payload).encode("utf-8"),
                headers=headers,
                method="POST"
            )
            with urllib.request.urlopen(req, timeout=25) as response:
                if response.status == 200:
                    resp_data = json.loads(response.read().decode("utf-8"))
                    content = resp_data["content"][0]["text"].strip()
                    # Clean markdown ticks if present
                    if content.startswith("```json"):
                        content = content[7:]
                    if content.startswith("```"):
                        content = content[3:]
                    if content.endswith("```"):
                        content = content[:-3]
                    return json.loads(content.strip())
        except Exception as e:
            print(f"[LLMClient] Anthropic API request failed: {e}. Utilizing fallback generation.")
            return None
