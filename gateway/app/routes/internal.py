import uuid

from fastapi import APIRouter, BackgroundTasks, Depends
from sqlalchemy.orm import Session

from app.controllers import task_controller
from app.core.security import require_internal_secret
from app.db.session import get_db
from app.schemas.internal import AuditLogRequest, ClaimRequest, ResolvedTask, StatusUpdateRequest

router = APIRouter(prefix="/internal/tasks", tags=["internal"], dependencies=[Depends(require_internal_secret)])


@router.post("/{task_id}/claim", response_model=ResolvedTask)
def claim_task(task_id: uuid.UUID, body: ClaimRequest, db: Session = Depends(get_db)):
    """Worker calls this right after popping the task off the queue: records
    which worker/pod owns the task (for live-view WS routing) and gets back
    the decrypted url/instruction/credentials/proxy/model to execute with."""
    return task_controller.claim_task(db, task_id, body)


@router.post("/{task_id}/status")
def update_status(
    task_id: uuid.UUID,
    body: StatusUpdateRequest,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
):
    return task_controller.update_status(db, background, task_id, body)


@router.post("/{task_id}/audit")
def append_audit(task_id: uuid.UUID, body: AuditLogRequest, db: Session = Depends(get_db)):
    return task_controller.append_audit(db, task_id, body)
