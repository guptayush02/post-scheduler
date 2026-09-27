import { useState } from 'react'
import {
  isVideoUrl,
  parseApiDate,
  regenerateReel,
  scheduleDraftPost,
  REEL_COLOR_FILTERS,
  REEL_TRANSITIONS,
  REEL_ZOOM_STYLES,
  type Post,
  type ReelTextLayer,
  type ReelZoomStyle,
} from '../api/client'
import ReelAnimationPreview from './ReelAnimationPreview'
import AudioTrackEditor from './AudioTrackEditor'
import TextLayerEditor from './TextLayerEditor'

const MIN_IMAGE_SECONDS = 2
const MAX_IMAGE_SECONDS = 60 // must match reel_generator.py
const XFADE_SECONDS = 1 // must match backend/app/services/reel_generator.py's XFADE_SECONDS

function toIsoString(datetimeLocalValue: string): string {
  return new Date(datetimeLocalValue).toISOString()
}

export default function PostPreviewModal({
  post,
  onClose,
  onScheduled,
  onRegenerated,
}: {
  post: Post
  onClose: () => void
  onScheduled?: () => void
  onRegenerated?: () => void
}) {
  const [scheduledAt, setScheduledAt] = useState('')
  const [scheduling, setScheduling] = useState(false)
  const [scheduleError, setScheduleError] = useState<string | null>(null)

  const imageCount = post.reel_source_image_urls?.length ?? 0
  const [imageDurations, setImageDurations] = useState<Record<number, number>>(() =>
    Object.fromEntries(
      Array.from({ length: imageCount }, (_, i) => [
        i,
        post.reel_image_durations?.[i] ?? Math.max(MIN_IMAGE_SECONDS, post.reel_target_seconds / (imageCount || 1)),
      ]),
    ),
  )
  // Keyed by original image index (same space as imageOrder's values, not
  // by on-screen position) so a customization stays with its image when
  // dragged to a new position. imageTransitions[i] = transition leaving
  // image i, going into whichever image follows it in the current order.
  const [imageTransitions, setImageTransitions] = useState<Record<number, string>>(() =>
    Object.fromEntries(
      Array.from({ length: imageCount }, (_, i) => [i, post.reel_image_transitions?.[i] ?? post.reel_transition]),
    ),
  )
  const [imageZoomStyles, setImageZoomStyles] = useState<Record<number, ReelZoomStyle>>(() =>
    Object.fromEntries(
      Array.from({ length: imageCount }, (_, i) => [
        i,
        post.reel_image_zoom_styles?.[i] ?? post.reel_zoom_style,
      ]),
    ),
  )
  // Text shown for the whole video. Defaults to the post's caption the way
  // generation already burns it in, so opening the editor doesn't silently
  // drop the caption that's currently on the video.
  const [textLayers, setTextLayers] = useState<ReelTextLayer[]>(() =>
    post.reel_text_layers ?? [
      { text: post.caption, font_size: 48, color: '#FFFFFF', position: 'bottom_center' },
    ],
  )
  // Per-image text, keyed by original image index like the other per-image
  // settings, so it stays with its image across reordering.
  const [imageTextLayers, setImageTextLayers] = useState<Record<number, ReelTextLayer[]>>(() =>
    Object.fromEntries(
      Array.from({ length: imageCount }, (_, i) => [i, post.reel_image_text_layers?.[i] ?? []]),
    ),
  )
  const [imageColorFilters, setImageColorFilters] = useState<Record<number, string>>(() =>
    Object.fromEntries(
      Array.from({ length: imageCount }, (_, i) => [i, post.reel_image_color_filters?.[i] ?? 'none']),
    ),
  )
  const [selectedPos, setSelectedPos] = useState(0)
  const [musicFile, setMusicFile] = useState<File | null>(null)
  const [musicStart, setMusicStart] = useState(post.reel_audio_start_seconds)
  const [musicEnd, setMusicEnd] = useState<number | null>(post.reel_audio_end_seconds)
  const [removeMusic, setRemoveMusic] = useState(false)
  const [voiceFile, setVoiceFile] = useState<File | null>(null)
  const [voiceStart, setVoiceStart] = useState(post.reel_voice_audio_start_seconds)
  const [voiceEnd, setVoiceEnd] = useState<number | null>(post.reel_voice_audio_end_seconds)
  const [removeVoice, setRemoveVoice] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [regenerateError, setRegenerateError] = useState<string | null>(null)

  // Original-index order the images currently render/regenerate in;
  // reordered by dragging thumbnails below.
  const [imageOrder, setImageOrder] = useState<number[]>(() =>
    (post.reel_source_image_urls ?? []).map((_, i) => i),
  )
  const [dragPos, setDragPos] = useState<number | null>(null)

  const isReadyDraft = post.status === 'draft'
  // A failed generation can be retried - the backend accepts regenerate for
  // it too - so the editor stays available instead of dead-ending the post.
  const canEditReel = post.status === 'draft' || post.status === 'generation_failed'
  const isReel = Boolean(post.reel_source_images && post.reel_source_images.length > 0)
  const hasExistingMusic = Boolean(post.reel_audio_path) && !removeMusic
  const hasExistingVoice = Boolean(post.reel_voice_audio_path) && !removeVoice

  const totalSeconds =
    Array.from({ length: imageCount }, (_, i) => imageDurations[i] ?? MIN_IMAGE_SECONDS).reduce(
      (sum, d) => sum + d,
      0,
    ) -
    Math.max(0, imageCount - 1) * XFADE_SECONDS

  const onImageDrop = (dropPos: number) => {
    if (dragPos === null || dragPos === dropPos) return
    setImageOrder((prev) => {
      const next = [...prev]
      const [moved] = next.splice(dragPos, 1)
      next.splice(dropPos, 0, moved)
      return next
    })
    setDragPos(null)
  }

  const onPickMusicFile = (file: File | null) => {
    setMusicFile(file)
    setRemoveMusic(false)
    setMusicStart(0)
    setMusicEnd(null)
  }

  const onPickVoiceFile = (file: File | null) => {
    setVoiceFile(file)
    setRemoveVoice(false)
    setVoiceStart(0)
    setVoiceEnd(null)
  }

  const onSchedule = async () => {
    if (!scheduledAt) {
      setScheduleError('Pick a date & time first')
      return
    }
    setScheduling(true)
    setScheduleError(null)
    try {
      await scheduleDraftPost(post.id, toIsoString(scheduledAt))
      onScheduled?.()
    } catch (err: any) {
      setScheduleError(err?.response?.data?.detail ?? 'Failed to schedule post')
    } finally {
      setScheduling(false)
    }
  }

  const onRegenerate = async () => {
    setRegenerating(true)
    setRegenerateError(null)
    try {
      await regenerateReel(post.id, {
        targetSeconds: totalSeconds,
        audio: musicFile,
        audioStart: musicStart,
        audioEnd: musicEnd,
        removeAudio: removeMusic,
        voiceAudio: voiceFile,
        voiceAudioStart: voiceStart,
        voiceAudioEnd: voiceEnd,
        removeVoiceAudio: removeVoice,
        imageOrder,
        imageTransitions: Array.from({ length: imageCount }, (_, i) => imageTransitions[i] ?? post.reel_transition),
        imageZoomStyles: Array.from({ length: imageCount }, (_, i) => imageZoomStyles[i] ?? post.reel_zoom_style),
        imageDurations: Array.from({ length: imageCount }, (_, i) => imageDurations[i] ?? MIN_IMAGE_SECONDS),
        textLayers: textLayers.filter((layer) => layer.text.trim()),
        imageTextLayers: Array.from({ length: imageCount }, (_, i) =>
          (imageTextLayers[i] ?? []).filter((layer) => layer.text.trim()),
        ),
        imageColorFilters: Array.from({ length: imageCount }, (_, i) => imageColorFilters[i] ?? 'none'),
      })
      onRegenerated?.()
    } catch (err: any) {
      setRegenerateError(err?.response?.data?.detail ?? 'Failed to regenerate reel')
    } finally {
      setRegenerating(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Post preview</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close">
            ✕
          </button>
        </div>

        {post.media_url && post.media_type === 'image' && (
          <img
            src={post.media_url}
            alt=""
            className="mt-4 max-h-96 w-full rounded-md object-contain bg-gray-100"
          />
        )}
        {post.media_url && post.media_type === 'video' && (
          <video
            src={post.media_url}
            controls
            className="mt-4 max-h-96 w-full rounded-md bg-gray-100"
          />
        )}
        {!post.media_url && post.status === 'generating_video' && (
          <p className="mt-4 text-sm text-purple-600 italic">Generating reel video&hellip;</p>
        )}
        {!post.media_url && post.status !== 'generating_video' && (
          <p className="mt-4 text-sm text-gray-400 italic">No media attached</p>
        )}

        <p className="mt-4 whitespace-pre-wrap text-sm text-gray-900">{post.caption}</p>

        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-gray-100 pt-4 text-xs text-gray-500">
          <dt>Scheduled for</dt>
          <dd className="text-gray-900">
            {post.scheduled_at ? parseApiDate(post.scheduled_at).toLocaleString() : 'Not scheduled yet'}
          </dd>
          <dt>Status</dt>
          <dd className="text-gray-900">{post.status}</dd>
          {post.social_account_name && (
            <>
              <dt>Account</dt>
              <dd className="text-gray-900">{post.social_account_name}</dd>
            </>
          )}
          {post.also_post_to_instagram && (
            <>
              <dt>Instagram</dt>
              <dd className="text-gray-900">
                {post.instagram_post_id ? 'posted' : post.instagram_error ? post.instagram_error : 'pending'}
              </dd>
            </>
          )}
        </dl>

        {post.reel_warning && (
          <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {post.reel_warning}
          </p>
        )}

        {post.status === 'generation_failed' && (
          <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-xs text-red-800">
            Last generation failed{post.error_message ? `: ${post.error_message}` : ''}. Adjust the
            settings below and hit Regenerate video to try again.
          </p>
        )}

        {canEditReel && isReel && (
          <div className="mt-4 border-t border-gray-100 pt-4">
            <label className="block text-sm font-medium text-gray-700">Edit reel</label>

            <div className="mt-2">
              <label className="block text-xs text-gray-500">
                Images (drag to reorder · click to edit its zoom/transition below)
              </label>
              <div className="mt-1 flex flex-wrap gap-2">
                {imageOrder.map((originalIndex, pos) => {
                  const src = post.reel_source_image_urls?.[originalIndex]
                  const Thumb = isVideoUrl(src) ? 'video' : 'img'
                  return (
                  <Thumb
                    key={originalIndex}
                    src={src}
                    {...(Thumb === 'video' ? { muted: true, playsInline: true } : { alt: `Image ${pos + 1}` })}
                    draggable
                    onDragStart={() => setDragPos(pos)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => onImageDrop(pos)}
                    onClick={() => setSelectedPos(pos)}
                    className={`h-16 w-16 cursor-grab rounded object-cover ring-2 ${
                      dragPos === pos
                        ? 'opacity-50 ring-indigo-400'
                        : selectedPos === pos
                          ? 'ring-indigo-600'
                          : 'ring-transparent'
                    }`}
                  />
                  )
                })}
              </div>
            </div>

            <div className="mt-3 flex gap-4">
              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-700">
                  Image {selectedPos + 1} of {imageOrder.length}
                </label>

                <label className="mt-2 block text-xs text-gray-500">
                  Duration: {(imageDurations[imageOrder[selectedPos]] ?? MIN_IMAGE_SECONDS).toFixed(1)}s
                </label>
                <input
                  type="range"
                  min={MIN_IMAGE_SECONDS}
                  max={MAX_IMAGE_SECONDS}
                  step={0.5}
                  value={imageDurations[imageOrder[selectedPos]] ?? MIN_IMAGE_SECONDS}
                  onChange={(e) =>
                    setImageDurations((prev) => ({
                      ...prev,
                      [imageOrder[selectedPos]]: Number(e.target.value),
                    }))
                  }
                  className="mt-1 w-full"
                />

                <label className="mt-3 block text-xs text-gray-500">Zoom</label>
                <select
                  value={imageZoomStyles[imageOrder[selectedPos]] ?? 'zoom_in'}
                  onChange={(e) =>
                    setImageZoomStyles((prev) => ({
                      ...prev,
                      [imageOrder[selectedPos]]: e.target.value as ReelZoomStyle,
                    }))
                  }
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                >
                  {REEL_ZOOM_STYLES.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>

                <label className="mt-3 block text-xs text-gray-500">Colour filter</label>
                <select
                  value={imageColorFilters[imageOrder[selectedPos]] ?? 'none'}
                  onChange={(e) =>
                    setImageColorFilters((prev) => ({
                      ...prev,
                      [imageOrder[selectedPos]]: e.target.value,
                    }))
                  }
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                >
                  {REEL_COLOR_FILTERS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>

                {selectedPos < imageOrder.length - 1 ? (
                  <>
                    <label className="mt-3 block text-xs text-gray-500">
                      Transition to image {selectedPos + 2} ({REEL_TRANSITIONS.length})
                    </label>
                    <select
                      value={imageTransitions[imageOrder[selectedPos]] ?? 'fade'}
                      onChange={(e) =>
                        setImageTransitions((prev) => ({
                          ...prev,
                          [imageOrder[selectedPos]]: e.target.value,
                        }))
                      }
                      className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                    >
                      {REEL_TRANSITIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </>
                ) : (
                  <p className="mt-3 text-xs text-gray-400">
                    Last image in the sequence — no transition after it.
                  </p>
                )}

                <div className="mt-4 border-t border-gray-100 pt-3">
                  <TextLayerEditor
                    label={`Text on image ${selectedPos + 1} only`}
                    layers={imageTextLayers[imageOrder[selectedPos]] ?? []}
                    onChange={(layers) =>
                      setImageTextLayers((prev) => ({ ...prev, [imageOrder[selectedPos]]: layers }))
                    }
                  />
                </div>
              </div>

              <ReelAnimationPreview
                imageUrls={imageOrder.map((i) => post.reel_source_image_urls?.[i])}
                transitions={imageOrder.map((i) => imageTransitions[i])}
                zoomStyles={imageOrder.map((i) => imageZoomStyles[i])}
                durations={imageOrder.map((i) => imageDurations[i])}
                colorFilters={imageOrder.map((i) => imageColorFilters[i])}
                textLayers={textLayers}
                imageTextLayers={imageOrder.map((i) => imageTextLayers[i])}
              />
            </div>

            <p className="mt-3 text-xs text-gray-500">
              Total video length: <span className="font-medium text-gray-700">{totalSeconds.toFixed(1)}s</span>{' '}
              (select an image above to set its own duration)
            </p>

            <div className="mt-4 border-t border-gray-100 pt-4">
              <TextLayerEditor
                label="Text on the whole video"
                hint="Shown for the full length of the reel. Defaults to your caption."
                layers={textLayers}
                onChange={setTextLayers}
              />
            </div>

            <div className="mt-4 space-y-4 border-t border-gray-100 pt-4">
              <AudioTrackEditor
                label="Music"
                existingUrl={post.reel_audio_url}
                hasExisting={hasExistingMusic}
                file={musicFile}
                onFileChange={onPickMusicFile}
                start={musicStart}
                onStartChange={setMusicStart}
                end={musicEnd}
                onEndChange={setMusicEnd}
                onRemove={() => setRemoveMusic(true)}
              />
              <AudioTrackEditor
                label="Voiceover"
                existingUrl={post.reel_voice_audio_url}
                hasExisting={hasExistingVoice}
                file={voiceFile}
                onFileChange={onPickVoiceFile}
                start={voiceStart}
                onStartChange={setVoiceStart}
                end={voiceEnd}
                onEndChange={setVoiceEnd}
                onRemove={() => setRemoveVoice(true)}
              />
              {(hasExistingMusic || musicFile) && (hasExistingVoice || voiceFile) && (
                <p className="text-xs text-gray-400">
                  Both tracks set — music will auto-duck (get quieter) under the voiceover.
                </p>
              )}
            </div>

            <button
              onClick={onRegenerate}
              disabled={regenerating}
              className="mt-3 rounded-md border border-indigo-600 px-4 py-2 text-sm font-medium text-indigo-600 hover:bg-indigo-50 disabled:opacity-50"
            >
              {regenerating ? 'Regenerating...' : 'Regenerate video'}
            </button>
            {regenerateError && <p className="mt-1 text-xs text-red-600">{regenerateError}</p>}
          </div>
        )}

        {isReadyDraft && (
          <div className="mt-4 border-t border-gray-100 pt-4">
            <label className="block text-sm font-medium text-gray-700">Schedule this reel</label>
            <div className="mt-1 flex gap-2">
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
              />
              <button
                onClick={onSchedule}
                disabled={scheduling}
                className="flex-none rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                {scheduling ? 'Scheduling...' : 'Schedule'}
              </button>
            </div>
            {scheduleError && <p className="mt-1 text-xs text-red-600">{scheduleError}</p>}
          </div>
        )}
      </div>
    </div>
  )
}
