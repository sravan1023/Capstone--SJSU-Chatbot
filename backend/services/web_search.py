import asyncio
import re

import httpx
from bs4 import BeautifulSoup
from ddgs import DDGS

PREFERRED_DOMAINS = [
    "sjsu.edu",
    "catalog.sjsu.edu",
    "library.sjsu.edu",
    "blogs.sjsu.edu",
    "one.sjsu.edu",
]

BLOCKLIST = [
    "reddit.com",
    "quora.com",
    "pinterest.com",
    "medium.com",
    "fandom.com",
    "wikihow.com",
    "blogspot.com",
]

MAX_RESULTS = 20
MAX_SOURCES = 5
MAX_CHARS_PER_PAGE = 6000
MAX_TOTAL_CHARS = 24000
USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36"


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
        return []
    return results


def _is_blocked(url: str) -> bool:
    lowered = url.lower()
    return any(bad in lowered for bad in BLOCKLIST)


def rank_sources(results: list[dict]) -> list[dict]:
    filtered = []
    for r in results:
        url = r.get("url") or ""
        if not url or _is_blocked(url):
            continue
        filtered.append(r)

    def score(item: dict) -> int:
        url = (item.get("url") or "").lower()
        return 1 if any(domain in url for domain in PREFERRED_DOMAINS) else 0

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


async def _fetch_page(client: httpx.AsyncClient, url: str, sem: asyncio.Semaphore) -> dict:
    async with sem:
        try:
            resp = await client.get(url)
            if resp.status_code >= 400:
                return {"url": url, "content": ""}
            content_type = resp.headers.get("content-type", "")
            if "text/html" not in content_type:
                return {"url": url, "content": ""}
            content = _extract_main_text(resp.text)
            if len(content) > MAX_CHARS_PER_PAGE:
                content = content[:MAX_CHARS_PER_PAGE].rsplit(" ", 1)[0] + "..."
            return {"url": url, "content": content}
        except Exception:
            return {"url": url, "content": ""}


async def crawl_sources(urls: list[str]) -> list[dict]:
    timeout = httpx.Timeout(10.0)
    headers = {"User-Agent": USER_AGENT}
    sem = asyncio.Semaphore(3)
    async with httpx.AsyncClient(
        timeout=timeout,
        follow_redirects=True,
        headers=headers,
    ) as client:
        tasks = [_fetch_page(client, url, sem) for url in urls]
        return await asyncio.gather(*tasks)


async def build_rag_prompt(question: str) -> tuple[str | None, list[dict]]:
    if not question or not question.strip():
        return None, []

    try:
        search_results = await asyncio.to_thread(search_web, question)
        if "sjsu" in question.lower():
            boosted = await asyncio.to_thread(
                search_web,
                f"{question} site:catalog.sjsu.edu OR site:sjsu.edu",
            )
            search_results.extend(boosted)
    except Exception:
        return None, []
    top_sources = rank_sources(search_results)
    if not top_sources:
        return None, []

    pages = await crawl_sources([s["url"] for s in top_sources])
    used_sources = []
    context_blocks = []
    total_chars = 0

    for source in top_sources:
        page = next((p for p in pages if p["url"] == source["url"]), None)
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
    prompt, sources = await build_rag_prompt(question)
    print("Question:", question)
    print("Sources:", sources)
    print("Prompt:\n", prompt)


if __name__ == "__main__":
    asyncio.run(_demo())
