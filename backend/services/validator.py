"""
Post-generation validator pipeline — ported from UI/src/services/validatorService.js

Runs between LLM generation and display to enforce behavior boundaries.
  Level 1 (soft)   — auto-rewrite via a second API call
  Level 2 (medium) — append a visible warning below the response
"""
import re

CONCISE_WORD_LIMIT = 350

DOMAIN_WARNING = (
    "\n\n---\n*This response may contain medical, legal, or financial information. "
    "Please consult a qualified professional before making any decisions.*"
)

UNVERIFIED_WARNING = (
    "\n\n---\n*Some claims in this response may not be fully verified. "
    "Please double-check important information.*"
)

DOMAIN_TOPICS_PATTERN = re.compile(
    r"\b(diagnos(?:is|ed|e)|symptom|treatment|medication|medicine|disease|illness|disorder|"
    r"therapy|prescription|dosage|surgery|health condition|invest(?:ment|ing)|stock portfolio|"
    r"financial advice|tax advice|retirement fund|securities|legal advice|attorney|lawsuit|"
    r"liability|court order|plaintiff|defendant)\b",
    re.IGNORECASE,
)

DISCLAIMER_PRESENT_PATTERN = re.compile(
    r"\b(consult (a |your )?(doctor|physician|lawyer|attorney|financial advisor)|"
    r"not (medical|legal|financial) advice|speak (to|with) (a |your )?(doctor|physician|professional)|"
    r"professional (advice|judgment)|I('m| am) not (a |your )?(doctor|lawyer|financial advisor)|disclaimer)\b",
    re.IGNORECASE,
)

CERTAINTY_VIOLATION_PATTERN = re.compile(
    r"\b(I('m| am) (absolutely|completely|100%) (sure|certain)|"
    r"this is definitely (true|correct|accurate)|"
    r"it('s| is) definitely (true|correct)|"
    r"always works|never fails|I guarantee\b|"
    r"without (any |a )?doubt|100% (accurate|correct|true))\b",
    re.IGNORECASE,
)


def run_validators(response: str, behavior: dict | None) -> dict:
    """
    Run the validator pipeline on a completed LLM response.
    Returns {violations, action, warning_text, repair_prompt}.
    """
    violations = []

    # 1. Length check — Level 1 auto-rewrite
    if behavior and behavior.get("response_length") == "concise":
        word_count = len(response.strip().split())
        if word_count > CONCISE_WORD_LIMIT:
            violations.append({
                "category": "Style",
                "rule": "response_too_long_for_concise",
                "severity": "soft",
            })

    # 2. Domain disclaimer missing — Level 2 warn
    has_domain = bool(DOMAIN_TOPICS_PATTERN.search(response))
    has_disclaimer = bool(DISCLAIMER_PRESENT_PATTERN.search(response))
    if has_domain and not has_disclaimer:
        violations.append({
            "category": "Domain",
            "rule": "domain_advice_without_disclaimer",
            "severity": "medium",
        })

    # 3. Absolute certainty language — Level 2 warn
    if CERTAINTY_VIOLATION_PATTERN.search(response):
        violations.append({
            "category": "Truthfulness",
            "rule": "absolute_certainty_language",
            "severity": "medium",
        })

    if not violations:
        return {"violations": [], "action": None, "warning_text": None, "repair_prompt": None}

    # Level 1: soft violations -> auto-rewrite
    if any(v["severity"] == "soft" for v in violations):
        return {
            "violations": violations,
            "action": "rewrite",
            "warning_text": None,
            "repair_prompt": (
                f'The following response is too long. The user has "concise" mode enabled. '
                f"Rewrite it to be under 120 words while keeping all key information. "
                f"Return only the rewritten response, no preamble:\n\n{response}"
            ),
        }

    # Level 2: medium violations → append warning
    warnings = []
    if any(v["rule"] == "domain_advice_without_disclaimer" for v in violations):
        warnings.append(DOMAIN_WARNING)
    if (
        any(v["rule"] == "absolute_certainty_language" for v in violations)
        and not any(v["rule"] == "domain_advice_without_disclaimer" for v in violations)
    ):
        warnings.append(UNVERIFIED_WARNING)

    return {
        "violations": violations,
        "action": "warn",
        "warning_text": "".join(warnings),
        "repair_prompt": None,
    }
