import asyncio
import ipaddress
import logging
import re
import socket
from urllib.parse import urlparse, urlunparse

import httpx
from bs4 import BeautifulSoup
from ddgs import DDGS

from services.llm import rewrite_query_for_sjsu

logger = logging.getLogger(__name__)

PREFERRED_DOMAINS = [
    "sjsu.edu",
    "catalog.sjsu.edu",
    "library.sjsu.edu",
    "blogs.sjsu.edu",
    "one.sjsu.edu",
]

BLOCKED_DOMAINS = [
    "reddit.com",
    "quora.com",
    "pinterest.com",
    "medium.com",
    "fandom.com",
    "wikihow.com",
    "blogspot.com",
]

OTHER_UNIVERSITY_DOMAINS = [
    "santaclara.edu",
    "stanford.edu",
    "berkeley.edu",
    "calstate.edu",
    "sfsu.edu",
    "csulb.edu",
    "csufresno.edu",
    "csun.edu",
    "fullerton.edu",
    "sdsu.edu",
    "ucla.edu",
    "ucsd.edu",
    "ucdavis.edu",
    "ucsc.edu",
    "ucr.edu",
    "ucmerced.edu",
    "ucsb.edu",
    "ucsf.edu",
    "uci.edu",
    "scu.edu",
]

MAX_RESULTS = 20
MAX_SOURCES = 5
MAX_CHARS_PER_PAGE = 6000
MAX_TOTAL_CHARS = 24000
MAX_BYTES_PER_PAGE = 2_000_000
MAX_REDIRECTS = 3
REQUEST_TIMEOUT = 10.0
USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36"


def _hostname(url: str) -> str:
    try:
        return (urlparse(url).hostname or "").lower()
    except ValueError:
        return ""


def _host_matches(hostname: str, domain: str) -> bool:
    if not hostname:
        return False
    domain = domain.lower()
    return hostname == domain or hostname.endswith("." + domain)


def _canonicalize_url(url: str) -> str:
    try:
        parsed = urlparse(url)
    except ValueError:
        return url
    scheme = parsed.scheme.lower()
    netloc = parsed.netloc.lower()
    path = parsed.path or "/"
    if path != "/" and path.endswith("/"):
        path = path.rstrip("/")
    return urlunparse((scheme, netloc, path, parsed.params, parsed.query, ""))


def search_web(query: str) -> list[dict]:
    results = []
    if not query or not query.strip():
        return results
    try:
        with DDGS() as ddgs:
            for r in ddgs.text(query, max_results=MAX_RESULTS):
                url = r.get("href") or r.get("url")
                if not url:
                    continue
                results.append(
                    {
                        "title": r.get("title") or "",
                        "url": url,
                        "snippet": r.get("body") or "",
                    }
                )
    except Exception:
        logger.exception("DDGS search failed for query: %r", query)
        return []
    return results


def _is_blocked(url: str) -> bool:
    host = _hostname(url)
    return any(_host_matches(host, bad) for bad in BLOCKED_DOMAINS)


def _is_preferred(url: str) -> bool:
    host = _hostname(url)
    return any(_host_matches(host, dom) for dom in PREFERRED_DOMAINS)


def _is_other_university(url: str) -> bool:
    host = _hostname(url)
    return any(_host_matches(host, dom) for dom in OTHER_UNIVERSITY_DOMAINS)


def _is_edu(url: str) -> bool:
    host = _hostname(url)
    return host.endswith(".edu") or host == "edu"


def _dedup_results(results: list[dict]) -> list[dict]:
    seen: set[str] = set()
    deduped: list[dict] = []
    for r in results:
        url = r.get("url") or ""
        if not url:
            continue
        key = _canonicalize_url(url)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(r)
    return deduped


def rank_sources(results: list[dict]) -> list[dict]:
    deduped = _dedup_results(results)
    filtered = [
        r for r in deduped
        if r.get("url")
        and not _is_blocked(r["url"])
        and not _is_other_university(r["url"])
    ]

    def score(item: dict) -> int:
        url = item.get("url") or ""
        if _is_preferred(url):
            return 100
        if _is_edu(url):
            return 5
        return 0

    ranked = sorted(enumerate(filtered), key=lambda pair: (-score(pair[1]), pair[0]))
    return [item for _, item in ranked][:MAX_SOURCES]


