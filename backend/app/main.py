import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.routes import auth, posts, social
from app.core.config import settings
from app.db.mongodb import init_db
from app.services.scheduler import start_scheduler, stop_scheduler


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    Path(settings.uploads_dir).mkdir(parents=True, exist_ok=True)
    start_scheduler()
    yield
    stop_scheduler()


app = FastAPI(title="Scheduler API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_base_url],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/uploads", StaticFiles(directory=settings.uploads_dir), name="uploads")

app.include_router(auth.router)
app.include_router(posts.router)
app.include_router(social.router)


@app.get("/api/health")
async def health():
    return {"status": "ok"}
