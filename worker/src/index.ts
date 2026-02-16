interface Env {
  BUCKET: R2Bucket
}

const MAX_FILE_SIZE = 500 * 1024 * 1024 // 500MB
const MAX_AGE_MS = 60 * 60 * 1000 // 1 hour
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Filename, Range',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS })
    }

    // Upload video
    if (path === '/upload' && request.method === 'POST') {
      return handleUpload(request, env, url)
    }

    // Serve or delete video
    const videoMatch = path.match(/^\/video\/([a-f0-9-]+)$/)
    if (videoMatch) {
      const id = videoMatch[1]

      // sendBeacon DELETE workaround (beacons are POST with query param)
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

    // Serve site files (SPA)
    return serveSiteFile(env, path)
  },

  // Scheduled cleanup of expired videos
  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    const cutoff = Date.now() - MAX_AGE_MS
    const listed = await env.BUCKET.list({ prefix: 'videos/' })

    for (const object of listed.objects) {
      if (object.uploaded.getTime() < cutoff) {
        await env.BUCKET.delete(object.key)
      }
    }
  },
}

async function handleUpload(request: Request, env: Env, url: URL): Promise<Response> {
  const contentLength = parseInt(request.headers.get('Content-Length') || '0')
  if (contentLength > MAX_FILE_SIZE) {
    return json({ error: 'File too large (max 500MB)' }, 413)
  }

  if (!request.body) {
    return json({ error: 'No file provided' }, 400)
  }

  const contentType = request.headers.get('Content-Type') || 'video/mp4'
  const id = crypto.randomUUID()
  const key = `videos/${id}`

  await env.BUCKET.put(key, request.body, {
    httpMetadata: { contentType },
    customMetadata: { uploadedAt: Date.now().toString() },
  })

  const videoUrl = `${url.origin}/video/${id}`

  return json({ id, url: videoUrl }, 201)
}

async function handleServe(request: Request, id: string, env: Env): Promise<Response> {
  const key = `videos/${id}`
  const rangeHeader = request.headers.get('Range')

  // Use get with onlyIf for range requests
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

    if (request.method === 'HEAD') {
      return new Response(null, { status: 206, headers })
    }
    return new Response(object.body, { status: 206, headers })
  }

  headers['Content-Length'] = object.size.toString()

  if (request.method === 'HEAD') {
    return new Response(null, { status: 200, headers })
  }
  return new Response(object.body, { status: 200, headers })
}

async function handleDelete(id: string, env: Env): Promise<Response> {
  await env.BUCKET.delete(`videos/${id}`)
  return json({ ok: true }, 200)
}

async function serveSiteFile(env: Env, path: string): Promise<Response> {
  let key = path === '/' ? 'index.html' : path.slice(1)

  let file = await env.BUCKET.get(key)

  // SPA fallback
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
        ? 'public, max-age=300'
        : 'public, max-age=31536000, immutable',
    },
  })
}

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
    },
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
