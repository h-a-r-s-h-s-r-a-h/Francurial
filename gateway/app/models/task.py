import uuid
from datetime import datetime

from sqlalchemy import DateTime, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.session import Base


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    status: Mapped[str] = mapped_column(Text, default="queued")
    # queued -> running -> waiting_input -> running -> completed | failed
    wait_reason: Mapped[str | None] = mapped_column(Text, nullable=True)  # 'captcha' | 'human_takeover'
    control_state: Mapped[str] = mapped_column(Text, default="agent")  # 'agent' | 'human'

    url: Mapped[str] = mapped_column(Text)
    instruction: Mapped[str] = mapped_column(Text)

    credentials_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    proxy_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    proxy_source: Mapped[str] = mapped_column(Text, default="pool")  # 'user' | 'pool'

    model: Mapped[str] = mapped_column(Text)
    max_steps: Mapped[int] = mapped_column(default=40)
    timeout_seconds: Mapped[int] = mapped_column(default=600)

    webhook_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    assigned_worker: Mapped[str | None] = mapped_column(Text, nullable=True)

    result: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
