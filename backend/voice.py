import io
import subprocess
import tempfile
import wave
from pathlib import Path
from time import perf_counter
from uuid import UUID, uuid4

import numpy as np
import psutil
from fastapi import HTTPException, UploadFile
from fastapi.responses import FileResponse
from faster_whisper import WhisperModel

MAX_AUDIO_BYTES = 2_000_000
MAX_SECONDS = 60


def load_speech():
    return WhisperModel(
        str(Path.home() / ".cache/nexora/models/faster-whisper-base.en"),
        device="cpu",
        compute_type="int8",
        cpu_threads=4,
        num_workers=1,
        local_files_only=True,
    )


def synthesize(text, destination):
    subprocess.run(
        [
            "/usr/bin/say",
            "--file-format=WAVE",
            "--data-format=LEI16@16000",
            "-o", str(destination),
        ],
        input=text,
        text=True,
        check=True,
        capture_output=True,
        timeout=45,
    )
    with wave.open(str(destination), "rb") as wav:
        if wav.getnframes() == 0:
            raise RuntimeError("Speech synthesis produced empty audio.")


def decode_wav(data):
    try:
        with wave.open(io.BytesIO(data), "rb") as wav:
            if (
                wav.getnchannels() != 1
                or wav.getframerate() != 16000
                or wav.getsampwidth() != 2
                or wav.getcomptype() != "NONE"
            ):
                raise ValueError("Expected mono, 16000 Hz, 16-bit PCM WAV.")
            frames = wav.getnframes()
            if not 0 < frames <= MAX_SECONDS * 16000:
                raise ValueError("Audio must be between 0 and 60 seconds.")
            raw = wav.readframes(frames)
            if len(raw) != frames * 2:
                raise ValueError("Audio file is incomplete.")
        return np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
    except (wave.Error, EOFError, ValueError) as exc:
        raise HTTPException(
            status_code=422,
            detail="Upload a complete mono, 16000 Hz, 16-bit PCM WAV, up to 60 seconds.",
        ) from exc


def register_voice_routes(app, inference_lock):
    process = psutil.Process()

    @app.post("/api/voice")
    def voice(audio: UploadFile):
        started = perf_counter()
        try:
            data = audio.file.read(MAX_AUDIO_BYTES + 1)
        finally:
            audio.file.close()
        if len(data) > MAX_AUDIO_BYTES:
            raise HTTPException(status_code=413, detail="Audio upload is too large.")
        samples = decode_wav(data)
        if (
            getattr(app.state, "asr", None) is None
            or getattr(app.state, "llm", None) is None
            or not getattr(app.state, "tts_ready", False)
        ):
            raise HTTPException(status_code=503, detail="Voice pipeline is unavailable.")
        if not inference_lock.acquire(blocking=False):
            raise HTTPException(status_code=503, detail="Assistant is busy. Try again shortly.")

        request_id = str(uuid4())
        destination = Path(app.state.audio_dir.name) / (request_id + ".wav")
        try:
            start = perf_counter()
            segments, _ = app.state.asr.transcribe(
                samples, language="en", beam_size=1,
                vad_filter=True, condition_on_previous_text=False,
            )
            transcript = " ".join(segment.text.strip() for segment in segments).strip()
            asr_ms = (perf_counter() - start) * 1000
            if not transcript:
                raise HTTPException(status_code=422, detail="No speech detected.")

            start = perf_counter()
            result = app.state.llm.create_chat_completion(
                messages=[
                    {"role": "system", "content":
                     "You are NEXORA, a helpful offline voice assistant. "
                     "Reply in one or two short sentences using plain spoken language. "
                     "If unsure, say so."},
                    {"role": "user", "content": transcript},
                ],
                max_tokens=128,
                temperature=0,
            )
            response_text = result["choices"][0]["message"]["content"] or ""
            llm_ms = (perf_counter() - start) * 1000
            if not response_text.strip():
                raise RuntimeError("Model returned an empty reply.")

            start = perf_counter()
            synthesize(response_text, destination)
            tts_ms = (perf_counter() - start) * 1000

            # Keep only the newest 100 replies in this server session.
            files = sorted(destination.parent.glob("*.wav"), key=lambda p: p.stat().st_mtime)
            for old in files[:-100]:
                old.unlink(missing_ok=True)

            return {
                "request_id": request_id,
                "transcript": transcript,
                "response_text": response_text,
                "audio_url": "/api/audio/" + request_id,
                "metrics": {
                    "asr_ms": round(asr_ms, 2),
                    "llm_ms": round(llm_ms, 2),
                    "tts_ms": round(tts_ms, 2),
                    "backend_processing_ms": round((perf_counter() - started) * 1000, 2),
                },
            }
        except HTTPException:
            raise
        except Exception as exc:
            destination.unlink(missing_ok=True)
            import logging
            logging.getLogger("nexora").exception("Voice pipeline failed")
            raise HTTPException(status_code=500, detail="Voice processing failed.") from exc
        finally:
            inference_lock.release()

    @app.get("/api/audio/{request_id}")
    def get_audio(request_id: UUID):
        path = Path(app.state.audio_dir.name) / (str(request_id) + ".wav")
        if not path.is_file():
            raise HTTPException(status_code=404, detail="Audio not found or expired.")
        return FileResponse(
            path, media_type="audio/wav",
            headers={"Cache-Control": "no-store"},
        )

    @app.get("/api/metrics")
    def metrics():
        return {
            "cpu_percent": process.cpu_percent(interval=0.1),
            "ram_mb": round(process.memory_info().rss / 1_000_000, 2),
            "resource_profile": "unconfigured",
            "resource_limit_enforced": False,
            "measurement_scope": "backend_process_only",
        }
