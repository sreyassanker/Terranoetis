/**
 * Voice PCM16 Processor — captures mic audio as base64 PCM16 (24 kHz mono)
 * chunks for the OpenAI Realtime voice bridge. Runs on the Web Audio audio
 * thread; sends chunks to the main thread via the port.
 */
class VoicePcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Int16Array(4800); // 200ms @ 24kHz
    this.bufferIndex = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const samples = input[0];

    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      this.buffer[this.bufferIndex++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.bufferIndex >= this.buffer.length) {
        this.flush();
      }
    }
    return true;
  }

  flush() {
    if (this.bufferIndex === 0) return;
    const bytes = new Uint8Array(this.bufferIndex * 2);
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < this.bufferIndex; i++) {
      view.setInt16(i * 2, this.buffer[i], true);
    }
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    this.port.postMessage({ data: btoa(binary) });
    this.bufferIndex = 0;
  }
}

registerProcessor('voice-pcm-processor', VoicePcmProcessor);
