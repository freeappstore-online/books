/// <reference lib="webworker" />
/**
 * Narrates one chapter on this device for community narration (books#66), off the main thread.
 *
 * As scripts/audio/generate.py does: Kokoro v1.0 speaks the chapter a sentence at a time
 * (narrationText.ts splits it as segments.py does), with 0.4 s between sentences and 0.8 s between
 * paragraphs, so each sentence's time is exact: segments [[charStart, charEnd, startSec, endSec], …].
 * The audio is encoded as it comes (WebCodecs AAC, mono) into an MP4, so a long chapter never sits
 * in memory as raw samples. The model runs on WebGPU when there is one, else in WebAssembly; its
 * files are kept in Cache Storage (transformers-cache, kokoro-voices) for the next chapter.
 *
 * main → worker: { type: 'narrate', id, text, voice, speed, config: AudioEncoderConfig } | { type: 'cancel' }
 * worker → main: { type: 'loading', progress } | { type: 'progress', id, done, total }
 *              | { type: 'done', id, file: Blob, segments } | { type: 'error', id, message }
 * A new narrate, or cancel, stops the chapter in progress at its next sentence.
 */
import { KokoroTTS, env } from 'kokoro-js'
import { ArrayBufferTarget, Muxer } from 'mp4-muxer'
import { narrationSentences } from './narrationText'

// The model's WebAssembly runtime from this app, not a CDN
env.wasmPaths = {
  wasm: new URL('../../node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.wasm', import.meta.url).href,
  mjs: new URL('../../node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.mjs', import.meta.url).href,
}

const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX'
const RATE = 24_000 // Kokoro's sample rate
const SENTENCE_PAUSE = 0.4
const PARAGRAPH_PAUSE = 0.8
/** Characters Kokoro speaks in one go; its input is cut at 510 tokens, so longer sentences go in pieces */
const PIECE = 300

let tts: Promise<KokoroTTS> | null = null
/** The chapter being narrated; any other stops at its next sentence */
let active: number | null = null

async function load(): Promise<KokoroTTS> {
  const progress_callback = (p: { status: string; progress?: number }) => {
    if (p.status === 'progress' && p.progress !== undefined) post({ type: 'loading', progress: p.progress / 100 })
  }
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu
  if (gpu && await gpu.requestAdapter().catch(() => null)) {
    try {
      return await KokoroTTS.from_pretrained(MODEL, { dtype: 'fp32', device: 'webgpu', progress_callback })
    } catch {}
  }
  return KokoroTTS.from_pretrained(MODEL, { dtype: 'q8', device: 'wasm', progress_callback })
}

/** `text` in pieces of at most PIECE characters, cut after a comma, semicolon or dash, else a space. */
function pieces(text: string): string[] {
  const out: string[] = []
  let rest = text
  while (rest.length > PIECE) {
    const head = rest.slice(0, PIECE)
    const space = head.lastIndexOf(' ')
    const cut = Math.max(...[...head.matchAll(/[,;:—–]\s/g)].map(m => m.index + 1), 0) || (space > 0 ? space : PIECE)
    out.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut)
  }
  return [...out, rest.trim()]
}

/** Kokoro's samples for a sentence; empty when there is nothing to say (e.g. "* * *"). */
async function say(model: KokoroTTS, text: string, voice: string, speed: number): Promise<Float32Array<ArrayBuffer>> {
  const parts: Float32Array[] = []
  for (const piece of pieces(text)) {
    if (!/[\p{L}\p{N}]/u.test(piece)) continue
    parts.push((await model.generate(piece, { voice: voice as 'af_heart', speed })).audio)
  }
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  return out
}

/** Kokoro's 24 kHz samples at the encoder's rate (24 or 48 kHz) */
function resample(samples: Float32Array<ArrayBuffer>, rate: number): Float32Array<ArrayBuffer> {
  if (rate === RATE) return samples
  const out = new Float32Array(samples.length * 2)
  for (let i = 0; i < samples.length; i++) {
    out[2 * i] = samples[i]
    out[2 * i + 1] = (samples[i] + (samples[i + 1] ?? samples[i])) / 2
  }
  return out
}

async function narrate(id: number, text: string, voice: string, speed: number, config: AudioEncoderConfig) {
  tts ??= load()
  const model = await tts.catch(err => { tts = null; throw err })
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    audio: { codec: 'aac', numberOfChannels: 1, sampleRate: config.sampleRate },
    fastStart: 'in-memory',
  })
  let failure: unknown = null
  const encoder = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: e => { failure = e } })
  encoder.configure(config)
  let frames = 0 // at Kokoro's rate
  const feed = (samples: Float32Array<ArrayBuffer>) => {
    const data = resample(samples, config.sampleRate)
    encoder.encode(new AudioData({
      format: 'f32', sampleRate: config.sampleRate, numberOfChannels: 1, numberOfFrames: data.length,
      timestamp: Math.round(frames / RATE * 1e6), data,
    }))
    frames += samples.length
  }
  const segments: [number, number, number, number][] = []
  const sentences = narrationSentences(text)
  let pause = 0
  try {
    for (const [n, [start, end, endsParagraph]] of sentences.entries()) {
      if (active !== id) throw new Error('cancelled')
      if (failure) throw failure
      const samples = await say(model, text.slice(start, end), voice, speed)
      if (samples.length) {
        if (pause) feed(new Float32Array(Math.round(pause * RATE)))
        segments.push([start, end, round(frames / RATE), round((frames + samples.length) / RATE)])
        feed(samples)
        pause = endsParagraph ? PARAGRAPH_PAUSE : SENTENCE_PAUSE
      }
      post({ type: 'progress', id, done: n + 1, total: sentences.length })
    }
    await encoder.flush()
    if (failure) throw failure
  } finally {
    if (encoder.state !== 'closed') encoder.close()
  }
  muxer.finalize()
  return { file: new Blob([muxer.target.buffer], { type: 'audio/mp4' }), segments }
}

const round = (s: number) => Math.round(s * 1000) / 1000

function post(message: unknown) {
  self.postMessage(message)
}

self.onmessage = (e: MessageEvent) => {
  const msg = e.data
  if (msg.type === 'cancel') {
    active = null
    return
  }
  if (msg.type === 'narrate') {
    active = msg.id
    narrate(msg.id, msg.text, msg.voice, msg.speed, msg.config).then(
      result => post({ type: 'done', id: msg.id, ...result }),
      err => post({ type: 'error', id: msg.id, message: err instanceof Error ? err.message : String(err) }),
    )
  }
}
