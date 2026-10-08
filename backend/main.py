from typing import Literal

from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(
    title="NEXORA AI Backend",
    version="0.1.0",
    docs_url=None,
    redoc_url=None,
)


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    models_loaded: bool = False
    offline_ready: bool = False
    inference_device: Literal["cpu"] = "cpu"


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse()
