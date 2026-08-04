import json

from app.services.redis_client import get_redis

TASK_STREAM = "tasks:queue"
CONTROL_CHANNEL_PREFIX = "control:"  # control:{task_id} pubsub -> "agent" | "human" | "resume"


def publish_task(task_id: str) -> None:
    get_redis().xadd(TASK_STREAM, {"task_id": task_id})


def publish_control_signal(task_id: str, signal: str) -> None:
    """signal: 'take_control' | 'release_control' | 'resume'.

    Consumed by the worker's agent loop to pause before its next action, or to
    re-observe current state and continue once released.
    """
    get_redis().publish(f"{CONTROL_CHANNEL_PREFIX}{task_id}", json.dumps({"signal": signal}))


def set_worker_addr(task_id: str, worker_addr: str) -> None:
    get_redis().set(f"task:{task_id}:worker_addr", worker_addr, ex=3600 * 6)


def get_worker_addr(task_id: str) -> str | None:
    return get_redis().get(f"task:{task_id}:worker_addr")
