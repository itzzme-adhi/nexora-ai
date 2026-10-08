import logging
import tempfile
from fastapi.middleware.cors import CORSMiddleware
from voice import load_speech, synthesize, register_voice_routes
import os
from contextlib import asynccontextmanager
from pathlib import Path
from threading import Lock
from time import perf_counter
from typing import Literal
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from fastapi.concurrency import run_in_threadpool
from llama_cpp import Llama
from pydantic import BaseModel, Field

logger = logging.getLogger("nexora")
inference_lock = Lock()


def load_model():
    path = Path(os.environ.get(
        "NEXORA_MODEL_PATH",
        str(Path.home() / ".cache/nexora/models/qwen2.5-1.5b-instruct-q4_k_m.gguf"),
    )).expanduser()
    if not path.is_file():
        raise RuntimeError(f"Local model missing: {path}")
    return Llama(
        model_path=str(path),
        n_ctx=2048,
        n_threads=4,
        n_gpu_layers=0,
        offload_kqv=False,
        op_offload=False,
        flash_attn=False,
        verbose=False,
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.llm = None
    app.state.asr = None
    app.state.tts_ready = False
    app.state.audio_dir = tempfile.TemporaryDirectory(prefix="nexora-audio-")
    try:
        app.state.llm = await run_in_threadpool(load_model)
        app.state.asr = await run_in_threadpool(load_speech)
        probe = Path(app.state.audio_dir.name) / "startup.wav"
        await run_in_threadpool(synthesize, "Nexora is ready.", probe)
        probe.unlink(missing_ok=True)
        app.state.tts_ready = True
        logger.info("LLM, speech recognition, and macOS speech synthesis ready.")
        yield
    finally:
        app.state.tts_ready = False
        app.state.asr = None
        try:
            if app.state.llm is not None:
                await run_in_threadpool(app.state.llm.close)
        finally:
            app.state.llm = None
            app.state.audio_dir.cleanup()


app = FastAPI(
    title="NEXORA AI Backend",
    version="0.2.0",
    docs_url=None,
    redoc_url=None,
    lifespan=lifespan,
)


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    models_loaded: bool = False
    offline_ready: bool = False
    inference_device: Literal["cpu"] = "cpu"
    llm_loaded: bool = False
    asr_loaded: bool = False
    tts_ready: bool = False
    voice_ready: bool = False


class ChatRequest(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    max_tokens: int = Field(default=128, ge=1, le=256)


class ChatResponse(BaseModel):
    request_id: str
    response_text: str
    llm_ms: float
    inference_device: Literal["cpu"] = "cpu"


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    llm_loaded = getattr(app.state, "llm", None) is not None
    asr_loaded = getattr(app.state, "asr", None) is not None
    tts_ready = getattr(app.state, "tts_ready", False)
    return HealthResponse(
        models_loaded=llm_loaded and asr_loaded,
        offline_ready=False,
        llm_loaded=llm_loaded,
        asr_loaded=asr_loaded,
        tts_ready=tts_ready,
        voice_ready=llm_loaded and asr_loaded and tts_ready,
    )


@app.post("/api/chat", response_model=ChatResponse)
def chat(body: ChatRequest) -> ChatResponse:
    text = body.text.strip()
    if not text:
        raise HTTPException(status_code=422, detail="Text cannot be blank.")
    model = getattr(app.state, "llm", None)
    if model is None:
        raise HTTPException(status_code=503, detail="Local model is unavailable.")
    if not inference_lock.acquire(blocking=False):
        raise HTTPException(status_code=503, detail="Model is busy. Try again shortly.")
    try:
        start = perf_counter()
        result = model.create_chat_completion(
            messages=[
                {"role": "system", "content":
                 "You are NEXORA, a helpful offline assistant. "
                 "Answer clearly and briefly. If unsure, say so."},
                {"role": "user", "content": text},
            ],
            max_tokens=body.max_tokens,
            temperature=0,
        )
        elapsed_ms = (perf_counter() - start) * 1000
        return ChatResponse(
            request_id=str(uuid4()),
            response_text=result["choices"][0]["message"]["content"] or "",
            llm_ms=round(elapsed_ms, 2),
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=400, detail="Input could not be processed. Try shorter text."
        ) from exc
    except Exception as exc:
        logger.exception("Local inference failed")
        raise HTTPException(status_code=500, detail="Local inference failed.") from exc
    finally:
        inference_lock.release()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)
register_voice_routes(app, inference_lock)
