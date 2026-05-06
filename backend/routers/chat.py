from pydantic import BaseModel
from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from services.llm import stream_chat, generate_title
from services.web_search import build_rag_prompt
from services.conversation_state import (
    analyze_conversation_state,
    generate_default_behavior,
    merge_behavior,
    adapt_behavior,
)

router = APIRouter(tags=["chat"])


class Message(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: list[Message]
    model: str = "8b"
    behavior: dict | None = None
    memory_prompt: str | None = None


class AutoBehaviorRequest(BaseModel):
    messages: list[Message]


class TitleRequest(BaseModel):
    message: str


@router.post("/chat")
async def chat(req: ChatRequest):
    messages = [m.model_dump() for m in req.messages]

    # 1. Analyze conversation state
    state = analyze_conversation_state(messages)

    # 2. Auto-detect baseline behavior
    auto_behavior = generate_default_behavior(state)

    # 3. Merge manual overrides (if any) on top of auto
    behavior = merge_behavior(auto_behavior, req.behavior)

    # 4. Adapt to conversation context
    behavior = adapt_behavior(behavior, state)

    last_user_message = next(
        (m.get("content", "") for m in reversed(messages) if m.get("role") == "user"),
        "",
    )

    rag_prompt, sources = await build_rag_prompt(last_user_message)

    return StreamingResponse(
        stream_chat(
            messages=messages,
            model=req.model,
            behavior=behavior,
            memory_prompt=req.memory_prompt,
            rag_prompt=rag_prompt,
            sources=sources,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/auto-behavior")
async def auto_behavior(req: AutoBehaviorRequest):
    """Return what the backend auto-detected for this conversation."""
    messages = [m.model_dump() for m in req.messages]
    state = analyze_conversation_state(messages)
    behavior = generate_default_behavior(state)
    return {
        "behavior": behavior,
        "state": state,
    }


@router.post("/generate-title")
async def title(req: TitleRequest):
    result = await generate_title(req.message)
    return {"title": result}
