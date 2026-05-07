"""
Unit tests for the web RAG pipeline (services/web_search.py).

Run from backend/ with:
    python -m tests.test_web_search

Network-touching code paths (DDGS search, _safe_stream_get, _fetch_page,
crawl_sources, build_rag_prompt end-to-end) are not exercised here — those
need integration tests with a mock HTTP server.
"""
import asyncio
import socket
import sys
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.web_search import (  # noqa: E402
    _canonicalize_url,
    _clean_text,
    _dedup_results,
    _extract_main_text,
    _host_is_public,
    _host_matches,
    _is_blocked,
    _is_conversational,
    _is_edu,
    _is_other_university,
    _is_preferred,
    _looks_like_followup,
    prepare_rag_query,
    rank_sources,
)


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


# ── 1. URL hostname / canonicalisation ────────────────────────────────────────


def test_host_matches():
    print("\n[1.1] _host_matches — exact, subdomain, no substring confusion")
    _check("exact match", _host_matches("sjsu.edu", "sjsu.edu"))
    _check("subdomain match", _host_matches("catalog.sjsu.edu", "sjsu.edu"))
    _check("deep subdomain match", _host_matches("a.b.sjsu.edu", "sjsu.edu"))
    _check("not matched on substring", not _host_matches("evilsjsu.edu", "sjsu.edu"))
    _check("not matched as suffix without dot", not _host_matches("notsjsu.edu", "sjsu.edu"))
    _check("empty host returns False", not _host_matches("", "sjsu.edu"))


def test_is_blocked_and_preferred():
    print("\n[1.2] _is_blocked / _is_preferred operate on hostname, not substring")
    _check("reddit.com blocked", _is_blocked("https://www.reddit.com/r/sjsu"))
    _check("reddit subdomain blocked", _is_blocked("https://old.reddit.com/x"))
    _check("query param mention not blocked", not _is_blocked("https://example.com/?ref=reddit.com"))
    _check("sjsu.edu preferred", _is_preferred("https://www.sjsu.edu/admissions"))
    _check("sjsu subdomain preferred", _is_preferred("https://catalog.sjsu.edu/"))
    _check("malicious lookalike not preferred", not _is_preferred("https://evil.com/?fake=sjsu.edu"))


def test_canonicalize_url():
    print("\n[1.3] _canonicalize_url — case + trailing slash + fragment normalisation")
    _check("scheme lowered", _canonicalize_url("HTTPS://Example.com/Path") == "https://example.com/Path")
    _check("trailing slash stripped", _canonicalize_url("https://x.com/path/") == "https://x.com/path")
    _check("root slash kept", _canonicalize_url("https://x.com/") == "https://x.com/")
    _check("fragment dropped", _canonicalize_url("https://x.com/p#frag") == "https://x.com/p")
    _check("query preserved", _canonicalize_url("https://x.com/p?a=1") == "https://x.com/p?a=1")


def test_dedup_results():
    print("\n[1.4] _dedup_results — collapses canonical duplicates, preserves order")
    results = [
        {"url": "https://sjsu.edu/a", "title": "first"},
        {"url": "HTTPS://SJSU.EDU/a/", "title": "duplicate, different case+slash"},
        {"url": "https://sjsu.edu/a#frag", "title": "duplicate, fragment"},
        {"url": "https://sjsu.edu/b", "title": "different path"},
        {"url": "", "title": "empty url, dropped"},
    ]
    deduped = _dedup_results(results)
    _check("two unique entries", len(deduped) == 2, f"got {len(deduped)}")
    _check("first occurrence wins", deduped[0]["title"] == "first")
    _check("empty url dropped", all(r.get("url") for r in deduped))


# ── 2. Ranking ────────────────────────────────────────────────────────────────


def test_rank_sources_preference_and_blocklist():
    print("\n[2.1] rank_sources — preferred domains float to top, blocked filtered")
    results = [
        {"url": "https://medium.com/somepost", "title": "blocked"},
        {"url": "https://example.com/x", "title": "neutral"},
        {"url": "https://catalog.sjsu.edu/y", "title": "preferred"},
        {"url": "https://reddit.com/r/x", "title": "blocked"},
        {"url": "https://sjsu.edu/z", "title": "preferred"},
    ]
    ranked = rank_sources(results)
    urls = [r["url"] for r in ranked]
    _check("blocked filtered out", "https://medium.com/somepost" not in urls)
    _check("blocked subdomain match filtered out", "https://reddit.com/r/x" not in urls)
    _check("preferred items first", urls[:2] == ["https://catalog.sjsu.edu/y", "https://sjsu.edu/z"], urls)
    _check("neutral retained at end", "https://example.com/x" in urls)


def test_rank_sources_dedups():
    print("\n[2.2] rank_sources collapses duplicate URLs from boosted searches")
    results = [
        {"url": "https://sjsu.edu/page", "title": "from primary"},
        {"url": "HTTPS://sjsu.edu/page/", "title": "from boosted, same canonically"},
        {"url": "https://sjsu.edu/other", "title": "different"},
    ]
    ranked = rank_sources(results)
    _check("dedup keeps two distinct sources", len(ranked) == 2, f"got {len(ranked)}")


