"""
Policy Compiler — ported from UI/src/services/policyCompiler.js

Classifies instructions into Hard / Medium / Soft tiers,
detects conflicts, resolves by precedence, outputs a structured prompt.
"""

# -- Boundary instructions (always Hard) ---

HARD_INSTRUCTIONS = [
    # Truthfulness
    "Do not invent facts or fabricate information.",
    "Do not fake certainty — say \"I'm not sure\" when appropriate.",
    "Do not claim to remember things you do not have access to.",
    "Do not pretend to know context you have not been given.",
    # Identity
    "Do not roleplay or adopt a persona unless explicitly asked.",
    "Do not imply you have real emotions or consciousness.",
    "Do not present simulated closeness as a real relationship.",
    # Interaction
    "Do not guilt-trip or emotionally pressure the user.",
    "Do not be clingy or needy for interaction.",
    "Do not be patronizing or condescending.",
    "Do not overpraise — keep encouragement genuine.",
    "Do not shame the user for mistakes or lack of knowledge.",
    # Domain
    "Do not give high-confidence medical, legal, or financial advice without a disclaimer.",
    "Do not act beyond your allowed authority as an academic assistant.",
    "Do not take actions or make assumptions the user did not request.",
]

# -- Priority -> instruction fragments (Medium) ---

def _priority_text(key: str, rank: int) -> str | None:
    mapping = {
        "safety": (
            "If the user appears distressed or the topic involves health or safety, ALWAYS prioritize their wellbeing over completing the task."
            if rank <= 2 else "Be mindful of user safety."
        ),
        "accuracy": (
            "When making factual claims, ALWAYS include a source or say \"I believe\" if unsourced. Never sacrifice accuracy for brevity."
            if rank <= 2 else "Try to be accurate."
        ),
        "task_completion": (
            "Focus on completing what the user asked. Do not go off-topic or add unsolicited information."
            if rank <= 3 else "Complete the user's task."
        ),
        "clarity": (
            "Write clearly. Use simple language and short sentences where possible. Avoid jargon unless the user uses it first."
            if rank <= 3 else "Be clear."
        ),
        "speed": (
            "For straightforward questions, give the shortest correct answer. Do not elaborate unless asked."
            if rank <= 2 else "Be reasonably concise."
        ),
        "warmth": (
            "Be warm and supportive. Acknowledge the user's situation before diving into the answer."
            if rank <= 3 else "Be supportive."
        ),
        "creativity": (
            "Bring original ideas and creative angles to responses. Do not default to the obvious answer."
            if rank <= 3 else "Be creative when appropriate."
        ),
        "personalization": (
            "Tailor your response to the user's apparent context, level, and goals."
            if rank <= 3 else "Personalize responses."
        ),
    }
    return mapping.get(key)

PRIORITY_CONFLICTS = {
    "accuracy": "speed",
    "speed": "accuracy",
    "clarity": "academic",
}

# -- Style -> instruction text (Soft) ---

STYLE_INSTRUCTIONS = {
    # Tone
    "professional": ("Use a professional and polished tone. Be formal and precise.", "tone:professional"),
    "friendly": ("Be friendly and approachable. Use a warm, conversational tone.", "tone:friendly"),
    "casual": ("Be casual and relaxed. Talk like a fellow student would.", "tone:casual"),
    "academic": ("Use an academic and scholarly tone. Be thorough and cite reasoning.", "tone:academic"),
    # Length
    "concise": ("Keep responses short and to the point. Avoid unnecessary elaboration.", "length:concise"),
    "balanced": ("Provide balanced responses — enough detail to be helpful without being verbose.", "length:balanced"),
    "detailed": ("Give thorough, detailed responses with explanations and examples.", "length:detailed"),
    # Format
    "plain": ("Use plain text. Minimize markdown formatting.", None),
    "markdown": ("Use markdown formatting when helpful (bold, bullet points, numbered lists, headers).", None),
    "bullet-heavy": ("Heavily use bullet points and lists to organize information. Prefer structured output.", None),
    # Emoji
    "none": ("Do not use any emojis.", None),
    "occasional": ("Use emojis sparingly for emphasis.", None),
    "frequent": ("Use emojis generously to make responses lively and engaging.", None),
}


