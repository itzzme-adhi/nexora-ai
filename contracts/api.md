# NEXORA AI — API Contract v1

## Architecture

- Backend: Python FastAPI
- Frontend: React + Vite
- Backend URL: http://127.0.0.1:8000
- Frontend URL: http://localhost:5173
- AI inference must run fully offline on CPU.
- No cloud inference APIs.
- Model files must not be committed to Git.

## GET /health

Response:

{
  "status": "ok",
  "models_loaded": false,
  "offline_ready": false,
  "inference_device": "cpu"
}

Flags must reflect actual backend state.

## POST /api/voice

Request:
- Content-Type: multipart/form-data
- Field name: audio
- Format: mono, 16000 Hz, 16-bit PCM WAV

Response:

{
  "request_id": "unique-id",
  "transcript": "Recognized speech",
  "response_text": "Generated reply",
  "audio_url": "/api/audio/unique-id",
  "metrics": {
    "asr_ms": 0,
    "llm_ms": 0,
    "tts_ms": 0,
    "backend_processing_ms": 0
  }
}

Timing values must be measured, not fabricated.

## GET /api/audio/{request_id}

Returns generated WAV audio for the request.

## GET /api/metrics

Response:

{
  "cpu_percent": null,
  "ram_mb": null,
  "resource_profile": "unconfigured",
  "resource_limit_enforced": false
}

Use null for measurements that are unavailable.
Never claim resource enforcement unless verified.

## Team Integration Rules

- Mac developer owns backend/.
- Windows developer owns frontend/.
- Coordinate changes to contracts/api.md.
- Frontend may use clearly labeled mock data during development.
- Do not silently replace offline inference with cloud APIs.
- Browser playback latency is separate from backend processing latency.
