"""
Job Fetcher — ported from UI/src/services/jobFetcher/

Fetches intern/new-grad job listings from:
  1. Cloudflare Worker (JOB_FETCHER_API_URL env var) — primary path
  2. Job sources table in Supabase — fallback (API and RSS sources)

Normalizes, dedupes, and persists results to the job_listings table.
"""
import asyncio
import hashlib
import os
import re
from datetime import datetime, timezone
from typing import Any
from xml.etree import ElementTree

import httpx

# ── Env ───────────────────────────────────────────────────────────────────────
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")
JOB_FETCHER_API_URL = os.getenv("JOB_FETCHER_API_URL", "")
PERSIST_WORKER_RESULTS = os.getenv("JOB_FETCHER_PERSIST_WORKER_RESULTS", "false").lower() == "true"

FETCH_TIMEOUT = 15.0

# ── Normalize helpers ─────────────────────────────────────────────────────────

_REMOTE_STATUSES = {"remote", "hybrid", "onsite", "unknown"}
_JOB_TYPES = {"internship", "new_grad", "full_time", "part_time", "contract", "other"}

# ── US location filter ────────────────────────────────────────────────────────

_US_STATE_ABBRS = {
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
    "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
    "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
    "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
    "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
    "DC",
}

_US_KEYWORDS = {
    "united states", "usa", "us-remote", "u.s.", "remote - us",
    "remote, us", "remote (us)", "remote/us", "remote — us",
}

_NON_US_KEYWORDS = {
    "united kingdom", "uk", "canada", "germany", "france", "spain",
    "netherlands", "india", "australia", "brazil", "japan", "ireland",
    "singapore", "israel", "argentina", "switzerland", "sweden",
    "denmark", "norway", "finland", "austria", "belgium", "italy",
    "portugal", "mexico", "luxembourg", "czech", "romania", "poland",
    "china", "korea", "taiwan", "hong kong", "philippines", "vietnam",
    "indonesia", "thailand", "south africa", "nigeria", "kenya",
    "colombia", "chile", "peru", "egypt", "turkey", "saudi",
    "uae", "dubai", "qatar", "toronto", "vancouver", "montreal",
    "calgary", "ottawa", "london, uk", "bangalore", "hyderabad",
    "mumbai", "delhi", "berlin", "amsterdam", "paris", "dublin",
    "sydney", "melbourne", "tel aviv",
}

# Canadian province abbreviations that clash with US state codes ("CA" = California vs Canada)
_CA_PROVINCE_ABBRS = {"AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"}


def _is_us_location(location: str | None) -> bool:
    """Return True if the location string looks like it's in the US, or if
    location is empty/unknown (keep it rather than discard)."""
    if not location or not location.strip():
        return True  # unknown location — keep it

    loc = location.strip().lower()

    # Explicit US indicators
    for kw in _US_KEYWORDS:
        if kw in loc:
            return True

    # Explicit non-US indicators — reject
    for kw in _NON_US_KEYWORDS:
        if kw in loc:
            return False

    # Check for US state abbreviation at end: "San Francisco, CA"
    # But first reject if a Canadian province appears ("Toronto, ON, CA" → not US)
    parts = [p.strip() for p in re.split(r"[,;|]", loc) if p.strip()]
    has_ca_province = any(p.strip().upper() in _CA_PROVINCE_ABBRS for p in parts)
    if has_ca_province:
        return False
    for part in parts:
        token = part.upper().strip()
        if token in _US_STATE_ABBRS:
            return True
        # Also check last word: "Menlo Park CA"
        last_word = token.split()[-1] if token.split() else ""
        if last_word in _US_STATE_ABBRS:
            return True

    # Check for full US state names
    _US_STATE_NAMES = {
        "alabama", "alaska", "arizona", "arkansas", "california", "colorado",
        "connecticut", "delaware", "florida", "georgia", "hawaii", "idaho",
        "illinois", "indiana", "iowa", "kansas", "kentucky", "louisiana",
        "maine", "maryland", "massachusetts", "michigan", "minnesota",
        "mississippi", "missouri", "montana", "nebraska", "nevada",
        "new hampshire", "new jersey", "new mexico", "new york",
        "north carolina", "north dakota", "ohio", "oklahoma", "oregon",
        "pennsylvania", "rhode island", "south carolina", "south dakota",
        "tennessee", "texas", "utah", "vermont", "virginia", "washington",
        "west virginia", "wisconsin", "wyoming", "district of columbia",
    }
    for state in _US_STATE_NAMES:
        if state in loc:
            return True

    # "Remote" alone — keep
    if loc in ("remote", "remote work", "anywhere"):
        return True

    return False


