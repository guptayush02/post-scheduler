import { useEffect, useRef, useState } from 'react'

const MAX_SECONDS = 90 // reels top out at 90s (posts.py MAX_REEL_SECONDS)

// Recording formats in order of preference - Chrome/Firefox do Opus in
// WebM/Ogg, Safari only AAC in MP4. The backend accepts all of these.
const FORMATS: { mime: string; ext: string }[] = [
  { mime: 'audio/webm;codecs=opus', ext: 'webm' },
  { mime: 'audio/webm', ext: 'webm' },
  { mime: 'audio/mp4', ext: 'm4a' },
  { mime: 'audio/ogg;codecs=opus', ext: 'ogg' },
]

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// Records a voiceover from the microphone. While recording, `videoUrl`
// (the reel's last render) plays muted from the start right next to the
// button, so the user can talk along with it and the voice lines up with
// the reel - the recording is laid in from the reel's first second.
export default function VoiceRecorder({
  onRecorded,
  videoUrl,
}: {
  onRecorded: (file: File, seconds: number) => void
  videoUrl?: string | null
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const syncVideo = videoUrl ? () => videoRef.current : undefined
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const startedAt = useRef(0)
  const timer = useRef<number | undefined>(undefined)

  const cleanup = () => {
    window.clearInterval(timer.current)
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    const video = syncVideo?.()
    if (video) video.pause()
  }

  // Stop the mic if the page goes away mid-recording.
  useEffect(() => () => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
    cleanup()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const start = async () => {
    setError(null)
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError("This browser can't record audio - upload a voiceover file instead.")
      return
    }
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      })
    } catch {
      setError('Microphone access was blocked - allow it in the browser (address bar) and try again.')
      return
    }
    const format = FORMATS.find((f) => MediaRecorder.isTypeSupported(f.mime))
    const recorder = format ? new MediaRecorder(stream, { mimeType: format.mime }) : new MediaRecorder(stream)
    const chunks: Blob[] = []
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data)
    }
    recorder.onstop = () => {
      const seconds = (Date.now() - startedAt.current) / 1000
      const type = recorder.mimeType || format?.mime || 'audio/webm'
      const ext = FORMATS.find((f) => type.startsWith(f.mime.split(';')[0]))?.ext ?? 'webm'
      cleanup()
      setRecording(false)
      if (chunks.length) {
        onRecorded(new File(chunks, `voiceover-${Date.now()}.${ext}`, { type: type.split(';')[0] }), seconds)
      }
    }

    streamRef.current = stream
    recorderRef.current = recorder
    const video = syncVideo?.()
    if (video) {
      video.muted = true
      video.currentTime = 0
      video.play().catch(() => undefined)
    }
    recorder.start(250)
    startedAt.current = Date.now()
    setElapsed(0)
    setRecording(true)
    timer.current = window.setInterval(() => {
      const secs = (Date.now() - startedAt.current) / 1000
      setElapsed(secs)
      if (secs >= MAX_SECONDS) recorder.stop()
    }, 200)
  }

  const stop = () => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
  }

  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
      <div className="flex flex-wrap items-center gap-3">
        {recording ? (
          <button
            type="button"
            onClick={stop}
            className="flex items-center gap-2 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500"
          >
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-white" aria-hidden />
            Stop · {formatTime(elapsed)}
          </button>
        ) : (
          <button
            type="button"
            onClick={start}
            className="flex items-center gap-2 rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50"
          >
            <span className="h-2.5 w-2.5 rounded-full bg-red-600" aria-hidden />
            Record voiceover
          </button>
        )}
        <p className="text-xs text-gray-500">
          {recording
            ? syncVideo ? 'Recording… talk along with the video below, then hit Stop.' : 'Recording… hit Stop when you are done.'
            : syncVideo
              ? 'Your last render plays (muted) while you record, so your voice lines up with the reel.'
              : 'Speak into your microphone - the recording starts at the beginning of the reel.'}
        </p>
      </div>
      {videoUrl && (
        <video
          ref={videoRef}
          src={videoUrl}
          muted
          playsInline
          className={`mt-2 max-h-56 rounded bg-black ${recording ? '' : 'hidden'}`}
        />
      )}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  )
}