def _clean_text(text: str) -> str:
    normalized = re.sub(r"\r\n?", "\n", text)
    normalized = re.sub(r"[ \t\f\v]+", " ", normalized)
    normalized = re.sub(r"\n{3,}", "\n\n", normalized)
    return normalized.strip()


def _extract_main_text(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "noscript", "svg", "footer", "nav", "aside", "header", "form"]):
        tag.decompose()
    candidates = [
        soup.find("main"),
        soup.find("article"),
        soup.find("div", id="content"),
        soup.find("div", id="main-content"),
        soup.find("div", id="page-content"),
        soup.find("section"),
        soup.body,
    ]
    best_text = ""
    for node in candidates:
        if not node:
            continue
        text = _clean_text(node.get_text(separator="\n", strip=True))
        if len(text) > len(best_text):
            best_text = text
    return best_text


async def _host_is_public(host: str) -> bool:
    try:
        infos = await asyncio.to_thread(socket.getaddrinfo, host, None)
    except socket.gaierror:
        return False
    if not infos:
        return False
    for info in infos:
        try:
            ip = ipaddress.ip_address(info[4][0])
        except (ValueError, IndexError):
            return False
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_reserved
            or ip.is_multicast
            or ip.is_unspecified
        ):
            return False
    return True


async def _safe_stream_get(client: httpx.AsyncClient, url: str) -> tuple[str, str] | None:
    """Walk redirects manually, validating the host at each hop. Returns (final_url, body_text) or None."""
    current = url
    for _ in range(MAX_REDIRECTS + 1):
        parsed = urlparse(current)
        if parsed.scheme not in ("http", "https"):
            return None
        host = parsed.hostname
        if not host or not await _host_is_public(host):
            return None
        try:
            async with client.stream("GET", current) as resp:
                if resp.is_redirect:
                    location = resp.headers.get("location")
                    if not location:
                        return None
                    current = str(httpx.URL(current).join(location))
                    continue
                if resp.status_code >= 400:
                    return None
                content_type = resp.headers.get("content-type", "")
                if "text/html" not in content_type.lower():
                    return None
                buf = bytearray()
                async for chunk in resp.aiter_bytes():
                    buf.extend(chunk)
                    if len(buf) >= MAX_BYTES_PER_PAGE:
                        buf = buf[:MAX_BYTES_PER_PAGE]
                        break
                encoding = resp.charset_encoding or "utf-8"
                try:
                    text = bytes(buf).decode(encoding, errors="replace")
                except LookupError:
                    text = bytes(buf).decode("utf-8", errors="replace")
                return current, text
        except Exception:
            logger.exception("fetch failed for %s", current)
            return None
    return None


async def _fetch_page(client: httpx.AsyncClient, url: str, sem: asyncio.Semaphore) -> dict:
    async with sem:
        result = await _safe_stream_get(client, url)
        if not result:
            return {"url": url, "content": ""}
        _final, html = result
        content = _extract_main_text(html)
        if len(content) > MAX_CHARS_PER_PAGE:
            content = content[:MAX_CHARS_PER_PAGE].rsplit(" ", 1)[0] + "..."
        return {"url": url, "content": content}


async def crawl_sources(urls: list[str]) -> list[dict]:
    timeout = httpx.Timeout(REQUEST_TIMEOUT)
    headers = {"User-Agent": USER_AGENT}
    sem = asyncio.Semaphore(3)
    async with httpx.AsyncClient(
        timeout=timeout,
        follow_redirects=False,
        headers=headers,
    ) as client:
        tasks = [_fetch_page(client, url, sem) for url in urls]
        return await asyncio.gather(*tasks)


_CONVERSATIONAL_RE = re.compile(
    r"^(hi+|hello+|hey+|yo|sup|thanks?|thank\s*you|thx|ty|ok(?:ay)?|cool|nice|great|"
    r"awesome|yes|yep|yeah|no|nope|nah|sure|got\s*it|understood|please|sorry|bye|goodbye)"
    r"[\s!.?,]*$",
    re.IGNORECASE,
)

