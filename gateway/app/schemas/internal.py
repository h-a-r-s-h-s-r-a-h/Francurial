import uuid

from pydantic import BaseModel


class StatusUpdateRequest(BaseModel):
    status: str | None = None
    wait_reason: str | None = None
    control_state: str | None = None
    assigned_worker: str | None = None
    result: dict | None = None
    error: str | None = None


class AuditLogRequest(BaseModel):
    step_index: int
    type: str
    payload: dict = {}


class ClaimRequest(BaseModel):
    worker_addr: str


class ResolvedTask(BaseModel):
    task_id: uuid.UUID
    url: str
    instruction: str
    credentials: dict | None
    proxy: dict
    model: str
    max_steps: int
    timeout_seconds: int
