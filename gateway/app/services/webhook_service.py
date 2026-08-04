import json
import logging
import time
import uuid

import httpx

from app.core.security import sign_webhook_payload
from app.db.session import SessionLocal
from app.models.webhook_delivery import WebhookDelivery

logger = logging.getLogger("webhook")

MAX_ATTEMPTS = 5
BACKOFF_SECONDS = [1, 5, 15, 60, 300]


def dispatch_webhook(task_id: uuid.UUID, url: str, payload: dict) -> None:
    """Retry/backoff, HMAC-signed so callers can verify origin.

    Blocking (uses time.sleep for backoff) — callers MUST invoke this via
    FastAPI BackgroundTasks, never inline in a request handler. Opens its own
    DB session since it can outlive the request that scheduled it.
    """
    db = SessionLocal()
    try:
        delivery = WebhookDelivery(task_id=task_id, url=url, payload=payload)
        db.add(delivery)
        db.commit()
        db.refresh(delivery)

        body = json.dumps(payload).encode()
        signature = sign_webhook_payload(body)

        for attempt in range(1, MAX_ATTEMPTS + 1):
            try:
                resp = httpx.post(
                    url,
                    content=body,
                    headers={"Content-Type": "application/json", "X-Signature": signature},
                    timeout=10,
                )
                resp.raise_for_status()
                delivery.status = "delivered"
                delivery.attempts = attempt
                db.commit()
                return
            except Exception as exc:  # noqa: BLE001 - webhook targets are arbitrary external URLs
                delivery.attempts = attempt
                delivery.last_error = str(exc)
                db.commit()
                logger.warning("webhook delivery failed (attempt %s/%s): %s", attempt, MAX_ATTEMPTS, exc)
                if attempt < MAX_ATTEMPTS:
                    time.sleep(BACKOFF_SECONDS[attempt - 1])

        delivery.status = "failed"
        db.commit()
    finally:
        db.close()
