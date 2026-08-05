import uuid
from datetime import datetime, timezone

from fastapi import BackgroundTasks, HTTPException
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import decrypt_json, encrypt_json, redact, sign_live_token
from app.models.audit_log import AuditLog
from app.models.task import Task
from app.schemas.internal import AuditLogRequest, ClaimRequest, ResolvedTask, StatusUpdateRequest
from app.schemas.task import TaskCreateRequest, TaskCreateResponse, TaskStatusResponse
from app.services import proxy_service, queue_service
from app.services.model_service import resolve_model
from app.services.webhook_service import dispatch_webhook


def _live_url(task_id: uuid.UUID) -> str:
    """Points at the HTML viewer page (routes/live.py: live_view_page), not
    the raw WebSocket endpoint — a browser can't "open" a bare WS URL."""
    token = sign_live_token(str(task_id))
    return f"{get_settings().public_base_url}/v1/live/{task_id}/view?token={token}"


def _get_task_or_404(db: Session, task_id: uuid.UUID) -> Task:
    task = db.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="task not found")
    return task


def create_task(db: Session, body: TaskCreateRequest) -> TaskCreateResponse:
    proxy, proxy_source = proxy_service.resolve_proxy(body.proxy)
    model = resolve_model(body.model)
    settings = get_settings()

    task = Task(
        url=body.url,
        instruction=body.instruction,
        credentials_enc=encrypt_json(body.credentials.model_dump() if body.credentials else None),
        proxy_enc=encrypt_json(proxy),
        proxy_source=proxy_source,
        model=model,
        max_steps=body.max_steps or settings.max_agent_steps,
        timeout_seconds=body.timeout_seconds or 600,
        webhook_url=body.webhook_url,
        status="queued",
    )
    db.add(task)
    db.commit()
    db.refresh(task)

    db.add(AuditLog(task_id=task.id, step_index=0, type="queued", payload=redact({"url": body.url})))
    db.commit()

    queue_service.publish_task(str(task.id))

    return TaskCreateResponse(task_id=task.id, status=task.status, live_url=_live_url(task.id))


def get_task(db: Session, task_id: uuid.UUID) -> TaskStatusResponse:
    task = _get_task_or_404(db, task_id)
    return TaskStatusResponse(
        task_id=task.id,
        status=task.status,
        wait_reason=task.wait_reason,
        control_state=task.control_state,
        url=task.url,
        instruction=task.instruction,
        model=task.model,
        proxy_source=task.proxy_source,
        result=task.result,
        error=task.error,
        created_at=task.created_at,
        started_at=task.started_at,
        completed_at=task.completed_at,
        live_url=_live_url(task.id),
    )


def continue_task(db: Session, task_id: uuid.UUID) -> dict:
    task = _get_task_or_404(db, task_id)
    if task.status != "waiting_input":
        raise HTTPException(status_code=409, detail=f"task is '{task.status}', not waiting on input")

    task.control_state = "agent"
    task.status = "running"
    task.wait_reason = None
    db.add(AuditLog(task_id=task.id, step_index=0, type="human_release", payload={}))
    db.commit()

    queue_service.publish_control_signal(str(task_id), "resume")
    return {"task_id": str(task_id), "status": task.status}


# --- internal endpoints, called by the worker service ---


def claim_task(db: Session, task_id: uuid.UUID, body: ClaimRequest) -> ResolvedTask:
    task = _get_task_or_404(db, task_id)

    task.assigned_worker = body.worker_addr
    task.status = "running"
    task.started_at = task.started_at or datetime.now(timezone.utc)
    db.commit()

    queue_service.set_worker_addr(str(task_id), body.worker_addr)

    return ResolvedTask(
        task_id=task.id,
        url=task.url,
        instruction=task.instruction,
        credentials=decrypt_json(task.credentials_enc),
        proxy=decrypt_json(task.proxy_enc),
        model=task.model,
        max_steps=task.max_steps,
        timeout_seconds=task.timeout_seconds,
    )


def update_status(db: Session, background: BackgroundTasks, task_id: uuid.UUID, body: StatusUpdateRequest) -> dict:
    task = _get_task_or_404(db, task_id)

    # Use model_fields_set, not "is not None": a resume explicitly sends
    # wait_reason=null to CLEAR it, which "is not None" would silently ignore,
    # leaving the task stuck showing wait_reason="human_takeover" forever.
    provided = body.model_fields_set
    if "status" in provided:
        task.status = body.status
        if body.status in ("completed", "failed"):
            task.completed_at = datetime.now(timezone.utc)
    if "wait_reason" in provided:
        task.wait_reason = body.wait_reason
    if "control_state" in provided:
        task.control_state = body.control_state
    if "assigned_worker" in provided:
        task.assigned_worker = body.assigned_worker
    if "result" in provided:
        task.result = body.result
    if "error" in provided:
        task.error = body.error
    db.commit()

    if body.status in ("completed", "failed") and task.webhook_url:
        payload = {
            "task_id": str(task.id),
            "status": task.status,
            "result": task.result,
            "error": task.error,
        }
        background.add_task(dispatch_webhook, task.id, task.webhook_url, payload)

    return {"ok": True}


def append_audit(db: Session, task_id: uuid.UUID, body: AuditLogRequest) -> dict:
    _get_task_or_404(db, task_id)
    db.add(AuditLog(task_id=task_id, step_index=body.step_index, type=body.type, payload=redact(body.payload)))
    db.commit()
    return {"ok": True}
