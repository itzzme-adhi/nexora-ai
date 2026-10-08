import type { HealthResponse, SystemMetrics, VoiceResponse } from '../types';

const BACKEND_URL = 'http://127.0.0.1:8000';

export async function checkBackendHealth(): Promise<HealthResponse | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${BACKEND_URL}/health`, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function fetchSystemMetrics(): Promise<SystemMetrics | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${BACKEND_URL}/api/metrics`, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function sendVoiceAudio(wavBlob: Blob): Promise<VoiceResponse> {
  const formData = new FormData();
  formData.append('audio', wavBlob, 'recording.wav');

  const res = await fetch(`${BACKEND_URL}/api/voice`, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    throw new Error(`Backend returned status ${res.status}`);
  }

  const data: VoiceResponse = await res.json();
  // Ensure audio_url is prepended with backend URL if it is a relative path
  if (data.audio_url && data.audio_url.startsWith('/')) {
    data.audio_url = `${BACKEND_URL}${data.audio_url}`;
  }
  return data;
}

// -------------------------------------------------------------
// DEMO / MOCK ENGINE (When Offline or in Demo Mode)
// Clearly flagged as Simulated per contracts/api.md & HackNex PS08
// -------------------------------------------------------------

const MOCK_TRANSCRIPTS = [
  "What is the system status of Nexora AI?",
  "Tell me about HackNex Problem Statement PS08.",
  "What are the CPU and RAM limits currently enforced?",
  "Can you explain why on-device inference is important?",
  "Run an offline diagnostic check on the local voice pipeline."
];

const MOCK_RESPONSES = [
  "Nexora AI is fully active in offline CPU mode. All neural models are loaded into local memory with zero external cloud dependencies.",
  "HackNex PS08 requires an entirely on-device, CPU-only conversational loop. We prioritize low latency and minimal RAM footprint under strict local resource bounds.",
  "Resource enforcement active: 4 CPU cores isolated, 4.0 GB memory cap. Current quantization ensures zero GPU reliance.",
  "On-device inference guarantees complete data privacy, eliminates external network latency, and enables critical offline functionality in edge environments.",
  "Diagnostics complete: Whisper ASR quantized to INT8, LLM quantized to 4-bit GGUF, Piper TTS ready. Latency is well within qualifying bounds."
];

let mockIndex = 0;

export async function simulateVoiceResponse(): Promise<VoiceResponse> {
  // Simulate realistic offline CPU processing delay (approx 650 - 950ms)
  const asr_ms = Math.floor(140 + Math.random() * 60);
  const llm_ms = Math.floor(380 + Math.random() * 120);
  const tts_ms = Math.floor(160 + Math.random() * 50);
  const total_ms = asr_ms + llm_ms + tts_ms;

  await new Promise((resolve) => setTimeout(resolve, total_ms));

  const transcript = MOCK_TRANSCRIPTS[mockIndex % MOCK_TRANSCRIPTS.length];
  const response_text = MOCK_RESPONSES[mockIndex % MOCK_RESPONSES.length];
  mockIndex++;

  return {
    request_id: `mock-${Date.now()}`,
    transcript,
    response_text,
    audio_url: '', // Frontend will use Web Speech Synthesis fallback for mock mode playback
    metrics: {
      asr_ms,
      llm_ms,
      tts_ms,
      backend_processing_ms: total_ms,
    },
  };
}

export function getSimulatedMetrics(): SystemMetrics {
  return {
    cpu_percent: Math.floor(18 + Math.random() * 15),
    ram_mb: Math.floor(1650 + Math.random() * 200),
    resource_profile: "Simulated Edge Core (4 Cores / 4GB Limit)",
    resource_limit_enforced: true,
  };
}
