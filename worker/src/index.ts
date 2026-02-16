interface Env {
  BUCKET: R2Bucket
}

const MAX_FILE_SIZE = 1 * 1024 * 1024 * 1024 // 1GB
const CHUNK_SIZE = 80 * 1024 * 1024 // 80MB - must match frontend
const MAX_AGE_MS = 60 * 60 * 1000 // 1 hour
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Filename, Range',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS })
    }

    // Initialize chunked upload
    if (path === '/upload/init' && request.method === 'POST') {
      return handleUploadInit(request)
    }

    // Upload a chunk
    const chunkMatch = path.match(/^\/upload\/([a-f0-9-]+)\/chunk\/(\d+)$/)
    if (chunkMatch && request.method === 'PUT') {
      return handleChunkUpload(request, env, chunkMatch[1], parseInt(chunkMatch[2]))
    }

    // Finalize upload
    const finalizeMatch = path.match(/^\/upload\/([a-f0-9-]+)\/finalize$/)
    if (finalizeMatch && request.method === 'POST') {
      return handleFinalize(env, finalizeMatch[1], url)
    }

    // Serve or delete video
    const videoMatch = path.match(/^\/video\/([a-f0-9-]+)$/)
    if (videoMatch) {
      const id = videoMatch[1]

      if (request.method === 'POST' && url.searchParams.get('_method') === 'DELETE') {
        return handleDelete(id, env)
      }
      if (request.method === 'GET' || request.method === 'HEAD') {
        return handleServe(request, id, env)
      }
      if (request.method === 'DELETE') {
        return handleDelete(id, env)
      }
    }

    return serveSiteFile(env, path)
  },

  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    const cutoff = Date.now() - MAX_AGE_MS

    // Clean up completed videos
    const videos = await env.BUCKET.list({ prefix: 'videos/' })
    for (const object of videos.objects) {
      if (object.uploaded.getTime() < cutoff) {
        await env.BUCKET.delete(object.key)
      }
    }

    // Clean up stale chunks
    const chunks = await env.BUCKET.list({ prefix: 'chunks/' })
    for (const object of chunks.objects) {
      if (object.uploaded.getTime() < cutoff) {
        await env.BUCKET.delete(object.key)
      }
    }

    // Clean up stale metadata
    const meta = await env.BUCKET.list({ prefix: 'meta/' })
    for (const object of meta.objects) {
      if (object.uploaded.getTime() < cutoff) {
        await env.BUCKET.delete(object.key)
      }
    }
  },
}

// --- Chunked Upload ---

function handleUploadInit(request: Request): Response {
  const contentType = request.headers.get('Content-Type')
  if (contentType !== 'application/json') {
    return json({ error: 'Expected JSON' }, 400)
  }

  return request.json<{ size: number; contentType: string; filename: string }>().then((body) => {
    if (body.size > MAX_FILE_SIZE) {
      return json({ error: `File too large (max ${Math.round(MAX_FILE_SIZE / (1024 * 1024))}MB)` }, 413)
    }

    const id = crypto.randomUUID()
    const totalChunks = Math.ceil(body.size / CHUNK_SIZE)

    return json({ id, totalChunks }, 200)
  })
}

async function handleChunkUpload(
  request: Request,
  env: Env,
  id: string,
  chunkIndex: number
): Promise<Response> {
  if (!request.body) {
    return json({ error: 'No data' }, 400)
  }

  const key = `chunks/${id}/${chunkIndex}`
  await env.BUCKET.put(key, request.body)

  return json({ ok: true }, 200)
}

