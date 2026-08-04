from app.core.config import get_settings


def resolve_model(user_model: str | None) -> str:
    """User-supplied model (from Postman) wins; otherwise fall back to MODEL in .env."""
    if user_model and user_model.strip():
        return user_model.strip()
    return get_settings().model
