import logging

from fastapi import FastAPI

from app.db.session import Base, engine
from app.routes import health, internal, live, tasks

logging.basicConfig(level=logging.INFO)

app = FastAPI(title="Francurial Gateway", version="0.1.0")


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
