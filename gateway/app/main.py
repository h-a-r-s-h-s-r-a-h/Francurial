import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.db.session import Base, engine
from app.routes import health, internal, live, tasks

logging.basicConfig(level=logging.INFO)

app = FastAPI(title="Francurial Gateway", version="0.1.0")

# Serves the logo/favicon used by the live-view page (app/static/logo.png,
# favicon.png) at /static/... — live_view.html itself is served via its own
# route (routes/live.py), not through this mount.
app.mount("/static", StaticFiles(directory=Path(__file__).resolve().parent / "static"), name="static")


@app.on_event("startup")
def on_startup():
    # MVP: create tables directly from models. Swap for Alembic migrations
    # before this ever touches a real production database.
    import app.models  # noqa: F401  (ensures models are registered on Base)

    Base.metadata.create_all(bind=engine)


app.include_router(health.router)
app.include_router(tasks.router)
app.include_router(live.router)
app.include_router(internal.router)
