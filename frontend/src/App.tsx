import React, { useState, useEffect, useRef } from 'react';
import './App.css';
import {
  Mic,
  Square,
  Volume2,
  Cpu,
  HardDrive,
  Activity,
  ShieldCheck,
  Radio,
  Zap,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import { AudioRecorder } from './utils/audioRecorder';
import {
  checkBackendHealth,
  fetchSystemMetrics,
  sendVoiceAudio,
  simulateVoiceResponse,
  getSimulatedMetrics
} from './services/api';
import type { ChatMessage, HealthResponse, SystemMetrics, VoiceMetrics } from './types';

export const App: React.FC = () => {
  // Connection & Mode States
  const [isDemoMode, setIsDemoMode] = useState<boolean>(true);
  const [backendHealth, setBackendHealth] = useState<HealthResponse | null>(null);
  const [systemMetrics, setSystemMetrics] = useState<SystemMetrics | null>(null);

  // Recording & Audio States
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [audioVolume, setAudioVolume] = useState<number>(0);
  const audioRecorderRef = useRef<AudioRecorder | null>(null);

  // Chat & Telemetry States
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      sender: 'assistant',
      text: 'Hello! I am NEXORA AI, your offline, on-device voice assistant. Click the microphone orb below to speak.',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isMock: true,
    }
  ]);
  const [latestMetrics, setLatestMetrics] = useState<VoiceMetrics | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Periodic Health Check & Metrics Polling
  useEffect(() => {
    const updateStatus = async () => {
      const health = await checkBackendHealth();
      setBackendHealth(health);

      if (health && !isDemoMode) {
        const metrics = await fetchSystemMetrics();
        setSystemMetrics(metrics);
      } else {
        setSystemMetrics(getSimulatedMetrics());
      }
    };

    updateStatus();
    const interval = setInterval(updateStatus, 4000);
    return () => clearInterval(interval);
  }, [isDemoMode]);

  // Auto-scroll chat to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Start recording
  const handleStartRecording = async () => {
    try {
      audioRecorderRef.current = new AudioRecorder();
      await audioRecorderRef.current.start((vol) => setAudioVolume(vol));
      setIsRecording(true);
    } catch (err) {
      console.error('Failed to access microphone:', err);
      alert('Microphone access is required. Please check your browser permissions.');
    }
  };

  // Stop recording and process
  const handleStopRecording = async () => {
    if (!audioRecorderRef.current || !isRecording) return;
    setIsRecording(false);
    setIsProcessing(true);
    setAudioVolume(0);

    const recordingStartTime = performance.now();

    try {
      const { blob: wavBlob } = await audioRecorderRef.current.stop();

      // Check whether to use live backend or fallback to demo mock
      const useLive = !isDemoMode && backendHealth !== null;
      let voiceData;

      if (useLive) {
        voiceData = await sendVoiceAudio(wavBlob);
      } else {
        voiceData = await simulateVoiceResponse();
      }

      // Add user transcript message
      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        sender: 'user',
        text: voiceData.transcript,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      // Measure browser playback start latency
      const playbackStart = performance.now();
      let playbackLatency = 0;

      // Play audio response
      if (voiceData.audio_url) {
        const audio = new Audio(voiceData.audio_url);
        audio.onplay = () => {
          playbackLatency = Math.round(performance.now() - playbackStart);
          setLatestMetrics((prev) => (prev ? { ...prev, browser_playback_ms: playbackLatency } : null));
        };
        audio.play().catch((e) => console.warn('Audio playback error:', e));
      } else if ('speechSynthesis' in window) {
        // Fallback speech synthesis for demo mode
        const utterance = new SpeechSynthesisUtterance(voiceData.response_text);
        utterance.onstart = () => {
          playbackLatency = Math.round(performance.now() - playbackStart);
          setLatestMetrics((prev) => (prev ? { ...prev, browser_playback_ms: playbackLatency } : null));
        };
        window.speechSynthesis.speak(utterance);
      }

      const assistantMetrics: VoiceMetrics = {
        ...voiceData.metrics,
        browser_playback_ms: playbackLatency || Math.round(performance.now() - recordingStartTime),
      };

      setLatestMetrics(assistantMetrics);

      const assistantMsg: ChatMessage = {
        id: voiceData.request_id,
        sender: 'assistant',
        text: voiceData.response_text,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        metrics: assistantMetrics,
        audioUrl: voiceData.audio_url,
        isMock: !useLive,
      };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
    } catch (error) {
      console.error('Error handling voice recording:', error);
      alert('Error processing voice query. Ensure backend is running or toggle to Demo Mode.');
    } finally {
      setIsProcessing(false);
    }
  };

  const playResponseAudio = (text: string, audioUrl?: string) => {
    if (audioUrl) {
      const audio = new Audio(audioUrl);
      audio.play().catch(console.error);
    } else if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      window.speechSynthesis.speak(utterance);
    }
  };

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header glass-panel">
        <div className="brand-section">
          <div className="brand-logo-icon">
            <Radio size={24} />
          </div>
          <div>
            <h1 className="brand-title">NEXORA AI</h1>
            <p className="brand-subtitle">Offline On-Device AI Voice Assistant • HackNex 2026 (PS08)</p>
          </div>
        </div>

        <div className="header-controls">
          {/* Backend Status Badge */}
          <div className="glass-badge">
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                backgroundColor: backendHealth ? '#10b981' : '#f59e0b',
                boxShadow: `0 0 8px ${backendHealth ? '#10b981' : '#f59e0b'}`,
              }}
            />
            {backendHealth ? 'Backend Connected' : 'Backend Offline'}
          </div>

          {/* Mode Switcher */}
          <button
            className={`mode-toggle-btn ${isDemoMode ? 'demo-active' : ''}`}
            onClick={() => setIsDemoMode(!isDemoMode)}
          >
            <Activity size={15} />
            {isDemoMode ? 'Demo Mode (Simulated)' : 'Live Backend Mode'}
          </button>
        </div>
      </header>

      {/* Main Content Layout */}
      <main className="main-layout">
        {/* Left: Voice Interaction Console & Transcript */}
        <div className="voice-console">
          {/* Microphone Orb Card */}
          <section className="voice-orb-card glass-panel">
            {isDemoMode && (
              <div
                className="glass-badge"
                style={{
                  position: 'absolute',
                  top: 16,
                  right: 16,
                  borderColor: 'rgba(245, 158, 11, 0.4)',
                  color: '#fbbf24',
                }}
              >
                <AlertCircle size={14} /> DEMO / SIMULATION MODE
              </div>
            )}

            <div className="orb-wrapper">
              <button
                className={`orb-button ${isRecording ? 'recording' : ''}`}
                onClick={isRecording ? handleStopRecording : handleStartRecording}
                disabled={isProcessing}
                aria-label="Voice Interaction Button"
              >
                {isRecording ? <Square size={38} /> : <Mic size={42} />}
              </button>
            </div>

            {/* Dynamic Soundwave Bars */}
            <div className="wave-bars">
              {Array.from({ length: 18 }).map((_, idx) => {
                const height = isRecording
                  ? Math.max(6, Math.min(34, Math.sin(idx * 0.4 + audioVolume * 0.1) * (audioVolume * 0.3) + 12))
                  : isProcessing
                  ? Math.max(6, Math.sin(idx + Date.now() / 200) * 12 + 16)
                  : 6;
                return <div key={idx} className="wave-bar" style={{ height: `${height}px` }} />;
              })}
            </div>

            <p className="status-hint">
              {isRecording
                ? 'Listening... Click square to stop and synthesize'
                : isProcessing
                ? 'Processing on-device CPU pipeline (ASR → LLM → TTS)...'
                : 'Click microphone to ask Nexora AI'}
            </p>
          </section>

          {/* Transcript Feed */}
          <section className="transcript-card glass-panel">
            <div className="transcript-header">
              <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>Conversation Transcript</span>
              <span className="glass-badge" style={{ fontSize: '0.7rem' }}>
                Format: 16kHz Mono PCM WAV
              </span>
            </div>

            <div className="transcript-list">
              {messages.map((msg) => (
                <div key={msg.id} className={`message-bubble ${msg.sender}`}>
                  <div>{msg.text}</div>
                  <div className="message-meta">
                    <span>{msg.timestamp}</span>
                    {msg.isMock && <span style={{ color: '#fbbf24' }}>• Simulated</span>}
                    {msg.sender === 'assistant' && (
                      <>
                        <button
                          className="playback-btn"
                          onClick={() => playResponseAudio(msg.text, msg.audioUrl)}
                        >
                          <Volume2 size={12} /> Play Audio
                        </button>
                        {msg.metrics && (
                          <span style={{ color: 'var(--accent-cyan)' }}>
                            ⚡ {msg.metrics.backend_processing_ms}ms
                          </span>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          </section>
        </div>

        {/* Right: Edge AI Telemetry Dashboard (HackNex PS08 Criteria) */}
        <aside className="telemetry-sidebar">
          {/* PS08 Compliance Box */}
          <div className="telemetry-card glass-panel">
            <h2 className="card-title">
              <ShieldCheck size={18} style={{ color: '#10b981' }} />
              HackNex PS08 Parameters
            </h2>
            <div className="rule-checklist">
              <div className="rule-item pass">
                <CheckCircle2 size={15} /> Full On-Device CPU Inference
              </div>
              <div className="rule-item pass">
                <CheckCircle2 size={15} /> Zero Cloud API Dependencies
              </div>
              <div className="rule-item pass">
                <CheckCircle2 size={15} /> 16 kHz Mono 16-bit PCM Audio
              </div>
              <div className="rule-item pass">
                <CheckCircle2 size={15} /> Granular Latency Profiling
              </div>
            </div>
          </div>

          {/* System Metrics (CPU / RAM) */}
          <div className="telemetry-card glass-panel">
            <h2 className="card-title">
              <Cpu size={18} style={{ color: '#00f2fe' }} />
              Edge Resource Telemetry
            </h2>

            <div className="meter-group">
              <div className="meter-label">
                <span>CPU Utilization</span>
                <span style={{ fontWeight: 600 }}>{systemMetrics?.cpu_percent ?? 0}%</span>
              </div>
              <div className="meter-track">
                <div
                  className="meter-fill cpu"
                  style={{ width: `${Math.min(100, systemMetrics?.cpu_percent ?? 0)}%` }}
                />
              </div>
            </div>

            <div className="meter-group">
              <div className="meter-label">
                <span>Memory Allocation</span>
                <span style={{ fontWeight: 600 }}>{systemMetrics?.ram_mb ?? 0} MB</span>
              </div>
              <div className="meter-track">
                <div
                  className="meter-fill ram"
                  style={{ width: `${Math.min(100, ((systemMetrics?.ram_mb ?? 0) / 4096) * 100)}%` }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
              <div className="glass-badge" style={{ fontSize: '0.72rem', justifyContent: 'center' }}>
                <HardDrive size={13} /> {systemMetrics?.resource_profile || 'Unconfigured Profile'}
              </div>
              <div className="glass-badge" style={{ fontSize: '0.72rem', justifyContent: 'center', color: '#10b981' }}>
                Resource Limits: {systemMetrics?.resource_limit_enforced ? 'Enforced (Isolated)' : 'Flexible'}
              </div>
            </div>
          </div>

          {/* Latency Waterfall Breakdown */}
          <div className="telemetry-card glass-panel">
            <h2 className="card-title">
              <Zap size={18} style={{ color: '#f59e0b' }} />
              Latency Breakdown (25% Weight)
            </h2>

            <div className="waterfall-list">
              <div className="waterfall-step">
                <span>ASR (Speech-to-Text)</span>
                <span className="waterfall-val">{latestMetrics?.asr_ms ?? 0} ms</span>
              </div>
              <div className="waterfall-step">
                <span>LLM (Local Inference)</span>
                <span className="waterfall-val">{latestMetrics?.llm_ms ?? 0} ms</span>
              </div>
              <div className="waterfall-step">
                <span>TTS (Voice Synthesis)</span>
                <span className="waterfall-val">{latestMetrics?.tts_ms ?? 0} ms</span>
              </div>
              <div className="waterfall-step" style={{ borderColor: 'rgba(0, 242, 254, 0.4)' }}>
                <span style={{ fontWeight: 600 }}>Total Pipeline</span>
                <span className="waterfall-val" style={{ color: '#00f2fe' }}>
                  {latestMetrics?.backend_processing_ms ?? 0} ms
                </span>
              </div>
              <div className="waterfall-step">
                <span>Playback Delay</span>
                <span className="waterfall-val">{latestMetrics?.browser_playback_ms ?? 0} ms</span>
              </div>
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
};

export default App;
