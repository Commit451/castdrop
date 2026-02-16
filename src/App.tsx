import { useState, useCallback, useRef, useEffect } from 'react'
import { DropZone } from './components/DropZone'
import { Player } from './components/Player'
import { UploadProgress } from './components/UploadProgress'
import { uploadVideo, deleteVideo } from './api'
import './App.css'

type AppState =
  | { phase: 'idle' }
  | { phase: 'uploading'; file: File; progress: number }
  | { phase: 'ready'; file: File; videoUrl: string; videoId: string }
  | { phase: 'error'; message: string }

export default function App() {
  const [state, setState] = useState<AppState>({ phase: 'idle' })
  const videoIdRef = useRef<string | null>(null)

  // Cleanup on page unload
  useEffect(() => {
    const cleanup = () => {
      if (videoIdRef.current) {
        // Use sendBeacon for reliability on page close
        const url = `${import.meta.env.VITE_WORKER_URL || ''}/video/${videoIdRef.current}`
        navigator.sendBeacon(url + '?_method=DELETE')
      }
    }
    window.addEventListener('beforeunload', cleanup)
    return () => window.removeEventListener('beforeunload', cleanup)
  }, [])

  const handleFile = useCallback(async (file: File) => {
    // Clean up previous upload if any
    if (videoIdRef.current) {
      deleteVideo(videoIdRef.current).catch(() => {})
      videoIdRef.current = null
    }

    setState({ phase: 'uploading', file, progress: 0 })

    try {
      const result = await uploadVideo(file, (progress) => {
        setState(prev => prev.phase === 'uploading' ? { ...prev, progress } : prev)
      })
      videoIdRef.current = result.id
      setState({ phase: 'ready', file, videoUrl: result.url, videoId: result.id })
    } catch (e) {
      setState({ phase: 'error', message: e instanceof Error ? e.message : 'Upload failed' })
    }
  }, [])

  const handleReset = useCallback(() => {
    if (videoIdRef.current) {
      deleteVideo(videoIdRef.current).catch(() => {})
      videoIdRef.current = null
    }
    setState({ phase: 'idle' })
  }, [])

  return (
    <div className="app">
      <h1>📺 CastDrop</h1>
      <p className="subtitle">Drop a video. Cast it to your TV.</p>

      {state.phase === 'idle' && (
        <DropZone onFile={handleFile} />
      )}

      {state.phase === 'uploading' && (
        <UploadProgress filename={state.file.name} progress={state.progress} />
      )}

      {state.phase === 'ready' && (
        <Player
          videoUrl={state.videoUrl}
          filename={state.file.name}
          onReset={handleReset}
        />
      )}

      {state.phase === 'error' && (
        <div className="error-card">
          <p>{state.message}</p>
          <button onClick={() => setState({ phase: 'idle' })}>Try again</button>
        </div>
      )}
    </div>
  )
}
