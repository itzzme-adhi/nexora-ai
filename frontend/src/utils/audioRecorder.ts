/**
 * AudioRecorder utility that records microphone audio and encodes it into
 * 16,000 Hz, Mono, 16-bit Linear PCM WAV format as required by contracts/api.md.
 */

export class AudioRecorder {
  private mediaStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private input: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private audioChunks: Float32Array[] = [];
  private recording: boolean = false;
  private targetSampleRate: number = 16000;

  public async start(onVolumeChange?: (volume: number) => void): Promise<void> {
    this.audioChunks = [];
    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.audioContext = new AudioContextClass();
    this.input = this.audioContext.createMediaStreamSource(this.mediaStream);

    // Setup Analyser for visualizer waveforms
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 256;
    this.input.connect(this.analyser);

    // Volume monitoring loop
    if (onVolumeChange) {
      const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
      const updateVolume = () => {
        if (!this.recording) return;
        this.analyser?.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const average = sum / dataArray.length;
        onVolumeChange(Math.min(100, Math.round((average / 255) * 100)));
        requestAnimationFrame(updateVolume);
      };
      requestAnimationFrame(updateVolume);
    }

    // Audio processor buffer
    this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
    this.processor.onaudioprocess = (e) => {
      if (!this.recording) return;
      const inputData = e.inputBuffer.getChannelData(0);
      this.audioChunks.push(new Float32Array(inputData));
    };

    this.input.connect(this.processor);
    this.processor.connect(this.audioContext.destination);
    this.recording = true;
  }

  public async stop(): Promise<{ blob: Blob; url: string }> {
    this.recording = false;

    if (this.processor && this.input) {
      this.processor.disconnect();
      this.input.disconnect();
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
    }

    const currentSampleRate = this.audioContext?.sampleRate || 44100;
    if (this.audioContext && this.audioContext.state !== 'closed') {
      await this.audioContext.close();
    }

    // Flatten all captured chunks
    const totalLength = this.audioChunks.reduce((acc, chunk) => acc + chunk.length, 0);
    const mergedBuffer = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of this.audioChunks) {
      mergedBuffer.set(chunk, offset);
      offset += chunk.length;
    }

    // Resample down to 16,000 Hz if recorded at different sample rate
    const resampledBuffer = this.resampleAudio(mergedBuffer, currentSampleRate, this.targetSampleRate);

    // Encode to 16-bit PCM WAV
    const wavBlob = this.encodeWAV(resampledBuffer, this.targetSampleRate);
    const audioUrl = URL.createObjectURL(wavBlob);

    return { blob: wavBlob, url: audioUrl };
  }

  private resampleAudio(buffer: Float32Array, inputSampleRate: number, outputSampleRate: number): Float32Array {
    if (inputSampleRate === outputSampleRate) return buffer;
    const ratio = inputSampleRate / outputSampleRate;
    const outputLength = Math.round(buffer.length / ratio);
    const result = new Float32Array(outputLength);

    for (let i = 0; i < outputLength; i++) {
      const originalIndex = i * ratio;
      const indexFloor = Math.floor(originalIndex);
      const indexCeil = Math.min(buffer.length - 1, Math.ceil(originalIndex));
      const fraction = originalIndex - indexFloor;
      // Linear interpolation between samples
      result[i] = buffer[indexFloor] * (1 - fraction) + buffer[indexCeil] * fraction;
    }
    return result;
  }

  private encodeWAV(samples: Float32Array, sampleRate: number): Blob {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);

    // RIFF chunk descriptor
    this.writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    this.writeString(view, 8, 'WAVE');

    // fmt sub-chunk
    this.writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
    view.setUint16(20, 1, true); // AudioFormat (1 = PCM)
    view.setUint16(22, 1, true); // NumChannels (1 = Mono)
    view.setUint32(24, sampleRate, true); // SampleRate (16000)
    view.setUint32(28, sampleRate * 2, true); // ByteRate (SampleRate * NumChannels * BitsPerSample/8)
    view.setUint16(32, 2, true); // BlockAlign (NumChannels * BitsPerSample/8)
    view.setUint16(34, 16, true); // BitsPerSample (16 bits)

    // data sub-chunk
    this.writeString(view, 36, 'data');
    view.setUint32(40, samples.length * 2, true);

    // Write PCM 16-bit samples
    let index = 44;
    for (let i = 0; i < samples.length; i++) {
      // Clamp between -1.0 and 1.0
      const s = Math.max(-1, Math.min(1, samples[i]));
      // Convert float [-1.0, 1.0] to int16 [-32768, 32767]
      view.setInt16(index, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      index += 2;
    }

    return new Blob([view], { type: 'audio/wav' });
  }

  private writeString(view: DataView, offset: number, string: string): void {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }
}