def _to_slug(value: str) -> str:
    s = str(value).strip().lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-")


def _parse_date_only(value: Any) -> str | None:
    if not value:
        return None
    if isinstance(value, str) and re.match(r"^\d{4}-\d{2}-\d{2}$", value):
        return value
    try:
        if isinstance(value, (int, float)) or (isinstance(value, str) and value.isdigit()):
            n = float(value)
            ts = n if n > 1e10 else n * 1000
            dt = datetime.fromtimestamp(ts / 1000, tz=timezone.utc)
        else:
            dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return dt.strftime("%Y-%m-%d")
    except (ValueError, OSError, OverflowError):
        return None


def _normalize_remote_status(value: str) -> str:
    slug = _to_slug(value)
    if slug in _REMOTE_STATUSES:
        return slug
    if "remote" in slug:
        return "remote"
    if "hybrid" in slug:
        return "hybrid"
    if "on-site" in slug or "onsite" in slug:
        return "onsite"
    return "unknown"


def _normalize_job_type(value: str) -> str:
    slug = _to_slug(value)
    if slug in _JOB_TYPES:
        return slug
    # Use word-boundary regex to avoid "internal"/"international" → internship
    if re.search(r"\bintern(ship)?\b", slug):
        return "internship"
    if "new-grad" in slug or "entry" in slug:
        return "new_grad"
    if "full" in slug:
        return "full_time"
    if "part" in slug:
        return "part_time"
    if "contract" in slug:
        return "contract"
    return "other"


def build_dedupe_hash(title: str, company: str) -> str:
    """Must match the DB generated column: md5(lower(trim(title)) || '|' || lower(trim(company)))"""
    clean = (title or "").strip().lower() + "|" + (company or "").strip().lower()
    return hashlib.md5(clean.encode()).hexdigest()


def normalize_job(job: dict, source: dict) -> dict:
    title = str(job.get("title") or job.get("position") or "Untitled role").strip()
    company = str(job.get("company") or source.get("name") or "Unknown Company").strip()
    apply_url = str(job.get("apply_url") or job.get("url") or source.get("source_url") or "").strip()
    id_base = f"{title}-{company}-{apply_url or datetime.now().isoformat()}"

    # Build a rich text blob for job_type inference (title + explicit type + levels)
    job_type_hint = " ".join(filter(None, [
        str(job.get("job_type") or job.get("type") or ""),
        title,
        str(job.get("experience_level") or job.get("levels") or ""),
    ]))

    return {
        "external_id": job.get("id") or job.get("external_id") or _to_slug(id_base),
        "title": title,
        "company": company,
        "location": str(job.get("location") or job.get("locations") or "").strip() or None,
        "remote_status": _normalize_remote_status(str(job.get("remote_status") or job.get("remote") or "")),
        "job_type": _normalize_job_type(job_type_hint),
        "salary": str(job.get("salary") or "").strip() or None,
        "experience_level": str(job.get("experience_level") or job.get("experience") or "").strip() or None,
        "tags": [str(t).lower() for t in (job.get("tags") or []) if t],
        "description": str(job.get("description") or job.get("summary") or "").strip() or None,
        "apply_url": apply_url,
        "source_name": source.get("name"),
        "source_url": source.get("source_url"),
        "posted_date": _parse_date_only(job.get("posted_date") or job.get("pubDate") or job.get("published_at")),
        "fetched_at": datetime.now(tz=timezone.utc).isoformat(),
        "dedupe_hash": build_dedupe_hash(title, company),
    }


# ── Dedupe ────────────────────────────────────────────────────────────────────

