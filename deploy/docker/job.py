"""
Job endpoints (enqueue + poll) for long-running LL​M extraction and raw crawl.
Relies on the existing Redis task helpers in api.py
"""

from typing import Dict, Optional, Callable
from fastapi import APIRouter, BackgroundTasks, Depends, Request
from pydantic import BaseModel, HttpUrl

from api import (
    handle_llm_request,
    handle_crawl_job,
    handle_task_status,
)

# ------------- dependency placeholders -------------
_redis = None        # will be injected from server.py
_config = None
_token_dep: Callable = lambda: None  # dummy until injected

# public router
router = APIRouter(prefix="/crawl/jobs", tags=["jobs"])


# === init hook called by server.py =========================================
def init_job_router(redis, config, token_dep) -> APIRouter:
    """Inject shared singletons and return the router for mounting."""
    global _redis, _config, _token_dep
    _redis, _config, _token_dep = redis, config, token_dep
    return router


# ---------- payload models --------------------------------------------------
class LlmJobPayload(BaseModel):
    url:    HttpUrl
    q:      str
    schema: Optional[str] = None
    cache:  bool = False
    provider: Optional[str] = None


class CrawlJobPayload(BaseModel):
    urls:           list[HttpUrl]
    browser_config: Dict = {}
    crawler_config: Dict = {}


# ---------- LL​M job ---------------------------------------------------------
@router.post("/llm", status_code=202)
async def llm_job_enqueue(
        payload: LlmJobPayload,
        background_tasks: BackgroundTasks,
        request: Request,
        _td: Dict = Depends(lambda: _token_dep()),   # late-bound dep
):
    return await handle_llm_request(
        _redis,
        background_tasks,
        request,
        str(payload.url),
        query=payload.q,
        schema=payload.schema,
        cache=payload.cache,
        config=_config,
        provider=payload.provider,
    )


@router.get("/llm/{task_id}")
async def llm_job_status(
    request: Request,
    task_id: str,
    _td: Dict = Depends(lambda: _token_dep())
):
    return await handle_task_status(_redis, task_id)


# ---------- CRAWL job -------------------------------------------------------
@router.post("/crawl/job", status_code=202)
async def crawl_job_enqueue(
        payload: CrawlJobPayload,
        background_tasks: BackgroundTasks,
        _td: Dict = Depends(lambda: _token_dep()),
):
    return await handle_crawl_job(
        _redis,
        background_tasks,
        [str(u) for u in payload.urls],
        payload.browser_config,
        payload.crawler_config,
        config=_config,
    )


@router.get("/{task_id}")
async def crawl_job_status(
    request: Request,
    task_id: str,
    _td: Dict = Depends(lambda: _token_dep())
):
    status_response = await handle_task_status(_redis, task_id, base_url=str(request.base_url))
    if status_response["status"] in ["completed", "failed"]:
        await _redis.srem("active_jobs", task_id)
    return status_response

@router.get("")
async def list_jobs(
    _td: Dict = Depends(lambda: _token_dep()),
    limit: int = 50
):
    """List active and recent jobs."""
    job_ids = await _redis.smembers("active_jobs")
    job_ids = job_ids[:limit]  # Limit for performance
    jobs = []
    for job_id in job_ids:
        task = await _redis.hgetall(f"task:{job_id}")
        if task:
            decoded = decode_redis_hash(task)
            jobs.append({
                "id": job_id,
                "status": decoded["status"],
                "created_at": decoded["created_at"],
                "url": decoded.get("url", "")
            })
    return {"jobs": jobs}

@router.delete("/{task_id}")
async def cancel_job(
    task_id: str,
    _td: Dict = Depends(lambda: _token_dep())
):
    """Mark job as cancelled."""
    await _redis.hset(f"task:{task_id}", mapping={
        "status": "cancelled",
        "error": "Job was cancelled by user"
    })
    await _redis.srem("active_jobs", task_id)
    return {"message": "Job cancelled"}
