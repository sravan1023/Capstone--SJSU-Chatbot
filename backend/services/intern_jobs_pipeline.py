"""
Intern Jobs Pipeline

Sources the top 100 internship listings from public.job_listings (populated
by services.job_fetcher), snapshots them into pipeline_runs / jobs_snapshot,
and atomically advances pipeline_state.

The dashboard UI (Intern Jobs Alerts page) reads pipeline_runs + jobs_snapshot
and is unaware of the underlying source.
"""
import os
from datetime import datetime, timezone

import httpx

from services.job_fetcher import run_job_fetch_cycle

# ── Env ───────────────────────────────────────────────────────────────────────
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")
PIPELINE_KEY = os.getenv("PIPELINE_KEY", "intern_jobs_alert")

TOP_LIMIT = 100
HTTP_TIMEOUT = 20.0


# ── Supabase REST helpers ─────────────────────────────────────────────────────

def _sb_headers(prefer: str = "return=representation") -> dict:
    return {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json",
        "Prefer": prefer,
    }


async def _fetch_top_internships(client: httpx.AsyncClient) -> list[dict]:
    """Pull the most recent internships from job_listings, newest first."""
    resp = await client.get(
        f"{SUPABASE_URL}/rest/v1/job_listings",
        params={
            "select": "id,title,company,location,salary,apply_url,posted_date,fetched_at",
            "job_type": "in.(internship,new_grad)",
            "order": "posted_date.desc.nullslast,fetched_at.desc",
            "limit": str(TOP_LIMIT),
        },
        headers=_sb_headers(),
        timeout=HTTP_TIMEOUT,
    )
    if resp.status_code >= 400:
        raise RuntimeError(f"Failed to query job_listings: {resp.status_code} {resp.text[:200]}")
    return resp.json()


async def _insert_pipeline_run(client: httpx.AsyncClient) -> dict:
    resp = await client.post(
        f"{SUPABASE_URL}/rest/v1/pipeline_runs",
        json={"pipeline_key": PIPELINE_KEY, "status": "running"},
        headers=_sb_headers(),
        timeout=HTTP_TIMEOUT,
    )
    if resp.status_code >= 400:
        raise RuntimeError(f"Failed to insert pipeline run: {resp.status_code} {resp.text[:200]}")
    rows = resp.json()
    if not rows:
        raise RuntimeError("Failed to insert pipeline run: empty response")
    return rows[0]


async def _get_pipeline_state(client: httpx.AsyncClient) -> dict | None:
    resp = await client.get(
        f"{SUPABASE_URL}/rest/v1/pipeline_state",
        params={"select": "pipeline_key,previous_top_url", "pipeline_key": f"eq.{PIPELINE_KEY}"},
        headers=_sb_headers(),
        timeout=HTTP_TIMEOUT,
    )
    if resp.status_code >= 400:
        raise RuntimeError(f"Failed to load pipeline state: {resp.status_code} {resp.text[:200]}")
    rows = resp.json()
    return rows[0] if rows else None


async def _insert_jobs_snapshot(client: httpx.AsyncClient, rows: list[dict]) -> None:
    if not rows:
        return
    resp = await client.post(
        f"{SUPABASE_URL}/rest/v1/jobs_snapshot",
        json=rows,
        headers=_sb_headers("return=minimal"),
        timeout=HTTP_TIMEOUT,
    )
    if resp.status_code >= 400:
        raise RuntimeError(f"Failed to insert jobs snapshot: {resp.status_code} {resp.text[:200]}")


async def _call_marker_rpc(
    client: httpx.AsyncClient,
    expected_previous_top_url: str | None,
    new_previous_top_url: str,
    last_run_id: str,
) -> bool:
    resp = await client.post(
        f"{SUPABASE_URL}/rest/v1/rpc/update_pipeline_marker_if_expected",
        json={
            "p_pipeline_key": PIPELINE_KEY,
            "p_expected_previous_top_url": expected_previous_top_url,
            "p_new_previous_top_url": new_previous_top_url,
            "p_last_run_id": last_run_id,
        },
        headers=_sb_headers(),
        timeout=HTTP_TIMEOUT,
    )
    if resp.status_code >= 400:
        raise RuntimeError(f"Failed to update pipeline marker: {resp.status_code} {resp.text[:200]}")
    return bool(resp.json())