def _normalize_title_for_fuzzy(title: str) -> str:
    t = title.strip().lower()
    t = re.sub(r"\b(internship|intern|new\s*grad|full\s*time|part\s*time|engineer|developer)\b", "", t)
    t = re.sub(r"[^a-z0-9\s]", "", t)
    return re.sub(r"\s+", " ", t).strip()


def _fuzzy_signature(title: str, company: str) -> str:
    clean_title = _normalize_title_for_fuzzy(title)
    clean_company = re.sub(r"\b(inc|llc|corp|corporation|ltd)\b", "", company.strip().lower()).strip()
    return f"{clean_title}|{clean_company}"


def dedupe_jobs(jobs: list[dict]) -> list[dict]:
    by_url: set[str] = set()
    by_hash: set[str] = set()
    by_fuzzy: set[str] = set()
    unique = []

    for job in jobs:
        url_key = str(job.get("apply_url") or "").strip().lower()
        hash_key = build_dedupe_hash(job.get("title", ""), job.get("company", ""))
        fuzzy_key = _fuzzy_signature(job.get("title", ""), job.get("company", ""))

        if url_key and url_key in by_url:
            continue
        if hash_key in by_hash:
            continue
        if fuzzy_key and fuzzy_key in by_fuzzy:
            continue

        if url_key:
            by_url.add(url_key)
        by_hash.add(hash_key)
        if fuzzy_key:
            by_fuzzy.add(fuzzy_key)

        unique.append({**job, "dedupe_hash": hash_key})

    return unique


# ── Adapters ──────────────────────────────────────────────────────────────────

def _get_by_path(obj: Any, path: str | None) -> Any:
    if not path:
        return obj
    for key in path.split("."):
        if obj is None:
            return None
        if isinstance(obj, dict):
            obj = obj.get(key)
        else:
            return None
    return obj


def _build_url_with_query(source: dict, query: dict | None) -> str:
    url = source["source_url"]
    config = source.get("config") or {}
    query_map = config.get("query_map") or {}
    defaults = config.get("query_defaults") or {}

    params = dict(defaults)
    if query:
        if query.get("role") and query_map.get("role"):
            params[query_map["role"]] = query["role"]
        if query.get("count") and query_map.get("count"):
            params[query_map["count"]] = str(query["count"])

    if params:
        from urllib.parse import urlencode, urlparse, urlunparse, parse_qs
        parsed = urlparse(url)
        existing = parse_qs(parsed.query, keep_blank_values=True)
        existing.update({k: [v] for k, v in params.items()})
        flat = {k: v[0] for k, v in existing.items()}
        url = urlunparse(parsed._replace(query=urlencode(flat)))

    return url


def _matches_role(job: dict, role: str | None) -> bool:
    if not role:
        return True
    haystack = " ".join([
        str(job.get("title") or ""),
        str(job.get("description") or ""),
        str(job.get("company") or ""),
        " ".join(job.get("tags") or []),
    ]).lower()
    tokens = [t.strip() for t in role.lower().split() if len(t.strip()) > 2]
    if not tokens:
        return True
    return any(t in haystack for t in tokens)


def _matches_experience(job: dict, level: str | None) -> bool:
    if not level:
        return True
    haystack = " ".join([
        str(job.get("title") or ""),
        str(job.get("description") or ""),
        " ".join(job.get("tags") or []),
    ]).lower()
    if level == "intern":
        return "intern" in haystack
    if level in ("new-grad", "entry-level"):
        kws = ["new grad", "graduate", "entry", "junior", "associate", "early career"]
        return any(kw in haystack for kw in kws)
    return True


def _apply_query_filters(jobs: list[dict], query: dict | None) -> list[dict]:
    if not query:
        return jobs
    filtered = [j for j in jobs if _matches_role(j, query.get("role")) and _matches_experience(j, query.get("experienceLevel"))]
    count = max(1, min(100, int(query.get("count") or 30)))
    return filtered[:count]


