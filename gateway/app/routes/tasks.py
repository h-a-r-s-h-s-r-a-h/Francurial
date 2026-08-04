import uuid

from fastapi import APIRouter, BackgroundTasks, Depends
from sqlalchemy.orm import Session

from app.controllers import task_controller
from app.core.security import require_api_key
from app.db.session import get_db
from app.schemas.task import ContinueRequest, TaskCreateRequest, TaskCreateResponse, TaskStatusResponse

router = APIRouter(prefix="/v1/tasks", tags=["tasks"])


@router.post("", response_model=TaskCreateResponse, status_code=202)
def create_task(
    body: TaskCreateRequest,
    db: Session = Depends(get_db),
    _api_key: str = Depends(require_api_key),
):
    return task_controller.create_task(db, body)


@router.get("/{task_id}", response_model=TaskStatusResponse)
def get_task(
    task_id: uuid.UUID,
    db: Session = Depends(get_db),
    _api_key: str = Depends(require_api_key),
):
    return task_controller.get_task(db, task_id)


@router.post("/{task_id}/continue")
def continue_task(
    task_id: uuid.UUID,
    _body: ContinueRequest | None = None,
    db: Session = Depends(get_db),
    _api_key: str = Depends(require_api_key),
):
    return task_controller.continue_task(db, task_id)
