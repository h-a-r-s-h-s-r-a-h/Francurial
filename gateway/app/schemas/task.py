import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class ProxyIn(BaseModel):
    host: str
    port: int
    username: str
    password: str


class CredentialsIn(BaseModel):
    email: str
    password: str


class TaskCreateRequest(BaseModel):
    url: str
    instruction: str
    proxy: ProxyIn | None = None
    credentials: CredentialsIn | None = None
    model: str | None = None
    webhook_url: str | None = None
    max_steps: int | None = Field(default=None, ge=1, le=200)
    timeout_seconds: int | None = Field(default=None, ge=10, le=3600)


class TaskCreateResponse(BaseModel):
    task_id: uuid.UUID
    status: str
    live_url: str


class TaskStatusResponse(BaseModel):
    task_id: uuid.UUID
    status: str
    wait_reason: str | None
    control_state: str
    url: str
    instruction: str
    model: str
    proxy_source: str
    result: dict | None
    error: str | None
    created_at: datetime
    started_at: datetime | None
    completed_at: datetime | None
    live_url: str


class ContinueRequest(BaseModel):
    note: str | None = None