async def _run_api_adapter(client: httpx.AsyncClient, source: dict, query: dict | None) -> list[dict]:
    url = _build_url_with_query(source, query)
    resp = await client.get(url, timeout=FETCH_TIMEOUT)
    resp.raise_for_status()
    body = resp.json()
    config = source.get("config") or {}
    rows = _get_by_path(body, config.get("response_path")) or body
    items = rows if isinstance(rows, list) else []
    field_map = config.get("field_map") or {}

    mapped = []
    for item in items:
        merged = {**item}
        for target, path in field_map.items():
            merged[target] = _get_by_path(item, path)
        # Flatten array-of-dicts fields (e.g. The Muse 'levels', 'locations')
        for key in ("levels", "locations", "categories"):
            val = merged.get(key)
            if isinstance(val, list) and val and isinstance(val[0], dict):
                merged[key] = " ".join(v.get("name") or v.get("short_name") or "" for v in val)
        if (merged.get("title") or merged.get("position")) and (merged.get("apply_url") or merged.get("url")):
            mapped.append(merged)

    return _apply_query_filters(mapped, query)


# ── ATS Connectors (Greenhouse, Lever, Ashby) ─────────────────────────────────
#
# Company boards are stored in the ats_registry Supabase table — no hard-coded
# slugs.  Each fetch cycle reads the registry, then auto-discovers new boards
# by probing company-name slugs found from direct API sources.

_ATS_BASE_URLS = {
    "greenhouse": "https://boards-api.greenhouse.io/v1/boards",
    "lever":      "https://api.lever.co/v0/postings",
    "ashby":      "https://api.ashbyhq.com/posting-api/job-board",
}

# Regex: matches "intern" or "internship" but NOT "internal"/"international"
_INTERN_RE = re.compile(r"\bintern(?:ship)?\b", re.IGNORECASE)

_ATS_CONCURRENCY = 15      # max parallel requests for fetching
_DISCOVER_CONCURRENCY = 10  # max parallel requests for probing
_DISCOVER_BATCH = 40        # max new slugs to probe per cycle
_REPROBE_DAYS = 7           # re-probe not-found slugs after N days


# ── Registry helpers ──────────────────────────────────────────────────────────

async def _get_ats_registry(client: httpx.AsyncClient, *, active_only: bool = True) -> list[dict]:
    """Read the ATS company registry from Supabase."""
    params: dict = {"select": "slug,ats,display_name,found,last_probed_at"}
    if active_only:
        params["found"] = "eq.true"
        params["enabled"] = "eq.true"
    try:
        resp = await client.get(
            f"{SUPABASE_URL}/rest/v1/ats_registry",
            params=params,
            headers=_sb_headers(),
            timeout=10.0,
        )
        if resp.status_code >= 400:
            return []
        return resp.json()
    except Exception:
        return []


async def _upsert_ats_registry(client: httpx.AsyncClient, rows: list[dict]) -> None:
    """Upsert rows into ats_registry (slug,ats unique)."""
    if not rows:
        return
    try:
        await client.post(
            f"{SUPABASE_URL}/rest/v1/ats_registry",
            json=rows,
            params={"on_conflict": "slug,ats"},
            headers={**_sb_headers(), "Prefer": "resolution=merge-duplicates,return=minimal"},
            timeout=15.0,
        )
    except Exception:
        pass


def _slugify_company(name: str) -> str:
    """Convert a company display name to a probable ATS board slug."""
    s = name.strip().lower()
    s = re.sub(r"\b(inc|llc|corp|corporation|ltd|co|company|technologies|technology|labs|group)\b\.?", "", s)
    s = s.replace("&", "and")
    s = re.sub(r"[^a-z0-9\s-]", "", s)
    s = re.sub(r"\s+", "-", s.strip())
    s = re.sub(r"-+", "-", s).strip("-")
    return s


async def _probe_one_slug(
    client: httpx.AsyncClient, slug: str, ats: str, sem: asyncio.Semaphore,
) -> bool:
    """Return True if the slug has a live job board on the given ATS."""
    async with sem:
        try:
            if ats == "greenhouse":
                r = await client.get(f"{_ATS_BASE_URLS['greenhouse']}/{slug}/jobs", timeout=10)
                return r.status_code == 200 and bool(r.json().get("jobs"))
            elif ats == "lever":
                r = await client.get(f"{_ATS_BASE_URLS['lever']}/{slug}?mode=json", timeout=10)
                return r.status_code == 200 and isinstance(r.json(), list) and len(r.json()) > 0
            elif ats == "ashby":
                r = await client.get(f"{_ATS_BASE_URLS['ashby']}/{slug}", timeout=10)
                return r.status_code == 200 and bool(r.json().get("jobs"))
        except Exception:
            pass
    return False


