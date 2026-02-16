import { useState, useRef, useCallback } from 'react'
import './DropZone.css'

interface DropZoneProps {
  onFile: (file: File) => void
}

export function DropZone({ onFile }: DropZoneProps) {
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file?.type.startsWith('video/')) {
      onFile(file)
    }
  }, [onFile])

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) onFile(file)
  }, [onFile])

  return (
    <div
      className={`drop-zone ${dragOver ? 'dragover' : ''}`}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      <div className="drop-icon">🎬</div>
      <div className="drop-text">Drag & drop a video here</div>
      <div className="drop-hint">or click to browse</div>
      <div className="drop-format-hint">MP4 recommended for best casting compatibility</div>
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        onChange={handleChange}
      />
    </div>
  )
}
