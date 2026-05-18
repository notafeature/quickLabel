"""QuickLabel FastAPI entry point.

Mounts routers for the cultivation tracking model (Layer 2 per PRD-data-model.md).
All routes are prefixed with `/api`. SQLite database at /app/data/quicklabel.db.
"""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from db import init_db
from seed import seed_registries
from routers import (
    agar,
    batches,
    events,
    genetics,
    grain,
    harvests,
    ingest,
    lc,
    lineage,
    photos,
    recipes,
    registries,
    system,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    seed_registries()
    yield


app = FastAPI(title="QuickLabel", version="0.2.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "app": "QuickLabel", "version": "0.2.0"}


for r in (
    system.router,
    registries.router,
    genetics.router,
    ingest.router,
    agar.router,
    lc.router,
    grain.router,
    recipes.router,
    batches.router,
    harvests.router,
    events.router,
    lineage.router,
    photos.router,
):
    app.include_router(r)