async def _discover_ats_slugs(
    client: httpx.AsyncClient, company_names: set[str],
) -> list[dict]:
    """Probe company-name slugs against all 3 ATS platforms and persist
    discovered boards to ats_registry.  Returns newly found entries."""
    # Fetch the full registry (including not-found) to avoid re-probing
    all_entries = await _get_ats_registry(client, active_only=False)
    now = datetime.now(tz=timezone.utc)
    recently_probed: set[tuple[str, str]] = set()
    for e in all_entries:
        probed = e.get("last_probed_at")
        if probed:
            try:
                dt = datetime.fromisoformat(probed.replace("Z", "+00:00"))
                if (now - dt).days < _REPROBE_DAYS:
                    recently_probed.add((e["slug"], e["ats"]))
            except Exception:
                recently_probed.add((e["slug"], e["ats"]))
        else:
            recently_probed.add((e["slug"], e["ats"]))

    # Build candidate slugs from company names
    candidates: dict[str, str] = {}  # slug → display_name
    for name in company_names:
        slug = _slugify_company(name)
        if slug and len(slug) >= 2 and slug not in candidates:
            candidates[slug] = name

    # Filter out already recently-probed
    new_pairs: list[tuple[str, str, str]] = []  # (slug, ats, display)
    for slug, display in candidates.items():
        for ats in ("greenhouse", "lever", "ashby"):
            if (slug, ats) not in recently_probed:
                new_pairs.append((slug, ats, display))

    if not new_pairs:
        return []

    # Limit batch size
    new_pairs = new_pairs[:_DISCOVER_BATCH * 3]

    sem = asyncio.Semaphore(_DISCOVER_CONCURRENCY)
    probe_results = await asyncio.gather(
        *[_probe_one_slug(client, slug, ats, sem) for slug, ats, _ in new_pairs]
    )

    upsert_rows: list[dict] = []
    discovered: list[dict] = []
    for (slug, ats, display), found in zip(new_pairs, probe_results):
        row = {
            "slug": slug,
            "ats": ats,
            "display_name": display,
            "found": found,
            "enabled": True,
            "last_probed_at": now.isoformat(),
        }
        upsert_rows.append(row)
        if found:
            discovered.append({"slug": slug, "ats": ats, "display": display})

    await _upsert_ats_registry(client, upsert_rows)
    return discovered


# ── ATS fetch (reads from registry) ──────────────────────────────────────────

def _normalize_greenhouse_job(job: dict, display: str) -> dict:
    loc = job.get("location", {})
    location = loc.get("name", "") if isinstance(loc, dict) else str(loc or "")
    return {
        "id": str(job.get("id", "")),
        "title": job.get("title", ""),
        "company": display,
        "location": location,
        "apply_url": job.get("absolute_url", ""),
        "posted_date": job.get("updated_at") or job.get("first_published"),
    }


def _normalize_lever_job(job: dict, display: str) -> dict:
    cats = job.get("categories") or {}
    return {
        "id": str(job.get("id", "")),
        "title": job.get("text", ""),
        "company": display,
        "location": cats.get("location", ""),
        "apply_url": job.get("hostedUrl") or job.get("applyUrl", ""),
        "posted_date": job.get("createdAt"),
        "tags": [cats.get("team", ""), cats.get("department", "")],
    }


def _normalize_ashby_job(job: dict, display: str) -> dict:
    loc = job.get("location") or ""
    if job.get("isRemote") and "remote" not in loc.lower():
        loc = f"{loc}, Remote" if loc else "Remote"
    return {
        "id": str(job.get("id", "")),
        "title": job.get("title", ""),
        "company": display,
        "location": loc,
        "apply_url": job.get("jobUrl") or job.get("applyUrl", ""),
        "posted_date": job.get("publishedAt"),
        "remote_status": "remote" if job.get("isRemote") else "",
    }