def test_is_other_university_and_is_edu():
    print("\n[2.3] _is_other_university / _is_edu — competitor and academic detection")
    _check("santaclara.edu detected as other uni", _is_other_university("https://www.santaclara.edu/cpt"))
    _check("stanford.edu detected as other uni", _is_other_university("https://stanford.edu/x"))
    _check("calstate subdomain detected as other uni", _is_other_university("https://www2.calstate.edu/page"))
    _check("sjsu.edu NOT classified as other uni", not _is_other_university("https://sjsu.edu/x"))
    _check("example.com NOT other uni", not _is_other_university("https://example.com/x"))
    _check("any .edu detected by _is_edu", _is_edu("https://harvard.edu/x"))
    _check("sjsu.edu detected by _is_edu", _is_edu("https://sjsu.edu/x"))
    _check("example.com NOT detected by _is_edu", not _is_edu("https://example.com/x"))


def test_rank_sources_filters_other_universities():
    print("\n[2.4] rank_sources filters out competitor university results entirely")
    results = [
        {"url": "https://www.santaclara.edu/cpt-info", "title": "SCU CPT page"},
        {"url": "https://www.stanford.edu/cpt", "title": "Stanford CPT"},
        {"url": "https://www.sjsu.edu/global/cpt", "title": "SJSU CPT"},
        {"url": "https://example.com/cpt-guide", "title": "Generic guide"},
    ]
    ranked = rank_sources(results)
    urls = [r["url"] for r in ranked]
    _check("santaclara filtered", "https://www.santaclara.edu/cpt-info" not in urls)
    _check("stanford filtered", "https://www.stanford.edu/cpt" not in urls)
    _check("sjsu retained", "https://www.sjsu.edu/global/cpt" in urls)
    _check("generic retained", "https://example.com/cpt-guide" in urls)


def test_rank_sources_tiered_scoring():
    print("\n[2.5] rank_sources tiered scoring: sjsu > .edu > other")
    results = [
        {"url": "https://example.com/page", "title": "neutral"},
        {"url": "https://harvard.edu/page", "title": "edu but not sjsu"},
        {"url": "https://www.sjsu.edu/page", "title": "sjsu"},
    ]
    ranked = rank_sources(results)
    urls = [r["url"] for r in ranked]
    _check("sjsu first", urls[0] == "https://www.sjsu.edu/page", urls)
    _check("other .edu second", urls[1] == "https://harvard.edu/page", urls)
    _check("non-edu last", urls[2] == "https://example.com/page", urls)


# ── 3. Text extraction ────────────────────────────────────────────────────────


def test_clean_text():
    print("\n[3.1] _clean_text — whitespace normalisation")
    raw = "line\r\nline\r\n\r\n\r\n\r\nlast   word\t\there"
    cleaned = _clean_text(raw)
    _check("CRLF normalised", "\r" not in cleaned)
    _check("3+ newlines collapsed", "\n\n\n" not in cleaned)
    _check("multiple spaces collapsed", "   " not in cleaned)


def test_extract_main_text_prefers_main():
    print("\n[3.2] _extract_main_text — prefers <main>, drops script/style/nav")
    html = """
    <html><head><title>t</title><style>body{color:red}</style></head>
    <body>
      <nav>nav junk should be removed</nav>
      <header>header junk</header>
      <main>This is the real content the user wants.</main>
      <footer>footer junk</footer>
      <script>alert('x')</script>
    </body></html>
    """
    text = _extract_main_text(html)
    _check("main content present", "real content" in text)
    _check("nav removed", "nav junk" not in text)
    _check("header removed", "header junk" not in text)
    _check("footer removed", "footer junk" not in text)
    _check("script removed", "alert" not in text)
    _check("style removed", "color:red" not in text)


def test_extract_main_text_fallback_body():
    print("\n[3.3] _extract_main_text — falls back to body when no main/article")
    html = "<html><body><p>Just a paragraph.</p></body></html>"
    text = _extract_main_text(html)
    _check("body fallback works", "Just a paragraph." in text)


# ── 4. Conversational / followup detection (H2 + M4) ──────────────────────────


def test_is_conversational():
    print("\n[4.1] _is_conversational — greetings, thanks, acknowledgments")
    for msg in ["hi", "Hello!", "hey there".split()[0], "thanks", "thank you", "ok", "yes", "nope", "got it", "bye"]:
        _check(f"'{msg}' classified conversational", _is_conversational(msg))
    for msg in ["hi, how do I register for classes?", "what is the GPA cutoff?", "explain CS 146 prereqs"]:
        _check(f"'{msg[:30]}' NOT conversational", not _is_conversational(msg))


