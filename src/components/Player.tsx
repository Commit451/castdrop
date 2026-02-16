import { useRef, useState, useEffect } from 'react'
import { CastButton } from './CastButton'
import './Player.css'

interface PlayerProps {
  videoUrl: string
  filename: string
  onReset: () => void
}

export function Player({ videoUrl, filename, onReset }: PlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [castAvailable, setCastAvailable] = useState(false)

  useEffect(() => {
    // Check if Cast API is available
    const checkCast = () => {
      const cast = (window as any).chrome?.cast
      if (cast) {
        setCastAvailable(true)
      }
    }

    // The Cast SDK fires this event when ready
    (window as any).__onGCastApiAvailable = (isAvailable: boolean) => {
      if (isAvailable) {
        initializeCast()
        setCastAvailable(true)
      }
    }

    // If already loaded
    checkCast()
  }, [])

  return (
    <div className="player">
      <div className="player-header">
        <span className="player-filename">{filename}</span>
        <div className="player-actions">
          {castAvailable && <CastButton videoUrl={videoUrl} />}
          <button className="reset-btn" onClick={onReset}>✕</button>
        </div>
      </div>
      <video
        ref={videoRef}
        className="player-video"
        src={videoUrl}
        controls
        autoPlay
        playsInline
      />
      {!castAvailable && (
        <div className="cast-hint">
          <strong>To cast:</strong> Use Chrome's built-in cast (⋮ → Save and share → Cast…) or install a Chromecast-enabled browser
        </div>
      )}
    </div>
  )
}

function initializeCast() {
  const cast = (window as any).chrome?.cast
  if (!cast) return

  const sessionRequest = new cast.SessionRequest(
    cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID
  )
  const apiConfig = new cast.ApiConfig(
    sessionRequest,
    () => {}, // session listener
    () => {}  // receiver listener
  )
  cast.initialize(apiConfig)
}