async def _fetch_one_ats_board(
    client: httpx.AsyncClient, co: dict, sem: asyncio.Semaphore,
) -> list[dict]:
    """Fetch intern-titled jobs from a single company's ATS board."""
    slug, ats, display = co["slug"], co["ats"], co["display"]
    async with sem:
        try:
            if ats == "greenhouse":
                url = f"{_ATS_BASE_URLS['greenhouse']}/{slug}/jobs"
                resp = await client.get(url, timeout=FETCH_TIMEOUT)
                if resp.status_code != 200:
                    return []
                return [
                    _normalize_greenhouse_job(j, display)
                    for j in resp.json().get("jobs", [])
                    if _INTERN_RE.search(j.get("title") or "")
                ]
            elif ats == "lever":
                url = f"{_ATS_BASE_URLS['lever']}/{slug}?mode=json"
                resp = await client.get(url, timeout=FETCH_TIMEOUT)
                if resp.status_code != 200:
                    return []
                data = resp.json()
                return [
                    _normalize_lever_job(j, display)
                    for j in (data if isinstance(data, list) else [])
                    if _INTERN_RE.search(j.get("text") or "")
                ]
            elif ats == "ashby":
                url = f"{_ATS_BASE_URLS['ashby']}/{slug}"
                resp = await client.get(url, timeout=FETCH_TIMEOUT)
                if resp.status_code != 200:
                    return []
                return [
                    _normalize_ashby_job(j, display)
                    for j in resp.json().get("jobs", [])
                    if _INTERN_RE.search(j.get("title") or "")
                ]
        except Exception:
            pass
    return []


async def _fetch_ats_internships(client: httpx.AsyncClient, registry: list[dict]) -> list[dict]:
    """Fetch intern-titled jobs from all active ATS boards (concurrent)."""
    if not registry:
        return []
    boards = [{"slug": r["slug"], "ats": r["ats"], "display": r.get("display") or r.get("display_name", r["slug"])} for r in registry]
    sem = asyncio.Semaphore(_ATS_CONCURRENCY)
    batches = await asyncio.gather(
        *[_fetch_one_ats_board(client, co, sem) for co in boards]
    )
    return [job for batch in batches for job in batch]


async def _run_rss_adapter(client: httpx.AsyncClient, source: dict) -> list[dict]:
    resp = await client.get(source["source_url"], timeout=FETCH_TIMEOUT)
    resp.raise_for_status()
    config = source.get("config") or {}
    root = ElementTree.fromstring(resp.text)
    items = root.findall(".//item")
    jobs = []
    for item in items:
        def _t(tag: str) -> str:
            el = item.find(tag)
            return el.text.strip() if el is not None and el.text else ""
        jobs.append({
            "title": _t("title"),
            "description": _t("description"),
            "url": _t("link"),
            "company": config.get("default_company") or source.get("name", ""),
            "location": config.get("default_location") or "",
            "remote_status": config.get("default_remote_status") or "unknown",
            "job_type": config.get("default_job_type") or "other",
            "tags": config.get("tag_map") or [],
            "pubDate": _t("pubDate"),
        })
    return jobs


async def fetch_jobs_from_source(client: httpx.AsyncClient, source: dict, query: dict | None) -> list[dict]:
    if not source.get("enabled"):
        return []
    stype = source.get("source_type", "")
    if stype == "api":
        return await _run_api_adapter(client, source, query)
    if stype == "rss":
        return await _run_rss_adapter(client, source)
    return []  # html/mock sources require a dedicated scraper


# ── Supabase helpers ──────────────────────────────────────────────────────────

def _sb_headers() -> dict:
    return {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }


async def _get_job_sources(client: httpx.AsyncClient) -> list[dict]:
    resp = await client.get(
        f"{SUPABASE_URL}/rest/v1/job_sources",
        params={"select": "*", "order": "created_at.desc"},
        headers=_sb_headers(),
        timeout=10.0,
    )
    resp.raise_for_status()
    return resp.json()


