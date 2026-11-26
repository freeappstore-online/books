/**
 * Narrates chapters on this device for community narration (books#66), off the main thread: the
 * platform's shared Kokoro runner (@freeappstore/sdk/generation-kokoro, platform#795), which
 * splits and times sentences exactly as scripts/audio/segments.py does. The model's WebAssembly
 * runtime is served from this app, not a CDN.
 */
import { serveKokoroWorker } from '@freeappstore/sdk/generation-kokoro/worker'

serveKokoroWorker({
  wasmPaths: {
    wasm: new URL('../../node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.wasm', import.meta.url).href,
    mjs: new URL('../../node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.mjs', import.meta.url).href,
  },
})
