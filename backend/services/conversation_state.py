"""
Conversation-Aware Adaptation — ported from UI/src/services/conversationStateService.js

Analyzes conversation history to extract state signals, then adapts
behavior settings before they enter the policy compiler.
"""
import re

SENSITIVITY_PATTERN = re.compile(
    r"\b(health|medical|mental health|depression|anxiety|suicide|self.?harm|legal|lawsuit|"
    r"financial|invest(?:ing|ment)?|debt|bankruptcy|death|dying|terminal|diagnosis|medication)\b",
    re.IGNORECASE,
)

URGENCY_PATTERN = re.compile(
    r"\b(asap|urgent(?:ly)?|quick(?:ly)?|due (today|tomorrow|tonight|this week|by \w+)|"
    r"deadline|emergency|right now|need (?:this |it )?now|time.?sensitive|running out of time|"
    r"in a hurry|short on time)\b",
    re.IGNORECASE,
)

DISTRESS_PATTERN = re.compile(
    r"\b(stressed|overwhelmed|anxious|panic(?:king)?|scared|terrified|hopeless|desperate|"
    r"crying|depressed|exhausted|can'?t (?:do|take|handle) (?:this|it)|falling behind|"
    r"failing|failing out|freaking out|burned? out|losing (?:my )?mind|don'?t know what to do)\b",
    re.IGNORECASE,
)

REVIEW_PATTERN = re.compile(
    r"\b(review|check|look over|proofread|edit|revise|feedback|critique|evaluate|assess)\b|"
    r"is this (good|right|correct|okay)\??|does this (look|sound|make sense)\??",
    re.IGNORECASE,
)

QUESTION_PATTERN = re.compile(
    r"\?|^(what|who|where|when|why|how|can|could|would|should|is|are|do|does|did|will)\b",
    re.IGNORECASE,
)

TECHNICAL_PATTERN = re.compile(
    r"\b(algorithm|complexity|asymptotics?|recursion|pointer|heap|stack|runtime|compiler|"
    r"parser|polymorphism|inheritance|encapsulation|abstraction|differential|integral|"
    r"derivative|matrix|eigenvalue|regression|correlation|hypothesis|methodology|dissertation|"
    r"thesis|citation|bibliography|api|rest|json|http|oauth|jwt|sql|nosql|concurrency|"
    r"parallelism|kernel|semaphore|mutex|deadlock|refactor|scaffold|prototype)\b",
    re.IGNORECASE,
)

# -- New patterns for auto-detect (Phase 1) ---

FORMAT_LIST_PATTERN = re.compile(
    r"\b(list|steps|compare|pros and cons|overview|summary|breakdown|checklist|"
    r"differences? between|versus|vs\.?|what are the|give me .* options|"
    r"rank|top \d+|advantages|disadvantages)\b",
    re.IGNORECASE,
)

BRIEF_ANSWER_PATTERN = re.compile(
    r"\b(in (one|a) (sentence|word|line)|briefly|tldr|tl;dr|short answer|"
    r"quick question|yes or no|just tell me|simple answer|one.?liner)\b",
    re.IGNORECASE,
)

FORMAL_TONE_PATTERN = re.compile(
    r"\b(furthermore|moreover|consequently|therefore|thus|hence|whereas|"
    r"nevertheless|notwithstanding|pursuant|herein|aforementioned|"
    r"I would like to inquire|could you please elaborate|"
    r"I would appreciate|respectfully|regarding the matter)\b",
    re.IGNORECASE,
)

# Emoji detection — common Unicode emoji ranges
EMOJI_PATTERN = re.compile(
    "["
    "\U0001F600-\U0001F64F"  # emoticons
    "\U0001F300-\U0001F5FF"  # symbols & pictographs
    "\U0001F680-\U0001F6FF"  # transport & map
    "\U0001F1E0-\U0001F1FF"  # flags
    "\U00002702-\U000027B0"  # dingbats
    "\U0001F900-\U0001F9FF"  # supplemental symbols
    "\U0001FA00-\U0001FA6F"  # chess symbols
    "\U0001FA70-\U0001FAFF"  # symbols extended-A
    "\U00002600-\U000026FF"  # misc symbols
    "]"
)