async def _get_existing_matches(client: httpx.AsyncClient, dedupe_hashes: list[str]) -> list[dict]:
    if not dedupe_hashes:
        return []
    resp = await client.get(
        f"{SUPABASE_URL}/rest/v1/job_listings",
        params={"select": "id,apply_url,dedupe_hash", "dedupe_hash": f"in.({','.join(dedupe_hashes)})"},
        headers=_sb_headers(),
        timeout=10.0,
    )
    resp.raise_for_status()
    return resp.json()


async def _insert_job_listings(client: httpx.AsyncClient, rows: list[dict]) -> list[dict]:
    if not rows:
        return []
    sanitized = []
    seen_urls: set[str] = set()
    for row in rows:
        url_key = str(row.get("apply_url") or "").strip().lower()
        if not url_key or url_key in seen_urls:
            continue
        seen_urls.add(url_key)
        copy = {k: v for k, v in row.items() if k not in ("id", "dedupe_hash")}
        sanitized.append(copy)

    resp = await client.post(
        f"{SUPABASE_URL}/rest/v1/job_listings",
        json=sanitized,
        params={"on_conflict": "dedupe_hash"},
        headers={**_sb_headers(), "Prefer": "resolution=merge-duplicates,return=representation"},
        timeout=15.0,
    )
    resp.raise_for_status()
    return resp.json()


async def _create_fetch_run(client: httpx.AsyncClient, status: str, started_at: str) -> str | None:
    resp = await client.post(
        f"{SUPABASE_URL}/rest/v1/job_fetch_runs",
        json={"source_id": None, "status": status, "started_at": started_at},
        headers=_sb_headers(),
        timeout=10.0,
    )
    resp.raise_for_status()
    rows = resp.json()
    return rows[0]["id"] if rows else None


async def _update_fetch_run(client: httpx.AsyncClient, run_id: str, updates: dict) -> None:
    await client.patch(
        f"{SUPABASE_URL}/rest/v1/job_fetch_runs",
        json=updates,
        params={"id": f"eq.{run_id}"},
        headers=_sb_headers(),
        timeout=10.0,
    )


# ── Main entry point ──────────────────────────────────────────────────────────

