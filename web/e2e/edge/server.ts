/**
 * Test server for the offline edge cases (books#24): serves dist/ like the host
 * (static files, SPA fallback, ETags, no-cache) plus what `vite preview` can't:
 *
 * - /__slow.wav: a 900 s chapter that sends 12 s of audio and then hangs while
 *   `slow` is on, as a connection lost mid-stream.
 * - build "b": the same build with a changed index.html and the precache
 *   revision a rebuild would give it, so the service worker sees a new version.
 * - GET /__e2e?build=a|b&slow=0|1: switch those; it also drops hanging streams.
 *
 * Run by playwright.config.ts: node e2e/edge/server.ts <port>
 */
import { createServer, type ServerResponse } from 'node:http'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'

const PORT = Number(process.argv[2])
const DIST = new URL('../../dist/', import.meta.url).pathname

let build = 'a'
let slow = true
const hanging = new Set<ServerResponse>()

const md5 = (data: string | Buffer) => createHash('md5').update(data).digest('hex')
const types: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wav': 'audio/wav',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.webmanifest': 'application/manifest+json',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2',
}

/** A file of the build being served. */
function file(path: string): Buffer {
  const body = readFileSync(join(DIST, path))
  if (build === 'a') return body
  const html = readFileSync(join(DIST, 'index.html'), 'utf8').replace('</body>', '<!-- build-b --></body>')
  if (path === 'index.html') return Buffer.from(html)
  if (path === 'sw.js') {
    return Buffer.from(body.toString().replace(/\{url:"index\.html",revision:"[0-9a-f]+"\}/, `{url:"index.html",revision:"${md5(html)}"}`))
  }
  return body
}

function slowWav(range: string | undefined, res: ServerResponse) {
  // 48 kHz 16-bit stereo silence: 12 s is 2.3 MB, more than the browser buffers ahead at once
  const BPS = 192000
  const size = 44 + 900 * BPS
  const head = Buffer.alloc(44)
  head.write('RIFF', 0); head.writeUInt32LE(size - 8, 4); head.write('WAVEfmt ', 8); head.writeUInt32LE(16, 16)
  head.writeUInt16LE(1, 20); head.writeUInt16LE(2, 22); head.writeUInt32LE(48000, 24); head.writeUInt32LE(BPS, 28)
  head.writeUInt16LE(4, 32); head.writeUInt16LE(16, 34); head.write('data', 36); head.writeUInt32LE(size - 44, 40)
  const m = /bytes=(\d+)-/.exec(range ?? '')
  const start = m ? +m[1] : 0
  res.writeHead(m ? 206 : 200, {
    'content-type': 'audio/wav', 'content-length': size - start, 'accept-ranges': 'bytes',
    ...(m ? { 'content-range': `bytes ${start}-${size - 1}/${size}` } : {}),
  })
  const end = slow ? Math.min(size, 44 + 12 * BPS) : size
  let pos = start
  const zeros = Buffer.alloc(256 * 1024)
  const pump = () => {
    while (pos < end) {
      const chunk = pos < 44 ? head.subarray(pos) : zeros.subarray(0, Math.min(zeros.length, end - pos))
      pos += chunk.length
      if (!res.write(chunk)) return void res.once('drain', pump)
    }
    if (end === size) res.end()
    else hanging.add(res)
  }
  res.on('close', () => hanging.delete(res))
  pump()
}

createServer((req, res) => {
  const url = new URL(req.url!, `http://localhost:${PORT}`)
  const path = decodeURIComponent(url.pathname)
  if (path === '/__e2e') {
    build = url.searchParams.get('build') ?? build
    if (url.searchParams.has('slow')) slow = url.searchParams.get('slow') === '1'
    for (const r of hanging) r.destroy()
    hanging.clear()
    return res.end('ok')
  }
  if (path === '/__slow.wav') return slowWav(req.headers.range, res)
  let rel = path.slice(1)
  if (!rel || !existsSync(join(DIST, rel)) || statSync(join(DIST, rel)).isDirectory()) rel = 'index.html'
  const body = file(rel)
  const etag = `"${md5(body)}"`
  if (req.headers['if-none-match'] === etag) return res.writeHead(304, { etag }).end()
  res.writeHead(200, { 'content-type': types[extname(rel)] ?? 'application/octet-stream', 'cache-control': 'no-cache', etag })
  res.end(req.method === 'HEAD' ? undefined : body)
}).listen(PORT)
