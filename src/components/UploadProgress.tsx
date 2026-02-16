import './UploadProgress.css'

interface UploadProgressProps {
  filename: string
  progress: number
}

export function UploadProgress({ filename, progress }: UploadProgressProps) {
  const indeterminate = progress < 0

  return (
    <div className="upload-progress">
      <div className="upload-icon">☁️</div>
      <div className="upload-filename">{filename}</div>
      <div className={`progress-bar ${indeterminate ? 'indeterminate' : ''}`}>
        {!indeterminate && (
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        )}
      </div>
      <div className="progress-text">
        {indeterminate ? 'Uploading…' : `${progress}%`}
      </div>
    </div>
  )
}
