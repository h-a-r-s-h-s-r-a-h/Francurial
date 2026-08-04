from app.core.config import get_settings
from app.schemas.task import ProxyIn
from app.services.redis_client import get_redis

ROUND_ROBIN_COUNTER_KEY = "proxy:round_robin:counter"


def resolve_proxy(user_proxy: ProxyIn | None) -> tuple[dict, str]:
    """Returns (proxy_dict, source) where source is 'user' or 'pool'.

    Pool selection is a Redis INCR so it stays a fair round-robin even with
    multiple gateway replicas picking proxies concurrently.
    """
    if user_proxy is not None:
        return user_proxy.model_dump(), "user"

    pool = get_settings().proxy_pool
    if not pool:
        raise ValueError("no proxy supplied and PROXY pool is empty in .env")

    idx = get_redis().incr(ROUND_ROBIN_COUNTER_KEY) - 1
    proxy = pool[idx % len(pool)]
    return proxy, "pool"
