import './UploadProgress.css'

interface UploadProgressProps {
  filename: string
  progress: number
}

export function UploadProgress({ filename, progress }: UploadProgressProps) {
  return (
    <div className="upload-progress">
      <div className="upload-icon">☁️</div>
      <div className="upload-filename">{filename}</div>
      <div className="progress-bar">
        <div className="progress-fill" style={{ width: `${progress}%` }} />
      </div>
      <div className="progress-text">{progress}%</div>
    </div>
  )
}

interface FinalizingProgressProps {
  filename: string
}

export function FinalizingProgress({ filename }: FinalizingProgressProps) {
  return (
    <div className="upload-progress">
      <div className="upload-icon">⚙️</div>
      <div className="upload-filename">{filename}</div>
      <div className="progress-bar indeterminate" />
      <div className="progress-text finalizing-text">Preparing your video for casting…</div>
    </div>
  )
}
