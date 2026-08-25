import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routes.vessels import router as vessels_router
from app.routes.tasks import router as tasks_router
from app.routes.users import router as users_router
from app.routes.config import router as config_router
from app.routes.subtasks import router as subtasks_router

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Task Management API",
    description="Task Management module API — part of the Ozellar Workplace platform.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://52.172.91.85"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

app.include_router(vessels_router)
app.include_router(tasks_router)
app.include_router(users_router)
app.include_router(config_router)
app.include_router(subtasks_router)


@app.get("/health")
async def health():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.api:app", host="0.0.0.0", port=8005, reload=True)