async def _update_pipeline_run(client: httpx.AsyncClient, run_id: str, updates: dict) -> None:
    resp = await client.patch(
        f"{SUPABASE_URL}/rest/v1/pipeline_runs",
        json=updates,
        params={"id": f"eq.{run_id}"},
        headers=_sb_headers("return=minimal"),
        timeout=HTTP_TIMEOUT,
    )
    if resp.status_code >= 400:
        raise RuntimeError(f"Failed to finalize pipeline run: {resp.status_code} {resp.text[:200]}")


# ── Pipeline ──────────────────────────────────────────────────────────────────

def _determine_new_jobs(top_rows: list[dict], previous_top_url: str | None) -> list[dict]:
    if not top_rows:
        return []
    if not previous_top_url:
        return top_rows
    for idx, row in enumerate(top_rows):
        if row["apply_url"] == previous_top_url:
            return top_rows[:idx]
    return top_rows


def _to_snapshot_rows(run_id: str, rows: list[dict]) -> list[dict]:
    return [
        {
            "run_id": run_id,
            "rank_position": idx + 1,
            "job_url": row["apply_url"],
            "company": row["company"],
            "title": row["title"],
            "source_record_id": str(row.get("id") or ""),
            "raw_record": row,
        }
        for idx, row in enumerate(rows)
    ]


async def execute_intern_jobs_pipeline() -> dict:
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set.")

    # Refresh job_listings first so the snapshot reflects the latest fetch.
    # Best-effort: a fetcher failure should not block snapshotting existing data.
    try:
        await run_job_fetch_cycle(
            {"role": "intern", "experienceLevel": "intern", "count": 100},
            persist=True,
        )
    except Exception:
        pass

    async with httpx.AsyncClient() as client:
        run_row = await _insert_pipeline_run(client)
        run_id = run_row["id"]

        top_rows: list[dict] = []
        new_rows: list[dict] = []
        previous_top_url: str | None = None
        email_sent = False

        try:
            top_rows = await _fetch_top_internships(client)

            state = await _get_pipeline_state(client)
            previous_top_url = state.get("previous_top_url") if state else None

            new_rows = _determine_new_jobs(top_rows, previous_top_url)

            if top_rows:
                await _insert_jobs_snapshot(client, _to_snapshot_rows(run_id, top_rows))

            if new_rows:
                ok = await _call_marker_rpc(
                    client,
                    expected_previous_top_url=previous_top_url,
                    new_previous_top_url=new_rows[0]["apply_url"],
                    last_run_id=run_id,
                )
                if not ok:
                    raise RuntimeError("Pipeline marker update rejected due to stale previous_top_url (concurrent run).")

            await _update_pipeline_run(client, run_id, {
                "status": "success",
                "top_count": len(top_rows),
                "new_jobs_count": len(new_rows),
                "email_sent": email_sent,
                "error_message": None,
                "finished_at": datetime.now(tz=timezone.utc).isoformat(),
            })

            return {
                "runId": run_id,
                "topCount": len(top_rows),
                "newJobsCount": len(new_rows),
                "emailSent": email_sent,
                "previousTopUrl": previous_top_url,
                "nextTopUrl": new_rows[0]["apply_url"] if new_rows else previous_top_url,
            }

        except Exception as exc:
            message = str(exc) or "Unknown pipeline error"
            try:
                await _update_pipeline_run(client, run_id, {
                    "status": "failed",
                    "top_count": len(top_rows),
                    "new_jobs_count": len(new_rows),
                    "email_sent": email_sent,
                    "error_message": message,
                    "finished_at": datetime.now(tz=timezone.utc).isoformat(),
                })
            except Exception:
                pass
            raise