async function handleFinalize(env: Env, id: string, url: URL): Promise<Response> {
  // List all chunks for this upload
  const listed = await env.BUCKET.list({ prefix: `chunks/${id}/` })
  const chunkKeys = listed.objects
    .map((o) => ({ key: o.key, index: parseInt(o.key.split('/').pop()!) }))
    .sort((a, b) => a.index - b.index)

  if (chunkKeys.length === 0) {
    return json({ error: 'No chunks found' }, 400)
  }

  // For single chunk, just rename it
  if (chunkKeys.length === 1) {
    const chunk = await env.BUCKET.get(chunkKeys[0].key)
    if (!chunk) return json({ error: 'Chunk not found' }, 500)

    const videoKey = `videos/${id}`
    await env.BUCKET.put(videoKey, chunk.body, {
      httpMetadata: { contentType: 'video/mp4' },
      customMetadata: { uploadedAt: Date.now().toString() },
    })
    await env.BUCKET.delete(chunkKeys[0].key)

    return json({ id, url: `${url.origin}/video/${id}` }, 200)
  }

  // For multiple chunks, concatenate using R2 multipart upload
  const videoKey = `videos/${id}`
  const multipart = await env.BUCKET.createMultipartUpload(videoKey, {
    httpMetadata: { contentType: 'video/mp4' },
    customMetadata: { uploadedAt: Date.now().toString() },
  })

  try {
    const parts: R2UploadedPart[] = []

    for (let i = 0; i < chunkKeys.length; i++) {
      const chunk = await env.BUCKET.get(chunkKeys[i].key)
      if (!chunk) throw new Error(`Missing chunk ${i}`)

      const part = await multipart.uploadPart(i + 1, chunk.body)
      parts.push(part)
    }

    await multipart.complete(parts)

    // Clean up chunks
    for (const chunk of chunkKeys) {
      await env.BUCKET.delete(chunk.key)
    }

    return json({ id, url: `${url.origin}/video/${id}` }, 200)
  } catch (e) {
    await multipart.abort()
    return json({ error: 'Failed to assemble video' }, 500)
  }
}

// --- Video Serving ---

async function handleServe(request: Request, id: string, env: Env): Promise<Response> {
  const key = `videos/${id}`
  const rangeHeader = request.headers.get('Range')

  const options: R2GetOptions = {}
  if (rangeHeader) {
    const match = rangeHeader.match(/bytes=(\d+)-(\d*)/)
    if (match) {
      const start = parseInt(match[1])
      const end = match[2] ? parseInt(match[2]) : undefined
      options.range = end !== undefined
        ? { offset: start, length: end - start + 1 }
        : { offset: start }
    }
  }

  const object = await env.BUCKET.get(key, options)
  if (!object) {
    return json({ error: 'Not found' }, 404)
  }

  const headers: Record<string, string> = {
    ...CORS_HEADERS,
    'Content-Type': object.httpMetadata?.contentType || 'video/mp4',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=3600',
  }

  if (rangeHeader && object.range) {
    const range = object.range as { offset: number; length: number }
    const start = range.offset
    const end = start + range.length - 1
    headers['Content-Range'] = `bytes ${start}-${end}/${object.size}`
    headers['Content-Length'] = range.length.toString()

    return request.method === 'HEAD'
      ? new Response(null, { status: 206, headers })
      : new Response(object.body, { status: 206, headers })
  }

  headers['Content-Length'] = object.size.toString()

  return request.method === 'HEAD'
    ? new Response(null, { status: 200, headers })
    : new Response(object.body, { status: 200, headers })
}

async function handleDelete(id: string, env: Env): Promise<Response> {
  // Delete video
  await env.BUCKET.delete(`videos/${id}`)

  // Also clean up any leftover chunks
  const chunks = await env.BUCKET.list({ prefix: `chunks/${id}/` })
  for (const obj of chunks.objects) {
    await env.BUCKET.delete(obj.key)
  }

  return json({ ok: true }, 200)
}

// --- Site Serving ---

async function serveSiteFile(env: Env, path: string): Promise<Response> {
  let key = path === '/' ? 'index.html' : path.slice(1)
  let file = await env.BUCKET.get(key)

  if (!file) {
    key = 'index.html'
    file = await env.BUCKET.get(key)
  }

  if (!file) {
    return new Response('Not Found', { status: 404 })
  }

  return new Response(file.body, {
    headers: {
      'Content-Type': getContentType(key),
      'Cache-Control': key === 'index.html'
        ? 'no-cache'
        : 'public, max-age=31536000, immutable',
    },
  })
}

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  })
}

function getContentType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase()
  const types: Record<string, string> = {
    html: 'text/html; charset=utf-8',
    css: 'text/css; charset=utf-8',
    js: 'application/javascript; charset=utf-8',
    json: 'application/json',
    svg: 'image/svg+xml',
    png: 'image/png',
    jpg: 'image/jpeg',
    ico: 'image/x-icon',
  }
  return types[ext || ''] || 'application/octet-stream'
}
