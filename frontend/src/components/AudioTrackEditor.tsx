import { useMemo, useState } from 'react'

// Shared styling for the two overlaid <input type=range> thumbs that make up
// the trim bar: the input itself is invisible/click-through
// (pointer-events-none) except for its thumb, so both handles stay
// independently draggable over the same track.
const RANGE_THUMB_CLASS =
  'absolute inset-0 h-5 w-full cursor-pointer appearance-none bg-transparent pointer-events-none ' +
  '[&::-webkit-slider-runnable-track]:bg-transparent ' +
  '[&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none ' +
  '[&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:rounded-full ' +
  '[&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white ' +
  '[&::-webkit-slider-thumb]:bg-indigo-600 [&::-webkit-slider-thumb]:shadow ' +
  '[&::-moz-range-track]:bg-transparent ' +
  '[&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 ' +
  '[&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white ' +
  '[&::-moz-range-thumb]:bg-indigo-600'

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export default function AudioTrackEditor({
  label,
  existingUrl,
  hasExisting,
  file,
  onFileChange,
  start,
  onStartChange,
  end,
  onEndChange,
  onRemove,
}: {
  label: string
  existingUrl: string | null
  hasExisting: boolean
  file: File | null
  onFileChange: (file: File | null) => void
  start: number
  onStartChange: (start: number) => void
  end: number | null
  onEndChange: (end: number | null) => void
  onRemove: () => void
}) {
  const [duration, setDuration] = useState<number | null>(null)

  const objectUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file])
  const src = objectUrl ?? (hasExisting ? existingUrl ?? undefined : undefined)
  const endOrDuration = end ?? duration ?? 0

  return (
    <div>
      <label className="block text-xs font-medium text-gray-500">
        {hasExisting ? `Replace ${label.toLowerCase()}` : `\u{1F3B5} Add ${label.toLowerCase()}`}
      </label>
      <input
        type="file"
        accept="audio/*"
        onChange={(e) => {
          onFileChange(e.target.files?.[0] ?? null)
          setDuration(null)
        }}
        className="mt-1 block w-full text-sm text-gray-700 file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-indigo-600 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-indigo-500"
      />
      {file && <p className="mt-1 text-xs text-gray-600">Selected: {file.name}</p>}

      {src && (
        <>
          <audio
            controls
            src={src}
            className="mt-2 w-full"
            onLoadedMetadata={(e) => {
              const d = e.currentTarget.duration
              setDuration(d)
              onEndChange(end == null ? d : Math.min(end, d))
            }}
          />
          {duration != null && (
            <div className="mt-3">
              <div className="flex justify-between text-xs text-gray-500">
                <span>{formatTime(start)}</span>
                <span>Trim</span>
                <span>{formatTime(duration)}</span>
              </div>
              <div className="relative mt-1 h-5">
                <div className="absolute top-1/2 h-1.5 w-full -translate-y-1/2 rounded-full bg-gray-200" />
                <div
                  className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-indigo-400"
                  style={{
                    left: `${(start / duration) * 100}%`,
                    width: `${((endOrDuration - start) / duration) * 100}%`,
                  }}
                />
                <input
                  type="range"
                  min={0}
                  max={duration}
                  step={0.1}
                  value={start}
                  onChange={(e) => onStartChange(Math.min(Number(e.target.value), endOrDuration - 0.5))}
                  className={RANGE_THUMB_CLASS}
                />
                <input
                  type="range"
                  min={0}
                  max={duration}
                  step={0.1}
                  value={endOrDuration}
                  onChange={(e) => onEndChange(Math.max(Number(e.target.value), start + 0.5))}
                  className={RANGE_THUMB_CLASS}
                />
              </div>
              <p className="mt-1 text-xs text-gray-400">
                {formatTime(start)} – {formatTime(endOrDuration)} plays once, then stays silent (no
                looping) if shorter than the video.
              </p>
            </div>
          )}
        </>
      )}

      {hasExisting && !file && (
        <button type="button" onClick={onRemove} className="mt-2 text-xs text-red-600 hover:underline">
          Remove {label.toLowerCase()}
        </button>
      )}
    </div>
  )
}
