"""
LLM service — handles Groq API calls (streaming and non-streaming).
Ported from UI/src/services/llamaService.js
"""
import os
import json
from collections.abc import AsyncGenerator

import httpx

from services.policy_compiler import compile_policy
from services.validator import run_validators

GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"

MODELS = {
    "8b": "llama-3.3-70b-versatile",
    "70b": "llama-3.3-70b-versatile",
}

BASE_SYSTEM_PROMPT = (
    "You are SJSU Copilot, a helpful AI assistant for San Jose State University students. "
    "You help with questions about academics, campus life, degree requirements, registration, internships, and more. "
    "If you don't know something specific to SJSU, say so honestly rather than making things up."
)


def _get_api_key() -> str:
    key = os.getenv("GROQ_API_KEY")
    if not key:
        raise ValueError("GROQ_API_KEY is not set")
    return key


def _resolve_params(behavior: dict | None) -> dict:
    """Map behavior settings to LLM generation parameters."""
    temperature = 0.7
    max_tokens = 2048

    if not behavior:
        return {"temperature": temperature, "max_tokens": max_tokens}

    length = behavior.get("response_length")
    if length == "concise":
        max_tokens = 512
        temperature = 0.5
    elif length == "detailed":
        max_tokens = 4096

    stack = behavior.get("priority_stack") or []

    creativity_idx = stack.index("creativity") if "creativity" in stack else -1
    if 0 <= creativity_idx < 3:
        temperature += 0.15

    accuracy_idx = stack.index("accuracy") if "accuracy" in stack else -1
    if 0 <= accuracy_idx < 2:
        temperature -= 0.1

    speed_idx = stack.index("speed") if "speed" in stack else -1
    if 0 <= speed_idx < 2:
        max_tokens = int(max_tokens * 0.6)

    return {
        "temperature": max(0.3, min(1.0, temperature)),
        "max_tokens": max_tokens,
    }


def _build_system_prompt(behavior: dict | None, memory_prompt: str | None, rag_prompt: str | None) -> str:
    result = compile_policy(BASE_SYSTEM_PROMPT, behavior)
    system = result["prompt"]
    if memory_prompt:
        system = memory_prompt + "\n\n" + system
    if rag_prompt:
        system = system + "\n\n" + rag_prompt
    return system


async def _repair_response(repair_prompt: str, model_id: str) -> str | None:
    """Non-streaming repair call for Level 1 validator rewrites."""
    api_key = _get_api_key()
    async with httpx.AsyncClient(timeout=30) as client:
        res = await client.post(
            GROQ_API_URL,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
            },
            json={
                "model": model_id,
                "messages": [
                    {"role": "system", "content": "You are a response editor. Follow the instruction exactly and return only the rewritten text."},
                    {"role": "user", "content": repair_prompt},
                ],
                "stream": False,
                "temperature": 0.3,
                "max_tokens": 512,
            },
        )
        if res.status_code != 200:
            return None
        data = res.json()
        return (data.get("choices") or [{}])[0].get("message", {}).get("content", "").strip() or None


async def stream_chat(
    messages: list[dict],
    model: str = "8b",
    behavior: dict | None = None,
    memory_prompt: str | None = None,
    rag_prompt: str | None = None,
    sources: list[dict] | None = None,
) -> AsyncGenerator[str, None]:
    """
    Stream chat completion from Groq. Yields SSE-formatted lines:
      data: {"token": "..."}       — for each text chunk
      data: {"done": true, ...}    — final message with validator metadata

    Uses Groq for completion with behavior policy, optional memory, and optional RAG context.
    """
    api_key = _get_api_key()
    model_id = MODELS.get(model, MODELS["8b"])
    params = _resolve_params(behavior)

    system_prompt = _build_system_prompt(behavior, memory_prompt, rag_prompt)

    body = {
        "model": model_id,
        "messages": [{"role": "system", "content": system_prompt}, *messages],
        "stream": True,
        **params,
    }

    full_response = ""

    async with httpx.AsyncClient(timeout=120) as client:
        async with client.stream(
            "POST",
            GROQ_API_URL,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
            },
            json=body,
        ) as res:
            if res.status_code != 200:
                error_body = await res.aread()
                yield f"data: {json.dumps({'error': f'Groq API error ({res.status_code}): {error_body.decode()}'})}\n\n"
                return

            buffer = ""
            async for chunk in res.aiter_text():
                buffer += chunk
                lines = buffer.split("\n")
                buffer = lines.pop()

                for line in lines:
                    trimmed = line.strip()
                    if not trimmed or not trimmed.startswith("data: "):
                        continue
                    data = trimmed[6:]
                    if data == "[DONE]":
                        continue
                    try:
                        parsed = json.loads(data)
                        content = (parsed.get("choices") or [{}])[0].get("delta", {}).get("content")
                        if content:
                            full_response += content
                            yield f"data: {json.dumps({'token': content})}\n\n"
                    except json.JSONDecodeError:
                        continue

    # -- Post-generation validation ---
    validator_meta = {
        "validators_run": [],
        "validators_passed": True,
        "repairs_applied": [],
    }

    if behavior and full_response:
        result = run_validators(full_response, behavior)
        validator_meta["validators_run"] = [v["rule"] for v in result["violations"]]
        validator_meta["validators_passed"] = result["action"] is None

        if result["action"] == "rewrite" and result["repair_prompt"]:
            try:
                repaired = await _repair_response(result["repair_prompt"], model_id)
                if repaired:
                    full_response = repaired
                    validator_meta["repairs_applied"] = ["rewrite"]
                    yield f"data: {json.dumps({'replace': repaired})}\n\n"
            except Exception:
                pass
        elif result["action"] == "warn" and result["warning_text"]:
            full_response += result["warning_text"]
            validator_meta["repairs_applied"] = [
                v["rule"] for v in result["violations"] if v.get("severity") == "medium"
            ]
            yield f"data: {json.dumps({'replace': full_response})}\n\n"

    # Final done event
    done_payload = {"done": True, "full_response": full_response, **validator_meta}
    if sources:
        done_payload["sources"] = sources
    yield f"data: {json.dumps(done_payload)}\n\n"


async def generate_title(user_message: str) -> str | None:
    """Generate a short chat title from the first user message."""
    api_key = _get_api_key()
    async with httpx.AsyncClient(timeout=15) as client:
        res = await client.post(
            GROQ_API_URL,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
            },
            json={
                "model": MODELS["8b"],
                "messages": [
                    {
                        "role": "system",
                        "content": (
                            "Generate a short chat title (3-6 words, no quotes, no punctuation at the end) "
                            "that summarizes the user's message. Reply with ONLY the title, nothing else."
                        ),
                    },
                    {"role": "user", "content": user_message},
                ],
                "stream": False,
                "temperature": 0.4,
                "max_tokens": 30,
            },
        )
        if res.status_code != 200:
            return None
        data = res.json()
        title = (data.get("choices") or [{}])[0].get("message", {}).get("content", "").strip()
        return title or None