async def run_job_fetch_cycle(query: dict | None = None, *, persist: bool | None = None) -> dict:
    """
    Fetch jobs from the configured source (Worker or Supabase sources),
    dedupe, and persist to job_listings.

    Args:
        persist: If True, always persist worker results. If None, falls back
                 to the JOB_FETCHER_PERSIST_WORKER_RESULTS env var.

    Returns a summary dict with counts.
    """
    now = datetime.now(tz=timezone.utc)
    jobs: list[dict] = []

    async with httpx.AsyncClient() as client:
        # 1. Fetch raw jobs
        if JOB_FETCHER_API_URL:
            from urllib.parse import urlencode, urlparse, urlunparse
            url = JOB_FETCHER_API_URL
            params = {}
            if query:
                if query.get("role"):
                    params["role"] = query["role"]
                if query.get("count"):
                    params["count"] = str(query["count"])
                if query.get("experienceLevel"):
                    params["experienceLevel"] = query["experienceLevel"]
            if params:
                parsed = urlparse(url)
                from urllib.parse import urlencode
                url = urlunparse(parsed._replace(query=urlencode(params)))

            resp = await client.get(url, timeout=FETCH_TIMEOUT)
            resp.raise_for_status()
            body = resp.json()
            jobs = body.get("jobs", []) if isinstance(body, dict) else body

            should_persist = persist if persist is not None else PERSIST_WORKER_RESULTS
            if not should_persist:
                return {
                    "ranAt": now.isoformat(),
                    "source": "worker",
                    "fetched": len(jobs),
                    "inserted": 0,
                    "deduped": 0,
                    "persisted": False,
                    "jobs": jobs,
                }
        else:
            # Fallback: fetch directly from known public APIs, then
            # supplement with any enabled job_sources in Supabase.
            direct_sources = [
                {
                    "name": "RemoteOK",
                    "source_type": "api",
                    "source_url": "https://remoteok.com/api",
                    "config": {"response_path": None},
                    "enabled": True,
                },
                {
                    "name": "Remotive",
                    "source_type": "api",
                    "source_url": "https://remotive.com/api/remote-jobs",
                    "config": {"response_path": "jobs"},
                    "enabled": True,
                },
                {
                    "name": "Arbeitnow",
                    "source_type": "api",
                    "source_url": "https://www.arbeitnow.com/api/job-board-api",
                    "config": {"response_path": "data"},
                    "enabled": True,
                },
                {
                    "name": "The Muse",
                    "source_type": "api",
                    "source_url": "https://www.themuse.com/api/public/jobs?level=Internship&level=Entry%20Level&page=0",
                    "config": {"response_path": "results", "pages": 5, "field_map": {
                        "title": "name",
                        "company": "company.name",
                        "apply_url": "refs.landing_page",
                        "posted_date": "publication_date",
                    }},
                    "enabled": True,
                },
            ]

            for source in direct_sources:
                try:
                    pages = source.get("config", {}).get("pages", 1)
                    base_url = source["source_url"]
                    for page in range(pages):
                        if pages > 1:
                            source = {**source, "source_url": base_url.replace("page=0", f"page={page}")}
                        raw = await _run_api_adapter(client, source, query)
                        jobs.extend([normalize_job(j, source) for j in raw])
                        if not raw:
                            break
                except Exception:
                    pass

            # ATS boards: read registry from DB, discover new boards, then fetch
            try:
                ats_source = {"name": "ATS Board", "source_url": "ats-boards"}
                # Collect company names from jobs fetched so far for discovery
                company_names = {j.get("company", "") for j in jobs if j.get("company")}
                # Probe new company slugs against all 3 ATS platforms
                newly_found = await _discover_ats_slugs(client, company_names)
                # Read full active registry (seed + previously discovered + just discovered)
                registry = await _get_ats_registry(client)
                # Merge in any just-discovered boards not yet in the registry query
                known_keys = {(r["slug"], r["ats"]) for r in registry}
                for nf in newly_found:
                    if (nf["slug"], nf["ats"]) not in known_keys:
                        registry.append({"slug": nf["slug"], "ats": nf["ats"], "display_name": nf["display"]})
                ats_raw = await _fetch_ats_internships(client, registry)
                jobs.extend([normalize_job(j, ats_source) for j in ats_raw])
            except Exception:
                pass

            # Also pull from any user-configured DB sources
            try:
                db_sources = await _get_job_sources(client)
                for source in db_sources:
                    if not source.get("enabled"):
                        continue
                    next_fetch = source.get("next_fetch_at")
                    if next_fetch and datetime.fromisoformat(next_fetch.replace("Z", "+00:00")) > now:
                        continue
                    try:
                        raw = await fetch_jobs_from_source(client, source, query)
                        jobs.extend([normalize_job(j, source) for j in raw])
                    except Exception:
                        pass
            except Exception:
                pass

            jobs = dedupe_jobs(jobs)

        # 2. Filter out invalid jobs
        valid_jobs = [
            {**j, "fetched_at": now.isoformat()}
            for j in jobs
            if j.get("title") and j.get("company") and j.get("apply_url")
        ]

        # 2b. US-only location filter
        valid_jobs = [j for j in valid_jobs if _is_us_location(j.get("location", ""))]

        if not valid_jobs:
            return {"ranAt": now.isoformat(), "source": "sources", "fetched": 0, "inserted": 0, "deduped": 0, "persisted": True}

        # 3. Create run record
        run_id = await _create_fetch_run(client, "partial", now.isoformat())

        # 4. Upsert all valid jobs (merge-duplicates updates existing rows)
        inserted = await _insert_job_listings(client, valid_jobs)

        # 5. Close run record
        if run_id:
            await _update_fetch_run(client, run_id, {
                "status": "success",
                "fetched_count": len(valid_jobs),
                "inserted_count": len(inserted),
                "deduped_count": 0,
                "completed_at": datetime.now(tz=timezone.utc).isoformat(),
            })

        return {
            "ranAt": now.isoformat(),
            "source": "worker" if JOB_FETCHER_API_URL else "sources",
            "fetched": len(valid_jobs),
            "inserted": len(inserted),
            "deduped": 0,
            "persisted": True,
        }
