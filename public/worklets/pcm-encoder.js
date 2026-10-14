/**
 * pcm-encoder.js
 *
 * AudioWorklet that converts incoming mono Float32 samples (at the
 * AudioContext's sample rate — caller is expected to use 16000) into
 * little-endian 16-bit PCM and posts batched Int16Array chunks to the
 * main thread. Used by lib/gemini-live.ts for Gemini Live capture.
 */

const FRAME_MS = 100;

class PcmEncoderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = [];
    // sampleRate is a global injected into AudioWorkletGlobalScope
    this.batchSize = Math.max(160, Math.floor((sampleRate * FRAME_MS) / 1000));
  }

  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;

    for (let i = 0; i < input.length; i++) {
      this.buffer.push(input[i]);
    }

    while (this.buffer.length >= this.batchSize) {
      const slice = this.buffer.splice(0, this.batchSize);
      const int16 = new Int16Array(slice.length);
      for (let i = 0; i < slice.length; i++) {
        const v = Math.max(-1, Math.min(1, slice[i]));
        int16[i] = v < 0 ? Math.round(v * 32768) : Math.round(v * 32767);
      }
      // Transfer the underlying buffer to avoid copy
      this.port.postMessage(int16, [int16.buffer]);
    }
    return true;
  }
}

registerProcessor("pcm-encoder", PcmEncoderProcessor);
