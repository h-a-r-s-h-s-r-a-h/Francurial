import base64
import hashlib
import hmac
import json
import time

from cryptography.fernet import Fernet
from fastapi import Header, HTTPException, status

from app.core.config import get_settings


def require_api_key(x_api_key: str | None = Header(default=None)) -> str:
    settings = get_settings()
    if not x_api_key or x_api_key not in settings.api_key_set:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid or missing X-API-Key")
    return x_api_key


def require_internal_secret(x_internal_secret: str | None = Header(default=None)) -> None:
    settings = get_settings()
    if not x_internal_secret or not hmac.compare_digest(x_internal_secret, settings.internal_shared_secret):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid internal secret")


def _fernet() -> Fernet:
    return Fernet(get_settings().credentials_enc_key.encode())


def encrypt_json(data: dict | None) -> str | None:
    if data is None:
        return None
    return _fernet().encrypt(json.dumps(data).encode()).decode()


def decrypt_json(token: str | None) -> dict | None:
    if token is None:
        return None
    return json.loads(_fernet().decrypt(token.encode()).decode())


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _b64url_decode(data: str) -> bytes:
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + padding)


def sign_live_token(task_id: str, ttl_seconds: int | None = None) -> str:
    settings = get_settings()
    expires_at = int(time.time()) + (ttl_seconds or settings.live_url_ttl_seconds)
    payload = f"{task_id}.{expires_at}".encode()
    sig = hmac.new(settings.live_url_secret.encode(), payload, hashlib.sha256).digest()
    return f"{expires_at}.{_b64url(sig)}"


def verify_live_token(task_id: str, token: str) -> bool:
    settings = get_settings()
    try:
        expires_at_str, sig_b64 = token.split(".", 1)
        expires_at = int(expires_at_str)
    except (ValueError, AttributeError):
        return False
    if time.time() > expires_at:
        return False
    payload = f"{task_id}.{expires_at}".encode()
    expected_sig = hmac.new(settings.live_url_secret.encode(), payload, hashlib.sha256).digest()
    try:
        given_sig = _b64url_decode(sig_b64)
    except Exception:
        return False
    return hmac.compare_digest(expected_sig, given_sig)


def sign_webhook_payload(raw_body: bytes) -> str:
    settings = get_settings()
    return hmac.new(settings.webhook_hmac_secret.encode(), raw_body, hashlib.sha256).hexdigest()


REDACT_KEYS = {"password", "email", "username", "credentials", "proxy"}


def redact(payload: dict) -> dict:
    """Shallow-redact known-sensitive keys before anything reaches logs."""
    out = {}
    for k, v in payload.items():
        if k.lower() in REDACT_KEYS:
            out[k] = "***redacted***"
        elif isinstance(v, dict):
            out[k] = redact(v)
        else:
            out[k] = v
    return out
