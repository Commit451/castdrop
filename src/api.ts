const WORKER_URL = import.meta.env.VITE_WORKER_URL || ''

interface UploadResult {
  id: string
  url: string
}

export async function uploadVideo(
  file: File,
  onProgress: (progress: number) => void
): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${WORKER_URL}/upload`)

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100))
      }
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText))
        } catch {
          reject(new Error('Invalid server response'))
        }
      } else {
        reject(new Error(`Upload failed (${xhr.status})`))
      }
    }

    xhr.onerror = () => reject(new Error('Network error during upload'))

    xhr.setRequestHeader('Content-Type', file.type || 'video/mp4')
    xhr.setRequestHeader('X-Filename', encodeURIComponent(file.name))
    xhr.send(file)
  })
}

export async function deleteVideo(id: string): Promise<void> {
  await fetch(`${WORKER_URL}/video/${id}`, { method: 'DELETE' })
}
