"""
Auto-detect + manual override integration tests.

Covers:
  1. Auto-detect on a variety of conversation types
  2. Manual override merging (what wins, what falls through)
  3. Reset-to-auto semantics
  4. adapt_behavior() respecting _manual_fields

Run from backend/ with:
    python -m tests.test_adapt_behavior
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.conversation_state import (  # noqa: E402
    analyze_conversation_state,
    generate_default_behavior,
    merge_behavior,
    adapt_behavior,
)


# test runner 
PASS = 0
FAIL = 0
FAILURES = []


def _check(label, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ok   {label}")
    else:
        FAIL += 1
        FAILURES.append((label, detail))
        print(f"  FAIL {label}  {detail}")


def msg(user_text):
    """Shortcut — builds a single-turn conversation."""
    return [{"role": "user", "content": user_text}]


def convo(*turns):
    """Build a multi-turn convo. Pass alternating user/assistant texts."""
    out = []
    for i, text in enumerate(turns):
        out.append({"role": "user" if i % 2 == 0 else "assistant", "content": text})
    return out


def run_full_pipeline(messages, manual_override=None):
    """Simulate the backend /chat flow end-to-end."""
    state = analyze_conversation_state(messages)
    auto = generate_default_behavior(state)
    merged = merge_behavior(auto, manual_override)
    adapted = adapt_behavior(merged, state)
    return state, auto, adapted


# ── 1. Auto-detect — conversation type coverage ───────────────────────────────


def test_urgent_question():
    print("\n[1.1] Urgent question — 'need this ASAP'")
    state, auto, adapted = run_full_pipeline(msg("I need to register for classes ASAP, my deadline is tomorrow"))
    _check("urgency flagged high", state["urgency"] == "high", state["urgency"])
    _check("auto length is concise", auto["response_length"] == "concise")
    _check("speed promoted in priority stack", adapted["priority_stack"][:2] == ["safety", "speed"], adapted["priority_stack"])
    _check("adaptation hint mentions brief", any("brief" in h.lower() or "hurry" in h.lower() for h in adapted.get("_adaptationHints", [])))


def test_expert_user():
    print("\n[1.2] Expert user — CS terminology")
    state, auto, adapted = run_full_pipeline(convo(
        "Can we discuss the asymptotic complexity of this recursion?",
        "Sure, what specifically?",
        "The kernel uses a semaphore with a deadlock potential — the mutex ordering is inconsistent",
    ))
    _check("expertise = expert", state["expertise"] == "expert", state["expertise"])
    _check("emoji suppressed for experts", auto["emoji_usage"] == "none", auto["emoji_usage"])
    _check("tone is professional (technical + expert)", auto["response_tone"] == "professional", auto["response_tone"])
    _check("expert adaptation hint present", any("experienced" in h or "terminology" in h for h in adapted.get("_adaptationHints", [])))


def test_distressed_user():
    print("\n[1.3] Distressed user — 'I'm so stressed'")
    state, auto, adapted = run_full_pipeline(msg("I'm so stressed and overwhelmed, I'm falling behind in all my classes and I don't know what to do"))
    _check("emotional_tone = distressed", state["emotional_tone"] == "distressed")
    _check("tone is friendly", auto["response_tone"] == "friendly")
    _check("emoji suppressed for distress", auto["emoji_usage"] == "none")
    _check("warmth promoted to #2", adapted["priority_stack"][1] == "warmth", adapted["priority_stack"])
    _check("warmth adaptation hint present", any("warmth" in h.lower() or "stress" in h.lower() for h in adapted.get("_adaptationHints", [])))


def test_simple_factual():
    print("\n[1.4] Simple factual question — 'what time does the library close?'")
    state, auto, adapted = run_full_pipeline(msg("what time does the library close?"))
    _check("task_phase = asking", state["task_phase"] == "asking")
    _check("urgency normal", state["urgency"] == "normal")
    _check("phase = opening", state["phase"] == "opening")
    _check("format = markdown (default)", auto["response_format"] == "markdown")


def test_list_request():
    print("\n[1.5] List request — 'list the CS electives'")
    state, auto, adapted = run_full_pipeline(msg("Can you list the CS electives for next semester? Compare them too."))
    _check("format_hint = bullet-heavy", state["format_hint"] == "bullet-heavy", state["format_hint"])
    _check("auto format = bullet-heavy", auto["response_format"] == "bullet-heavy")
    _check("structured hint present", any("bullet" in h.lower() or "structured" in h.lower() for h in adapted.get("_adaptationHints", [])))


def test_brief_request():
    print("\n[1.6] Brief request — 'just tell me briefly'")
    state, auto, _ = run_full_pipeline(msg("Briefly, what is the GPA requirement for the CS major?"))
    _check("format_hint = plain", state["format_hint"] == "plain")
    _check("auto format = plain", auto["response_format"] == "plain")


def test_first_message():
    print("\n[1.7] First message — no prior context")
    state, auto, _ = run_full_pipeline(msg("Hi!"))
    _check("phase = opening", state["phase"] == "opening")
    _check("expertise = unknown", state["expertise"] == "unknown")
    _check("length = balanced or detailed (not concise)", auto["response_length"] in ("balanced", "detailed"))


def test_deep_conversation():
    print("\n[1.8] Deep conversation — 10+ user turns")
    # Need >8 user messages to trigger "deep" — convo() alternates user/assistant
    # so we need ~20 items to get 10 user turns.
    turns = []
    for i in range(20):
        turns.append(f"turn {i}")
    state, auto, adapted = run_full_pipeline(convo(*turns))
    _check("phase = deep", state["phase"] == "deep", state["phase"])
    _check("auto length = concise (deep)", auto["response_length"] == "concise")
    # Note: auto already set length=concise, so adapt_behavior skips the deep
    # branch and no extra hint is emitted. The outcome (concise) is what matters.
    _check("adapted length is concise", adapted["response_length"] == "concise")


def test_emoji_mirror():
    print("\n[1.9] Emoji mirror — user uses emojis")
    state, auto, _ = run_full_pipeline(msg("hey!! 😊 can you help me with registration? 🎓 thanks!! 🙏"))
    _check("emoji_mirror detected", state["emoji_mirror"] in ("occasional", "frequent"), state["emoji_mirror"])
    _check("auto emoji mirrors user", auto["emoji_usage"] in ("occasional", "frequent"))


def test_formal_tone():
    print("\n[1.10] Formal tone — academic phrasing")
    state, auto, _ = run_full_pipeline(msg(
        "I would like to inquire regarding the matter of course prerequisites. "
        "Furthermore, could you please elaborate on the aforementioned requirements?"
    ))
    _check("tone_formality = formal", state["tone_formality"] == "formal", state["tone_formality"])
    _check("auto tone = academic", auto["response_tone"] == "academic")


# ── 2. Manual override merging ────────────────────────────────────────────────


def test_manual_tone_wins():
    print("\n[2.1] Auto says friendly, user overrides to professional — professional wins")
    messages = msg("hey can you help me?")
    state = analyze_conversation_state(messages)
    auto = generate_default_behavior(state)
    _check("auto tone = friendly", auto["response_tone"] == "friendly")

    manual = {"response_tone": "professional"}
    merged = merge_behavior(auto, manual)
    _check("manual tone wins", merged["response_tone"] == "professional")
    _check("_has_manual_overrides flag set", merged.get("_has_manual_overrides") is True)
    _check("_manual_fields tracks tone", "response_tone" in merged.get("_manual_fields", set()))

    # Other fields fall through to auto
    _check("length still from auto", merged["response_length"] == auto["response_length"])
    _check("format still from auto", merged["response_format"] == auto["response_format"])
    _check("emoji still from auto", merged["emoji_usage"] == auto["emoji_usage"])


def test_partial_override_fallthrough():
    print("\n[2.2] User overrides tone only — length/format/emoji stay auto")
    messages = msg("list the prerequisites for CS 146")
    state = analyze_conversation_state(messages)
    auto = generate_default_behavior(state)

    manual = {"response_tone": "casual", "response_length": None, "response_format": None}
    merged = merge_behavior(auto, manual)
    _check("manual tone applied", merged["response_tone"] == "casual")
    _check("length auto-detected", merged["response_length"] == auto["response_length"])
    _check("format auto = bullet-heavy (from list request)", merged["response_format"] == "bullet-heavy")
    _check("only tone in _manual_fields", merged["_manual_fields"] == {"response_tone"})


def test_reset_to_auto():
    print("\n[2.3] Reset to auto — no manual override = pure auto")
    messages = msg("I'm stressed about finals, any tips?")
    state = analyze_conversation_state(messages)
    auto = generate_default_behavior(state)

    # Empty/None manual means no override — simulates "Reset All to Auto"
    merged_empty = merge_behavior(auto, None)
    _check("None manual returns auto as-is", merged_empty == auto)
    _check("no _has_manual_overrides flag", "_has_manual_overrides" not in merged_empty)

    merged_empty2 = merge_behavior(auto, {})
    _check("empty dict manual returns auto", merged_empty2 == auto)


def test_manual_overrides_full():
    print("\n[2.4] User overrides every field")
    messages = msg("hey")
    state = analyze_conversation_state(messages)
    auto = generate_default_behavior(state)

    manual = {
        "response_tone": "academic",
        "response_length": "detailed",
        "response_format": "plain",
        "emoji_usage": "frequent",
    }
    merged = merge_behavior(auto, manual)
    for field, value in manual.items():
        _check(f"manual {field} = {value}", merged[field] == value)
    _check("all four fields in _manual_fields", len(merged["_manual_fields"]) == 4)


# ── 3. adapt_behavior respects manual overrides ───────────────────────────────


def test_adapt_respects_manual_length():
    print("\n[3.1] adapt_behavior does NOT downgrade length if user set it manually")
    messages = msg("I need this ASAP please!!!")  # urgent — auto would force concise
    state = analyze_conversation_state(messages)
    auto = generate_default_behavior(state)
    _check("auto length = concise (urgent)", auto["response_length"] == "concise")

    # User manually wants detailed anyway
    manual = {"response_length": "detailed"}
    merged = merge_behavior(auto, manual)
    adapted = adapt_behavior(merged, state)
    _check("manual detailed length preserved through adapt", adapted["response_length"] == "detailed",
           f"got {adapted['response_length']}")


def test_adapt_respects_manual_tone_distress():
    print("\n[3.2] adapt_behavior does NOT switch tone to friendly if user set it manually")
    messages = msg("I'm so overwhelmed and stressed about everything")
    state = analyze_conversation_state(messages)
    auto = generate_default_behavior(state)

    manual = {"response_tone": "professional"}
    merged = merge_behavior(auto, manual)
    adapted = adapt_behavior(merged, state)
    _check("manual professional tone preserved despite distress",
           adapted["response_tone"] == "professional",
           f"got {adapted['response_tone']}")
    # But warmth should still be promoted in priority_stack since that's separate
    _check("warmth still promoted (priority stack always adapts)",
           adapted["priority_stack"][1] == "warmth")


def test_adapt_auto_length_still_applies():
    print("\n[3.3] adapt_behavior DOES override length when user hasn't set it")
    messages = msg("quickly, whats the cs 146 prereq?")
    state = analyze_conversation_state(messages)
    auto = generate_default_behavior(state)

    # No manual override
    adapted = adapt_behavior(auto, state)
    _check("auto-only behavior still gets adapted", adapted["response_length"] == "concise")


# ── 4. Feedback log snapshot validation ───────────────────────────────────────


def test_final_merged_behavior_has_all_fields():
    print("\n[4.1] Final merged behavior has all fields for feedback_log snapshot")
    messages = convo(
        "Hi, I'm looking at CS minors",
        "What are you interested in?",
        "Systems and security",
    )
    _state, _auto, adapted = run_full_pipeline(messages, manual_override={"response_tone": "casual"})
    required = ["response_tone", "response_length", "response_format", "emoji_usage", "priority_stack"]
    for field in required:
        _check(f"snapshot has {field}", field in adapted, f"missing from: {list(adapted.keys())}")
    _check("casual tone manually set wins", adapted["response_tone"] == "casual")


# ── 5. Run everything ─────────────────────────────────────────────────────────


def main():
    print("=" * 60)
    print("Auto-detect + manual override integration tests")
    print("=" * 60)

    # Auto-detect coverage
    test_urgent_question()
    test_expert_user()
    test_distressed_user()
    test_simple_factual()
    test_list_request()
    test_brief_request()
    test_first_message()
    test_deep_conversation()
    test_emoji_mirror()
    test_formal_tone()

    # Merge + override
    test_manual_tone_wins()
    test_partial_override_fallthrough()
    test_reset_to_auto()
    test_manual_overrides_full()

    # Adapt respects manual
    test_adapt_respects_manual_length()
    test_adapt_respects_manual_tone_distress()
    test_adapt_auto_length_still_applies()

    # Feedback snapshot
    test_final_merged_behavior_has_all_fields()

    print("\n" + "=" * 60)
    print(f"  Passed: {PASS}")
    print(f"  Failed: {FAIL}")
    if FAILURES:
        print("\nFailures:")
        for label, detail in FAILURES:
            print(f"  - {label}: {detail}")
    print("=" * 60)
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