_INTERROGATIVE_PREFIXES = (
    "who", "what", "when", "where", "why", "how", "which",
    "is ", "are ", "was ", "were ", "can ", "could ", "do ", "does ", "did ",
    "should ", "would ", "will ", "tell me", "explain", "describe", "list", "show me",
)

_PRONOUN_RE = re.compile(
    r"\b(it|this|that|those|these|they|them|he|she|him|her|more|another|the\s+same)\b",
    re.IGNORECASE,
)


def _is_conversational(message: str) -> bool:
    stripped = message.strip()
    return bool(_CONVERSATIONAL_RE.match(stripped))


def _looks_like_followup(message: str) -> bool:
    stripped = message.strip()
    if len(stripped.split()) >= 7:
        return False
    lowered = stripped.lower()
    if _PRONOUN_RE.search(lowered):
        return True
    return not any(lowered.startswith(w) for w in _INTERROGATIVE_PREFIXES)


def prepare_rag_query(messages: list[dict]) -> str | None:
    """Pick a search query from the conversation, or return None to skip RAG.

    Skips conversational acknowledgments. For short follow-ups that lean on prior
    context (pronouns, no interrogative), prepends the previous user turn to make
    the search query self-contained.
    """
    if not messages:
        return None
    last_user_idx = next(
        (i for i in range(len(messages) - 1, -1, -1) if messages[i].get("role") == "user"),
        None,
    )
    if last_user_idx is None:
        return None
    last_user = (messages[last_user_idx].get("content") or "").strip()
    if not last_user:
        return None
    if _is_conversational(last_user):
        return None
    if _looks_like_followup(last_user):
        prior = next(
            (
                (messages[i].get("content") or "").strip()
                for i in range(last_user_idx - 1, -1, -1)
                if messages[i].get("role") == "user"
            ),
            "",
        )
        if prior:
            return f"{prior} {last_user}".strip()
    return last_user


async def build_rag_prompt(messages: list[dict]) -> tuple[str | None, list[dict]]:
    question = prepare_rag_query(messages)
    if not question:
        return None, []

    rewritten = await rewrite_query_for_sjsu(question)
    logger.info("RAG query rewritten: %r -> %r", question, rewritten)

    try:
        sjsu_task = asyncio.to_thread(search_web, f"{rewritten} site:sjsu.edu")
        general_task = asyncio.to_thread(search_web, rewritten)
        sjsu_results, general_results = await asyncio.gather(sjsu_task, general_task)
        search_results = sjsu_results + general_results
    except Exception:
        logger.exception("search step failed for question: %r", rewritten)
        return None, []

    top_sources = rank_sources(search_results)
    if not top_sources:
        return None, []

    pages = await crawl_sources([s["url"] for s in top_sources])
    page_by_url = {p["url"]: p for p in pages}
    used_sources = []
    context_blocks = []
    total_chars = 0

    for source in top_sources:
        page = page_by_url.get(source["url"])
        content = page.get("content", "") if page else ""
        if not content:
            snippet = source.get("snippet") or ""
            if snippet:
                content = snippet
            else:
                continue
        remaining = MAX_TOTAL_CHARS - total_chars
        if remaining <= 0:
            break
        if len(content) > remaining:
            content = content[:remaining].rsplit(" ", 1)[0] + "..."
        total_chars += len(content)
        used_sources.append(
            {
                "title": source.get("title") or source["url"],
                "url": source["url"],
            }
        )
        context_blocks.append(
            f"[{len(used_sources)}] {used_sources[-1]['title']} - {used_sources[-1]['url']}\n{content}"
        )

    if not context_blocks:
        return None, []

    prompt = (
        "Answer the question using the context below. "
        "If the context is incomplete, give the best possible answer and explicitly note what is missing. "
        "Only say you don't know if there is no relevant context at all. "
        "Cite sources using [1], [2], etc.\n\n"
        "Context:\n" + "\n\n".join(context_blocks)
    )
    return prompt, used_sources


async def _demo() -> None:
    question = "SJSU graduation requirements for CS masters program?"
    prompt, sources = await build_rag_prompt([{"role": "user", "content": question}])
    print("Question:", question)
    print("Sources:", sources)
    print("Prompt:\n", prompt)


if __name__ == "__main__":
    asyncio.run(_demo())