def test_looks_like_followup():
    print("\n[4.2] _looks_like_followup — short, contains pronouns, no interrogative")
    _check("'tell me more' is followup", _looks_like_followup("tell me more"))
    _check("'what about that one?' is followup (pronoun)", _looks_like_followup("what about that one?"))
    _check("'and them?' is followup", _looks_like_followup("and them?"))
    _check("'what is the GPA cutoff for CS?' is NOT followup", not _looks_like_followup("what is the GPA cutoff for CS?"))
    _check("longer message is NOT followup", not _looks_like_followup("How do I apply for the masters program in computer science?"))


def test_prepare_rag_query_skips_conversational():
    print("\n[4.3] prepare_rag_query — returns None for conversational messages")
    _check("hi -> None", prepare_rag_query([{"role": "user", "content": "hi"}]) is None)
    _check("thanks -> None", prepare_rag_query([{"role": "user", "content": "thanks!"}]) is None)
    _check("empty messages -> None", prepare_rag_query([]) is None)
    _check("empty content -> None", prepare_rag_query([{"role": "user", "content": "   "}]) is None)


def test_prepare_rag_query_passes_through_substantive():
    print("\n[4.4] prepare_rag_query — returns substantive question as-is")
    q = "what are the SJSU CS masters graduation requirements?"
    out = prepare_rag_query([{"role": "user", "content": q}])
    _check("returned verbatim", out == q, f"got {out!r}")


def test_prepare_rag_query_augments_followup():
    print("\n[4.5] prepare_rag_query — prepends prior user turn for short followups")
    msgs = [
        {"role": "user", "content": "what are the CS masters requirements at SJSU?"},
        {"role": "assistant", "content": "(some prior answer)"},
        {"role": "user", "content": "tell me more"},
    ]
    out = prepare_rag_query(msgs)
    _check("prior question prepended", out and "CS masters" in out and "tell me more" in out, f"got {out!r}")


def test_prepare_rag_query_no_prior_user():
    print("\n[4.6] prepare_rag_query — followup with no prior user turn returns msg as-is")
    msgs = [{"role": "user", "content": "tell me more"}]
    out = prepare_rag_query(msgs)
    _check("followup without prior context returns own text", out == "tell me more", f"got {out!r}")


# ── 5. SSRF — _host_is_public (H1) ────────────────────────────────────────────


def _resolved(*ips):
    """Build a fake getaddrinfo return value for the given IP strings."""
    return [(socket.AF_INET, socket.SOCK_STREAM, 0, "", (ip, 0)) for ip in ips]


def test_host_is_public_blocks_loopback():
    print("\n[5.1] _host_is_public — blocks loopback, link-local, private, reserved")
    cases = {
        "127.0.0.1": False,           # loopback
        "10.1.2.3": False,            # private
        "192.168.1.1": False,         # private
        "172.16.5.5": False,          # private
        "169.254.169.254": False,     # link-local (cloud metadata!)
        "0.0.0.0": False,             # unspecified
        "224.0.0.1": False,           # multicast
        "8.8.8.8": True,              # public
        "1.1.1.1": True,              # public
    }
    for ip, expected in cases.items():
        with patch("services.web_search.socket.getaddrinfo", return_value=_resolved(ip)):
            actual = asyncio.run(_host_is_public("test.invalid"))
        _check(f"{ip} -> {'public' if expected else 'blocked'}", actual is expected, f"got {actual}")


def test_host_is_public_blocks_dns_failure():
    print("\n[5.2] _host_is_public — DNS failure returns False")
    with patch("services.web_search.socket.getaddrinfo", side_effect=socket.gaierror("nope")):
        actual = asyncio.run(_host_is_public("nonexistent.invalid"))
    _check("DNS failure -> False", actual is False)


def test_host_is_public_mixed_resolution():
    print("\n[5.3] _host_is_public — any private IP in resolution set rejects host (DNS rebinding guard)")
    with patch(
        "services.web_search.socket.getaddrinfo",
        return_value=_resolved("8.8.8.8", "127.0.0.1"),
    ):
        actual = asyncio.run(_host_is_public("rebind.invalid"))
    _check("public + private mixed -> blocked", actual is False)


# ── 6. Run everything ─────────────────────────────────────────────────────────


def main():
    print("=" * 60)
    print("Web RAG unit tests")
    print("=" * 60)

    test_host_matches()
    test_is_blocked_and_preferred()
    test_canonicalize_url()
    test_dedup_results()

    test_rank_sources_preference_and_blocklist()
    test_rank_sources_dedups()
    test_is_other_university_and_is_edu()
    test_rank_sources_filters_other_universities()
    test_rank_sources_tiered_scoring()

    test_clean_text()
    test_extract_main_text_prefers_main()
    test_extract_main_text_fallback_body()

    test_is_conversational()
    test_looks_like_followup()
    test_prepare_rag_query_skips_conversational()
    test_prepare_rag_query_passes_through_substantive()
    test_prepare_rag_query_augments_followup()
    test_prepare_rag_query_no_prior_user()

    test_host_is_public_blocks_loopback()
    test_host_is_public_blocks_dns_failure()
    test_host_is_public_mixed_resolution()

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
