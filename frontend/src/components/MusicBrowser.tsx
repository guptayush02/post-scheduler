import { useEffect, useRef, useState } from 'react'
import { searchMusic, type MusicTrack } from '../api/client'

const MOODS = ['Happy', 'Upbeat', 'Chill', 'Cinematic', 'Piano', 'Acoustic', 'Electronic', 'Hip hop', 'Rock', 'Indian']
const LICENSE_LABEL: Record<string, string> = { by: 'CC BY', cc0: 'CC0', pdm: 'Public domain' }

function formatTime(seconds: number | null): string {
  if (!seconds) return ''
  const s = Math.round(seconds)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// Search and preview free music (CC0 / public domain / CC BY, via the
// backend's Openverse proxy) and pick a track for the reel.
export default function MusicBrowser({
  selectedId,
  onPick,
}: {
  selectedId: string | null
  onPick: (track: MusicTrack) => void
}) {
  const [query, setQuery] = useState('Happy')
  const [results, setResults] = useState<MusicTrack[]>([])
  const [page, setPage] = useState(1)
  const [pageCount, setPageCount] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [playingId, setPlayingId] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  // Debounced search; a new query starts back at page 1.
  useEffect(() => {
    let alive = true
    const id = window.setTimeout(async () => {
      setLoading(true)
      setError(null)
      try {
        const data = await searchMusic(query, page)
        if (!alive) return
        setResults(data.results)
        setPageCount(data.page_count)
      } catch (err: any) {
        if (alive) setError(err?.response?.data?.detail ?? "Couldn't load music - try again")
      } finally {
        if (alive) setLoading(false)
      }
    }, 350)
    return () => {
      alive = false
      window.clearTimeout(id)
    }
  }, [query, page])

  useEffect(() => () => audioRef.current?.pause(), [])

  const togglePlay = (track: MusicTrack) => {
    const audio = audioRef.current
    if (!audio) return
    if (playingId === track.id) {
      audio.pause()
      setPlayingId(null)
      return
    }
    audio.src = track.preview_url
    audio.play().then(() => setPlayingId(track.id)).catch(() => setError("This track can't be previewed here"))
  }

  return (
    <div className="rounded-md border border-gray-200 bg-white p-3">
      <audio ref={audioRef} onEnded={() => setPlayingId(null)} />
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setPage(1)
        }}
        placeholder="Search free music - mood, genre, instrument…"
        className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
      />
      <div className="mt-2 flex flex-wrap gap-1.5">
        {MOODS.map((mood) => (
          <button
            key={mood}
            type="button"
            onClick={() => {
              setQuery(mood)
              setPage(1)
            }}
            className={`rounded-full border px-2.5 py-0.5 text-xs ${
              query === mood ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
          >
            {mood}
          </button>
        ))}
      </div>

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      <ul className="mt-2 max-h-72 divide-y divide-gray-100 overflow-y-auto">
        {loading && results.length === 0 && <li className="py-3 text-center text-xs text-gray-400">Loading…</li>}
        {!loading && results.length === 0 && !error && (
          <li className="py-3 text-center text-xs text-gray-400">No tracks found - try another word.</li>
        )}
        {results.map((track) => {
          const selected = track.id === selectedId
          return (
            <li key={track.id} className={`flex items-center gap-2 py-2 ${selected ? 'bg-indigo-50' : ''}`}>
              <button
                type="button"
                onClick={() => togglePlay(track)}
                aria-label={playingId === track.id ? `Pause ${track.title}` : `Play ${track.title}`}
                className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-gray-900 text-xs text-white hover:bg-gray-700"
              >
                {playingId === track.id ? '❚❚' : '▶'}
              </button>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-gray-900">{track.title}</p>
                <p className="truncate text-xs text-gray-500">
                  {track.creator}
                  {track.duration ? ` · ${formatTime(track.duration)}` : ''}
                  {track.genres.length ? ` · ${track.genres.slice(0, 2).join(', ')}` : ''}
                </p>
              </div>
              <span className="flex-none rounded bg-green-50 px-1.5 py-0.5 text-[10px] font-semibold text-green-700">
                {LICENSE_LABEL[track.license] ?? track.license}
              </span>
              <button
                type="button"
                onClick={() => onPick(track)}
                disabled={selected}
                className="flex-none rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-500 disabled:bg-green-600"
              >
                {selected ? 'Selected' : 'Use'}
              </button>
            </li>
          )
        })}
      </ul>
      {pageCount > 1 && (
        <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
          <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="hover:underline disabled:opacity-40">
            ← Previous
          </button>
          <span>Page {page}</span>
          <button
            type="button"
            disabled={page >= Math.min(pageCount, 12)}
            onClick={() => setPage((p) => p + 1)}
            className="hover:underline disabled:opacity-40"
          >
            Next →
          </button>
        </div>
      )}
      <p className="mt-2 text-[11px] text-gray-400">
        Free music from Openverse (mostly Jamendo artists). Only licenses that allow use in videos, including by
        businesses, are shown. CC BY tracks need credit - we add it to your post text automatically.
      </p>
    </div>
  )
}