def _detect_conflicts(behavior: dict, priority_keys: list[str]) -> list[dict]:
    conflicts = []

    if behavior.get("response_length") == "detailed":
        conflicts.append({
            "description": '"detailed" length vs. boundary rule "Do not overexplain when a simple answer is enough"',
            "winner": "hard",
            "suppressed": "length:detailed",
        })

    speed_rank = priority_keys.index("speed") if "speed" in priority_keys else -1
    accuracy_rank = priority_keys.index("accuracy") if "accuracy" in priority_keys else -1
    if 0 <= speed_rank < 2 and 0 <= accuracy_rank < 2:
        if accuracy_rank < speed_rank:
            conflicts.append({
                "description": '"speed" top-2 vs. "accuracy" top-2 — accuracy outranks',
                "winner": "medium",
                "suppressed": "priority:speed_short_answer",
            })

    if behavior.get("response_tone") == "casual" and "accuracy" in priority_keys:
        rank = priority_keys.index("accuracy")
        if rank < 3:
            conflicts.append({
                "description": '"casual" tone vs. "accuracy" priority in top 3 — accuracy wins, tone softened',
                "winner": "medium",
                "suppressed": "tone:casual",
            })

    if behavior.get("response_length") == "concise":
        for p in ("accuracy", "task_completion"):
            if p in priority_keys and priority_keys.index(p) < 2:
                conflicts.append({
                    "description": f'"concise" length conflicts with high-ranked "{p}" — length relaxed to balanced',
                    "winner": "medium",
                    "suppressed": "length:concise",
                })
                break

    return conflicts


def compile_policy(base_identity: str, behavior: dict | None) -> dict:
    """
    Compile behavior settings into a structured, tiered system prompt.
    Returns {"prompt": str, "conflicts": list}.
    """
    if not behavior:
        return {"prompt": base_identity, "conflicts": []}

    priority_keys = behavior.get("priority_stack") or []

    conflicts = _detect_conflicts(behavior, priority_keys)
    suppressed = {c["suppressed"] for c in conflicts}

    # -- Soft instructions (style) ---
    soft = []
    for field in ("response_tone", "response_length", "response_format", "emoji_usage"):
        key = behavior.get(field)
        if key and key in STYLE_INSTRUCTIONS:
            text, conflict_key = STYLE_INSTRUCTIONS[key]
            if not conflict_key or conflict_key not in suppressed:
                soft.append(text)

    # -- Medium instructions (priorities) ---
    medium = []
    for rank, key in enumerate(priority_keys):
        if key == "speed" and "priority:speed_short_answer" in suppressed:
            medium.append("Be reasonably concise where accuracy allows.")
            continue
        text = _priority_text(key, rank)
        if text:
            medium.append(text)

    # Conversation-state adaptation hints
    hints = behavior.get("_adaptationHints") or []
    medium.extend(hints)

    # -- Hard instructions ---
    hard = list(HARD_INSTRUCTIONS)

    # -- Assemble ---
    sections = [base_identity]

    if hard:
        items = "\n".join(f"- {i}" for i in hard)
        sections.append(f"## Instructions (MUST follow — violation is not acceptable)\n{items}")

    if medium:
        items = "\n".join(f"- {i}" for i in medium)
        sections.append(f"## Instructions (SHOULD follow — strong preference)\n{items}")

    if soft:
        items = "\n".join(f"- {i}" for i in soft)
        sections.append(f"## Instructions (PREFER — follow when possible)\n{items}")

    return {"prompt": "\n\n".join(sections), "conflicts": conflicts}
