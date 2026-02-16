const WORKER_URL = import.meta.env.VITE_WORKER_URL || ''

interface UploadResult {
  id: string
  url: string
}

export async function uploadVideo(
  file: File,
  onProgress: (progress: number) => void
): Promise<UploadResult> {
  // Start with indeterminate progress since Cloudflare buffers uploads
  onProgress(-1)

  const response = await fetch(`${WORKER_URL}/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': file.type || 'video/mp4',
      'X-Filename': encodeURIComponent(file.name),
    },
    body: file,
  })

  if (!response.ok) {
    const text = await response.text()
    let message = `Upload failed (${response.status})`
    try {
      const json = JSON.parse(text)
      if (json.error) message = json.error
    } catch { /* ignore */ }
    throw new Error(message)
  }

  onProgress(100)
  return response.json()
}

export async function deleteVideo(id: string): Promise<void> {
  await fetch(`${WORKER_URL}/video/${id}`, { method: 'DELETE' })
}