def analyze_conversation_state(messages: list[dict]) -> dict:
    """Extract state signals from conversation history."""
    user_messages = [m for m in messages if m.get("role") == "user"]
    turn_count = len(user_messages)
    last_user = user_messages[-1].get("content", "") if user_messages else ""

    phase = "opening" if turn_count <= 2 else ("mid" if turn_count <= 8 else "deep")

    if REVIEW_PATTERN.search(last_user):
        task_phase = "reviewing"
    elif QUESTION_PATTERN.search(last_user):
        task_phase = "asking"
    else:
        task_phase = "doing"

    sensitivity = "high" if SENSITIVITY_PATTERN.search(last_user) else "normal"
    urgency = "high" if URGENCY_PATTERN.search(last_user) else "normal"
    emotional_tone = "distressed" if DISTRESS_PATTERN.search(last_user) else "neutral"

    all_user_text = " ".join(m.get("content", "") for m in user_messages)
    has_technical = bool(TECHNICAL_PATTERN.search(all_user_text))
    words = all_user_text.strip().split()
    avg_word_len = sum(len(w) for w in words) / len(words) if words else 0

    if has_technical or avg_word_len > 6.5:
        expertise = "expert"
    elif avg_word_len < 4.5 and turn_count >= 2:
        expertise = "beginner"
    else:
        expertise = "unknown"

    # Format hint — detect if user is asking for structured output
    if BRIEF_ANSWER_PATTERN.search(last_user):
        format_hint = "plain"
    elif FORMAT_LIST_PATTERN.search(last_user):
        format_hint = "bullet-heavy"
    else:
        format_hint = "markdown"

    # Emoji mirror — detect if user uses emojis
    user_emoji_count = len(EMOJI_PATTERN.findall(all_user_text))
    if user_emoji_count >= 3:
        emoji_mirror = "frequent"
    elif user_emoji_count >= 1:
        emoji_mirror = "occasional"
    else:
        emoji_mirror = "none"

    # Tone formality — detect formal/academic phrasing
    has_formal = bool(FORMAL_TONE_PATTERN.search(all_user_text))
    if has_formal:
        tone_formality = "formal"
    elif has_technical:
        tone_formality = "technical"
    else:
        tone_formality = "casual"

    return {
        "phase": phase,
        "task_phase": task_phase,
        "sensitivity": sensitivity,
        "expertise": expertise,
        "emotional_tone": emotional_tone,
        "urgency": urgency,
        "format_hint": format_hint,
        "emoji_mirror": emoji_mirror,
        "tone_formality": tone_formality,
    }


BEHAVIOR_FIELDS = ("response_tone", "response_length", "response_format", "emoji_usage", "priority_stack")


def merge_behavior(auto: dict, manual: dict | None) -> dict:
    """
    Merge manual overrides on top of auto-detected behavior.

    Only non-null fields from manual replace auto-detected values.
    Tracks which fields were manually set via `_has_manual_overrides`
    and `_manual_fields` so adapt_behavior() can respect them.
    """
    if not manual:
        return auto

    merged = {**auto}
    manual_fields = set()

    for field in BEHAVIOR_FIELDS:
        if manual.get(field) is not None:
            merged[field] = manual[field]
            manual_fields.add(field)

    if manual_fields:
        merged["_has_manual_overrides"] = True
        merged["_manual_fields"] = manual_fields

    return merged


DEFAULT_PRIORITY_STACK = [
    "safety",
    "accuracy",
    "task_completion",
    "clarity",
    "speed",
    "warmth",
    "creativity",
    "personalization",
]


