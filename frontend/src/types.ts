// Type definitions based on contracts/api.md for HackNex 2026 (HNX26EPS08)

export interface HealthResponse {
  status: string;
  models_loaded: boolean;
  offline_ready: boolean;
  inference_device: string;
}

export interface VoiceMetrics {
  asr_ms: number;
  llm_ms: number;
  tts_ms: number;
  backend_processing_ms: number;
  browser_playback_ms?: number;
}

export interface VoiceResponse {
  request_id: string;
  transcript: string;
  response_text: string;
  audio_url: string;
  metrics: VoiceMetrics;
}

export interface SystemMetrics {
  cpu_percent: number | null;
  ram_mb: number | null;
  resource_profile: string;
  resource_limit_enforced: boolean;
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  timestamp: string;
  metrics?: VoiceMetrics;
  audioUrl?: string;
  isMock?: boolean;
}
