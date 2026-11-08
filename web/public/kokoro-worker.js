/**
 * Kokoro TTS Web Worker
 * Runs model inference off the main thread so UI doesn't freeze.
 *
 * Messages:
 *   main → worker: { type: 'init' }
 *   main → worker: { type: 'generate', id, text, voice, speed }
 *   main → worker: { type: 'stop' }
 *   worker → main: { type: 'ready' }
 *   worker → main: { type: 'audio', id, audio: Float32Array, sampleRate: number }
 *   worker → main: { type: 'error', id?, error: string }
 *   worker → main: { type: 'progress', pct: number }
 */

let tts = null
let runtime = {
  device: null,
  dtype: null,
}

async function loadTts() {
  const { KokoroTTS } = await import('https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/+esm')
  const candidates = []

  if (typeof navigator !== 'undefined' && navigator.gpu) {
    candidates.push({ device: 'webgpu', dtype: 'fp32' })
  }
  candidates.push({ device: 'wasm', dtype: 'q8' })

  let lastError = null
  for (const candidate of candidates) {
    try {
      self.postMessage({ type: 'progress', pct: candidate.device === 'webgpu' ? 25 : 60 })
      const loaded = await KokoroTTS.from_pretrained(
        'onnx-community/Kokoro-82M-v1.0-ONNX',
        { dtype: candidate.dtype, device: candidate.device }
      )
      runtime = candidate
      return loaded
    } catch (err) {
      lastError = err
      self.postMessage({
        type: 'log',
        level: 'warn',
        message: `[KokoroWorker] ${candidate.device} init failed: ${err?.message || String(err)}`,
      })
    }
  }

  throw lastError || new Error('Failed to initialize Kokoro runtime')
}

self.onmessage = async (e) => {
  const { type } = e.data

  if (type === 'init') {
    try {
      self.postMessage({ type: 'progress', pct: 0 })
      self.postMessage({ type: 'progress', pct: 10 })
      tts = await loadTts()
      self.postMessage({ type: 'progress', pct: 100 })
      self.postMessage({ type: 'ready', device: runtime.device, dtype: runtime.dtype })
    } catch (err) {
      self.postMessage({ type: 'error', error: err?.message || String(err) })
    }
    return
  }

  if (type === 'generate') {
    const { id, text, voice, speed } = e.data
    if (!tts) {
      self.postMessage({ type: 'error', id, error: 'Model not loaded' })
      return
    }
    try {
      const result = await tts.generate(text, { voice, speed })
      // Transfer the audio buffer (zero-copy)
      self.postMessage(
        { type: 'audio', id, audio: result.audio, sampleRate: result.sampling_rate },
        [result.audio.buffer]
      )
    } catch (err) {
      self.postMessage({ type: 'error', id, error: err?.message || String(err) })
    }
    return
  }
}
