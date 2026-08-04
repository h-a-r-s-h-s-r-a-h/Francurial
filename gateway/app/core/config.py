from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str
    redis_url: str

    gateway_port: int = 8000
    api_keys: str = ""
    live_url_secret: str
    live_url_ttl_seconds: int = 7200
    webhook_hmac_secret: str
    public_base_url: str = "http://localhost:8000"

    proxy: str = ""
    model: str = "openai/gpt-5.4-nano"
    openrouter_key: str = ""

    max_agent_steps: int = 40
    captcha_solve_attempts: int = 2

    credentials_enc_key: str = ""
    internal_shared_secret: str = ""

    @property
    def api_key_set(self) -> set[str]:
        return {k.strip() for k in self.api_keys.split(",") if k.strip()}

    @property
    def proxy_pool(self) -> list[dict]:
        pool = []
        for entry in self.proxy.split(","):
            entry = entry.strip()
            if not entry:
                continue
            parts = entry.split(":")
            if len(parts) != 4:
                continue
            host, port, username, password = parts
            pool.append({"host": host, "port": int(port), "username": username, "password": password})
        return pool


@lru_cache
def get_settings() -> Settings:
    return Settings()
