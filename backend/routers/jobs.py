from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.intern_jobs_pipeline import execute_intern_jobs_pipeline
from services.job_fetcher import run_job_fetch_cycle

router = APIRouter(tags=["jobs"])


class JobFetchRequest(BaseModel):
    role: str | None = None
    count: int | None = None
    experience_level: str | None = None


@router.post("/jobs/fetch")
async def fetch_jobs(req: JobFetchRequest = JobFetchRequest()):
    """
    Trigger a job fetch cycle. Fetches from the Cloudflare Worker (if
    JOB_FETCHER_API_URL is set) or directly from Supabase job_sources,
    then dedupes and persists to job_listings.
    """
    query = {}
    if req.role:
        query["role"] = req.role
    if req.count:
        query["count"] = req.count
    if req.experience_level:
        query["experienceLevel"] = req.experience_level

    result = await run_job_fetch_cycle(query or None)
    return result


@router.post("/intern-jobs/run")
async def run_intern_jobs_pipeline():
    """
    Execute the intern jobs pipeline: pull top 100 jobs from Airtable,
    snapshot to jobs_snapshot, advance pipeline_state. Used by the
    Intern Jobs Alerts page "Fetch Now" button.
    """
    try:
        result = await execute_intern_jobs_pipeline()
        return {"ok": True, "result": result}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc) or "Unknown pipeline error")
