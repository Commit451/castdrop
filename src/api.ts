const WORKER_URL = import.meta.env.VITE_WORKER_URL || ''
const CHUNK_SIZE = 80 * 1024 * 1024 // 80MB per chunk (under CF 100MB limit)

interface UploadResult {
  id: string
  url: string
}

interface UploadCallbacks {
  onProgress: (progress: number) => void
  onFinalizing: () => void
}

export async function uploadVideo(
  file: File,
  callbacks: UploadCallbacks
): Promise<UploadResult> {
  // Step 1: Initialize upload
  const initRes = await fetch(`${WORKER_URL}/upload/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename: file.name,
      contentType: file.type || 'video/mp4',
      size: file.size,
    }),
  })

  if (!initRes.ok) {
    const err = await initRes.json().catch(() => ({ error: 'Upload init failed' }))
    throw new Error((err as { error: string }).error || `Init failed (${initRes.status})`)
  }

  const { id, totalChunks } = await initRes.json() as { id: string; totalChunks: number }

  // Step 2: Upload chunks
  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE
    const end = Math.min(start + CHUNK_SIZE, file.size)
    const chunk = file.slice(start, end)

    const res = await fetch(`${WORKER_URL}/upload/${id}/chunk/${i}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: chunk,
    })

    if (!res.ok) {
      throw new Error(`Chunk ${i + 1}/${totalChunks} failed (${res.status})`)
    }

    callbacks.onProgress(Math.round(((i + 1) / totalChunks) * 100))
  }

  // Step 3: Finalize
  callbacks.onFinalizing()

  const finalRes = await fetch(`${WORKER_URL}/upload/${id}/finalize`, {
    method: 'POST',
  })

  if (!finalRes.ok) {
    throw new Error('Failed to finalize upload')
  }

  return finalRes.json()
}

export async function deleteVideo(id: string): Promise<void> {
  await fetch(`${WORKER_URL}/video/${id}`, { method: 'DELETE' })
}