def generate_default_behavior(state: dict) -> dict:
    """
    Generate a full behavior dict from conversation state signals alone.
    This is the auto-detect baseline — no user input needed.
    """

    # -- Tone ---
    if state["emotional_tone"] == "distressed":
        tone = "friendly"
    elif state["tone_formality"] == "formal":
        tone = "academic"
    elif state["tone_formality"] == "technical" and state["expertise"] == "expert":
        tone = "professional"
    else:
        tone = "friendly"

    # -- Length ---
    if state["urgency"] == "high":
        length = "concise"
    elif state["phase"] == "deep":
        length = "concise"
    elif state["task_phase"] == "reviewing":
        length = "concise"
    elif state["task_phase"] == "asking" and state["phase"] != "deep":
        length = "detailed"
    else:
        length = "balanced"

    # -- Format ---
    fmt = state["format_hint"]  # plain, bullet-heavy, or markdown

    # -- Emoji ---
    if state["expertise"] == "expert" or tone in ("academic", "professional"):
        emoji = "none"
    elif state["emotional_tone"] == "distressed":
        emoji = "none"
    elif state["emoji_mirror"] != "none":
        emoji = state["emoji_mirror"]
    else:
        emoji = "occasional"

    # -- Priority stack ---
    stack = list(DEFAULT_PRIORITY_STACK)
    if state["urgency"] == "high":
        stack.remove("speed")
        stack.insert(1, "speed")  # promote speed to #2
    if state["task_phase"] == "asking":
        if "clarity" in stack:
            stack.remove("clarity")
            idx = stack.index("task_completion") if "task_completion" in stack else 2
            stack.insert(idx, "clarity")  # clarity before task_completion

    return {
        "response_tone": tone,
        "response_length": length,
        "response_format": fmt,
        "emoji_usage": emoji,
        "priority_stack": stack,
    }


def adapt_behavior(base_behavior: dict | None, state: dict) -> dict | None:
    """
    Return a new behavior dict adapted to the conversation state.

    Works with both auto-generated and user-provided behavior.
    When behavior is auto-generated, length/tone are already set from state,
    so this function focuses on contextual hints and priority reordering.
    When behavior includes manual overrides, length/tone adaptations only
    apply if the user hasn't explicitly set them.
    """
    if not base_behavior:
        return base_behavior

    adapted = {**base_behavior}
    adapted["priority_stack"] = list(adapted.get("priority_stack") or [])
    is_manual = base_behavior.get("_has_manual_overrides", False)
    hints = []

    # 1. Response length — only override if user hasn't manually set it
    if not (is_manual and "response_length" in base_behavior.get("_manual_fields", set())):
        if state["urgency"] == "high":
            adapted["response_length"] = "concise"
            hints.append("The user is in a hurry. Be brief and direct — give the answer first, skip preamble.")
        elif state["phase"] == "deep" and adapted.get("response_length") != "concise":
            adapted["response_length"] = "concise"
            hints.append("This is a deep conversation. The user has context; skip re-explaining background. Be concise.")
        elif state["task_phase"] == "reviewing":
            adapted["response_length"] = "concise"
            hints.append("The user wants a review. Give direct, actionable feedback without lengthy preamble.")
        elif (
            state["task_phase"] == "asking"
            and state["phase"] != "deep"
            and adapted.get("response_length") == "balanced"
        ):
            adapted["response_length"] = "detailed"
            hints.append("The user is asking a question early in the conversation. Give a thorough, well-explained answer.")

    # 2. Priority stack reordering (always applies — safety/distress override everything)
    stack = adapted["priority_stack"]
    if state["sensitivity"] == "high":
        if "safety" in stack:
            idx = stack.index("safety")
            if idx > 0:
                stack.pop(idx)
                stack.insert(0, "safety")
        else:
            stack.insert(0, "safety")
        hints.append("The topic involves sensitive content. Prioritize user safety and always include appropriate disclaimers.")

    if state["emotional_tone"] == "distressed":
        if "warmth" in stack:
            idx = stack.index("warmth")
            if idx > 1:
                stack.pop(idx)
                stack.insert(1, "warmth")
        else:
            stack.insert(1, "warmth")
        if not (is_manual and "response_tone" in base_behavior.get("_manual_fields", set())):
            if adapted.get("response_tone") in ("professional", "academic"):
                adapted["response_tone"] = "friendly"
        hints.append("The user appears emotionally stressed. Acknowledge their situation with warmth before addressing the task.")

    # 3. Expertise hints
    if state["expertise"] == "expert":
        hints.append("The user appears experienced. Skip basic definitions, use field-appropriate terminology.")
    elif state["expertise"] == "beginner":
        hints.append("The user appears newer to this topic. Avoid jargon, explain clearly, use simple examples.")

    # 4. Format hint
    if state["format_hint"] == "plain":
        hints.append("The user wants a brief, plain answer. Skip markdown formatting and bullet points.")
    elif state["format_hint"] == "bullet-heavy":
        hints.append("The user is asking for structured information. Use bullet points, numbered lists, or tables.")

    if hints:
        adapted["_adaptationHints"] = hints

    return adapted
