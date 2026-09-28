import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  aiEditReel,
  getPost,
  isVideoUrl,
  listReelTemplates,
  normalizeTextLayer,
  parseApiDate,
  regenerateReel,
  scheduleDraftPost,
  templateSlot,
  REEL_COLOR_FILTERS,
  REEL_TRANSITIONS,
  REEL_ZOOM_STYLES,
  type Post,
  type ReelCta,
  type ReelTemplate,
  type ReelTextLayer,
  type ReelZoomStyle,
} from '../api/client'
import ReelAnimationPreview, { type TextTarget } from '../components/ReelAnimationPreview'
import { useReelFonts } from '../components/useReelFonts'
import AudioTrackEditor from '../components/AudioTrackEditor'
import TextLayerEditor from '../components/TextLayerEditor'
import CtaEditor from '../components/CtaEditor'
import VoiceRecorder from '../components/VoiceRecorder'

const MIN_IMAGE_SECONDS = 1 // must match reel_generator.py
const MAX_IMAGE_SECONDS = 60 // must match reel_generator.py
const XFADE_SECONDS = 1 // must match backend/app/services/reel_generator.py's XFADE_SECONDS
const POLL_MS = 5000

const AI_EXAMPLES = [
  'Make it more energetic',
  "Add 'Sale 50% off' at the top",
  'Use the cinematic template',
  'Make it 30 seconds long',
]

// Natural lengths of the reel's video clips (read from their metadata), so a
// rhythm template can give each video its full length to cut into.
function useVideoDurations(urls: (string | undefined)[]): Record<string, number> {
  const [durations, setDurations] = useState<Record<string, number>>({})
  const key = urls.join('|')
  useEffect(() => {
    let alive = true
    for (const url of urls) {
      if (!url || !isVideoUrl(url)) continue
      const video = document.createElement('video')
      video.preload = 'metadata'
      video.onloadedmetadata = () => {
        if (alive && Number.isFinite(video.duration)) setDurations((prev) => ({ ...prev, [url]: video.duration }))
      }
      video.src = url
    }
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return durations
}

// Length of a local video file (for clips added on this page), or null.
function readVideoDuration(url: string): Promise<number | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.onloadedmetadata = () => resolve(Number.isFinite(video.duration) ? video.duration : null)
    video.onerror = () => resolve(null)
    video.src = url
  })
}

const MAX_CLIPS = 20 // must match posts.py's MAX_REEL_SOURCES

function toIsoString(datetimeLocalValue: string): string {
  return new Date(datetimeLocalValue).toISOString()
}

export default function PostPreviewPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [post, setPost] = useState<Post | null>(null)
  const [templates, setTemplates] = useState<ReelTemplate[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!id) return
    try {
      setPost(await getPost(id))
    } catch {
      setLoadError('Failed to load post')
    }
  }, [id])

  useEffect(() => {
    load()
    listReelTemplates().then(setTemplates).catch(() => setTemplates([]))
  }, [load])

  // Keep checking while the video renders in the background.
  const isGenerating = post?.status === 'generating_video' || post?.status === 'processing'
  useEffect(() => {
    if (!isGenerating) return
    const interval = setInterval(load, POLL_MS)
    return () => clearInterval(interval)
  }, [isGenerating, load])

  const goBack = () => {
    if (window.history.length > 1) navigate(-1)
    else navigate('/dashboard')
  }

  return (
    <div className="mx-auto mt-8 max-w-6xl px-4 pb-16">
      <button onClick={goBack} className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900">
        <span aria-hidden>←</span> Back
      </button>
      {loadError && <p className="mt-6 text-sm text-red-600">{loadError}</p>}
      {!post && !loadError && <p className="mt-6 text-sm text-gray-500">Loading...</p>}
      {post && (
        // Remount whenever the saved post changes (a render finished, an AI
        // edit applied) so the editor starts from the new saved settings.
        <ReelEditor
          key={`${post.id}:${post.updated_at}:${post.status}`}
          post={post}
          templates={templates}
          onChanged={load}
          onScheduled={() => navigate('/dashboard')}
        />
      )}
    </div>
  )
}

function ReelEditor({
  post,
  templates,
  onChanged,
  onScheduled,
}: {
  post: Post
  templates: ReelTemplate[]
  onChanged: () => void
  onScheduled: () => void
}) {
  const [scheduledAt, setScheduledAt] = useState('')
  const [scheduling, setScheduling] = useState(false)
  const [scheduleError, setScheduleError] = useState<string | null>(null)

  // Clips as saved; clips added on this page get indices after these (in
  // every per-clip map and in imageOrder) and are uploaded on regenerate.
  const imageCount = post.reel_source_image_urls?.length ?? 0
  const [newClips, setNewClips] = useState<{ file: File; url: string; video: boolean }[]>([])
  useEffect(() => () => newClips.forEach((clip) => URL.revokeObjectURL(clip.url)), []) // eslint-disable-line react-hooks/exhaustive-deps
  const clipCount = imageCount + newClips.length
  const clipUrls = [...(post.reel_source_image_urls ?? []), ...newClips.map((clip) => clip.url)]
  const clipIsVideo = [...(post.reel_source_image_urls ?? []).map((url) => isVideoUrl(url)), ...newClips.map((clip) => clip.video)]
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
  // Text shown for the whole video - only what the user adds here; the
  // post caption never goes on the video.
  const [textLayers, setTextLayers] = useState<ReelTextLayer[]>(() =>
    (post.reel_text_layers ?? []).map(normalizeTextLayer),
  )
  // Per-image text, keyed by original image index like the other per-image
  // settings, so it stays with its image across reordering.
  const [imageTextLayers, setImageTextLayers] = useState<Record<number, ReelTextLayer[]>>(() =>
    Object.fromEntries(
      Array.from({ length: imageCount }, (_, i) => [i, (post.reel_image_text_layers?.[i] ?? []).map(normalizeTextLayer)]),
    ),
  )
  const [imageColorFilters, setImageColorFilters] = useState<Record<number, string>>(() =>
    Object.fromEntries(
      Array.from({ length: imageCount }, (_, i) => [i, post.reel_image_color_filters?.[i] ?? 'none']),
    ),
  )
  const [selectedPos, setSelectedPos] = useState(0)
  // What the live preview plays: the whole reel, the ticked clips, or one
  // clip (by original index) - a single clip holds still for placing text.
  const [previewScope, setPreviewScope] = useState<'reel' | 'selected' | number>('reel')
  // Clips ticked on their thumbnails - a template can be applied to just these.
  const [checkedClips, setCheckedClips] = useState<number[]>([])
  const [templateScope, setTemplateScope] = useState<'reel' | 'selected'>('reel')
  const fonts = useReelFonts()
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

  // Template + brand details its graphics use.
  const [templateId, setTemplateId] = useState<string>(post.reel_template ?? '')
  const [brandColor, setBrandColor] = useState(post.reel_brand_color)
  const [titleText, setTitleText] = useState(post.reel_title_text ?? '')
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [removeLogo, setRemoveLogo] = useState(false)
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!logoFile) {
      setLogoPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(logoFile)
    setLogoPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [logoFile])
  const logoUrl = logoPreviewUrl ?? (removeLogo ? null : post.reel_logo_url)
  const [logoX, setLogoX] = useState(post.reel_logo_x)
  const [logoY, setLogoY] = useState(post.reel_logo_y)
  const [logoScale, setLogoScale] = useState(post.reel_logo_scale)
  // `clip` holds original clip indices (imageOrder's value space).
  const [ctas, setCtas] = useState<ReelCta[]>(() => post.reel_ctas ?? [])
  const template = templates.find((t) => t.id === templateId) ?? null
  // Per-clip template overrides, keyed by original index ('' = the reel's).
  const [clipTemplates, setClipTemplates] = useState<Record<number, string>>(() =>
    Object.fromEntries((post.reel_clip_templates ?? []).map((t, i) => [i, t ?? ''])),
  )
  const templateById = (id: string | undefined) => templates.find((t) => t.id === id) ?? null
  const effectiveTemplate = (original: number) => templateById(clipTemplates[original]) ?? template
  const videoDurations = useVideoDurations(post.reel_source_image_urls ?? [])
  const [newClipError, setNewClipError] = useState<string | null>(null)

  // "Edit with AI".
  const [aiInstruction, setAiInstruction] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [aiReply, setAiReply] = useState<string | null>(null)
  const [aiError, setAiError] = useState<string | null>(null)

  // Original-index order the images currently render/regenerate in;
  // reordered by dragging thumbnails below.
  const [imageOrder, setImageOrder] = useState<number[]>(() =>
    (post.reel_source_image_urls ?? []).map((_, i) => i),
  )
  const [dragPos, setDragPos] = useState<number | null>(null)

  const isReadyDraft = post.status === 'draft'
  const isGenerating = post.status === 'generating_video' || post.status === 'processing'
  // A failed generation can be retried - the backend accepts regenerate for
  // it too - so the editor stays available instead of dead-ending the post.
  const canEditReel = post.status === 'draft' || post.status === 'generation_failed'
  const isReel = Boolean(post.reel_source_images && post.reel_source_images.length > 0)
  const hasExistingMusic = Boolean(post.reel_audio_path) && !removeMusic
  const hasExistingVoice = Boolean(post.reel_voice_audio_path) && !removeVoice

  const totalSeconds =
    imageOrder.reduce((sum, i) => sum + (imageDurations[i] ?? MIN_IMAGE_SECONDS), 0) -
    // Each transition's length comes from the template of the clip it leaves.
    imageOrder.slice(0, -1).reduce((sum, i) => sum + (effectiveTemplate(i)?.xfade ?? XFADE_SECONDS), 0)

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

  // Picking a template restyles every clip by its on-screen position:
  // transition and motion sequences, and for rhythm templates the clip
  // length pattern (videos get their full length, cut to the rhythm at
  // render). Mirrors reel_templates.py's apply_template; per-clip tweaks
  // made afterwards still stick.
  //
  // With "Selected clips" as the scope, only the ticked clips get the
  // template (as an override), and its pattern starts afresh at the first
  // of them - so different stretches of the reel can use different
  // templates.
  const onPickTemplate = (next: ReelTemplate | null) => {
    const targets =
      templateScope === 'selected' && checkedClips.length
        ? imageOrder.filter((original) => checkedClips.includes(original))
        : null
    if (targets) {
      setClipTemplates((prev) => ({ ...prev, ...Object.fromEntries(targets.map((o) => [o, next?.id ?? ''])) }))
    } else {
      setTemplateId(next?.id ?? '')
      setClipTemplates({})
    }
    // "No template" on selected clips hands them back to the reel's template.
    const style = next ?? (targets ? template : null)
    if (!style) return
    const transitions: Record<number, string> = { ...imageTransitions }
    const zooms: Record<number, ReelZoomStyle> = { ...imageZoomStyles }
    const colors: Record<number, string> = { ...imageColorFilters }
    const lengths: Record<number, number> = { ...imageDurations }
    ;(targets ?? imageOrder).forEach((original, pos) => {
      const slot = templateSlot(style, pos)
      transitions[original] = slot.transition
      zooms[original] = slot.zoomStyle
      colors[original] = style.color_filter
      const url = clipUrls[original]
      if (slot.duration !== null) {
        lengths[original] = clipIsVideo[original]
          ? Math.min(MAX_IMAGE_SECONDS, videoDurations[url ?? ''] ?? lengths[original] ?? slot.duration)
          : slot.duration
      }
    })
    setImageTransitions(transitions)
    setImageZoomStyles(zooms)
    setImageColorFilters(colors)
    setImageDurations(lengths)
  }

  // Adds clips at the end: they pick up the template's pattern for their
  // position (or plain defaults), and videos get their full length.
  const onAddClips = async (files: File[]) => {
    setNewClipError(null)
    const room = MAX_CLIPS - imageOrder.length
    if (files.length > room) setNewClipError(`A reel can have at most ${MAX_CLIPS} clips - added the first ${Math.max(0, room)}.`)
    const added = files.slice(0, Math.max(0, room)).map((file) => ({
      file,
      url: URL.createObjectURL(file),
      video: file.type.startsWith('video/'),
    }))
    if (!added.length) return
    const lengths = await Promise.all(added.map((clip) => (clip.video ? readVideoDuration(clip.url) : Promise.resolve(null))))
    const firstIndex = clipCount
    const firstPos = imageOrder.length
    const transitions: Record<number, string> = {}
    const zooms: Record<number, ReelZoomStyle> = {}
    const durations: Record<number, number> = {}
    const colors: Record<number, string> = {}
    const texts: Record<number, ReelTextLayer[]> = {}
    added.forEach((clip, j) => {
      const index = firstIndex + j
      const slot = template ? templateSlot(template, firstPos + j) : null
      transitions[index] = slot?.transition ?? post.reel_transition
      zooms[index] = slot?.zoomStyle ?? post.reel_zoom_style
      const natural = lengths[j]
      durations[index] =
        clip.video && natural
          ? Math.max(MIN_IMAGE_SECONDS, Math.min(MAX_IMAGE_SECONDS, natural))
          : (slot?.duration ?? 3)
      colors[index] = template?.color_filter ?? 'none'
      texts[index] = []
    })
    setNewClips((prev) => [...prev, ...added])
    setImageTransitions((prev) => ({ ...prev, ...transitions }))
    setImageZoomStyles((prev) => ({ ...prev, ...zooms }))
    setImageDurations((prev) => ({ ...prev, ...durations }))
    setImageColorFilters((prev) => ({ ...prev, ...colors }))
    setImageTextLayers((prev) => ({ ...prev, ...texts }))
    setImageOrder((prev) => [...prev, ...added.map((_, j) => firstIndex + j)])
  }

  const onRemoveClip = (pos: number) => {
    if (imageOrder.length <= 1) return
    const removed = imageOrder[pos]
    const remaining = imageOrder.filter((_, i) => i !== pos)
    setImageOrder(remaining)
    setCheckedClips((prev) => prev.filter((o) => o !== removed))
    if (previewScope === removed) setPreviewScope('reel')
    setSelectedPos((current) => Math.min(current, remaining.length - 1))
    // CTAs on the removed clip move to the first remaining clip.
    setCtas((prev) => prev.map((cta) => (cta.clip === removed ? { ...cta, clip: remaining[0] } : cta)))
  }

  // Dragging in the live preview moves a layer's centre.
  const onTextMove = (target: TextTarget, index: number, x: number, y: number) => {
    const moveIn = (layers: ReelTextLayer[]) => layers.map((l, i) => (i === index ? { ...l, x, y } : l))
    if (target.scope === 'global') setTextLayers(moveIn)
    else {
      const original = imageOrder[target.pos]
      setImageTextLayers((prev) => ({ ...prev, [original]: moveIn(prev[original] ?? []) }))
    }
  }

  const onPickMusicFile = (file: File | null) => {
    setMusicFile(file)
    setRemoveMusic(false)
    setMusicStart(0)
    setMusicEnd(null)
  }

  // Set when the voiceover came from the recorder rather than a file.
  const [voiceRecordedSeconds, setVoiceRecordedSeconds] = useState<number | null>(null)
  const onPickVoiceFile = (file: File | null, recordedSeconds: number | null = null) => {
    setVoiceRecordedSeconds(recordedSeconds)
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
      onScheduled()
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
        imageTransitions: Array.from({ length: clipCount }, (_, i) => imageTransitions[i] ?? post.reel_transition),
        imageZoomStyles: Array.from({ length: clipCount }, (_, i) => imageZoomStyles[i] ?? post.reel_zoom_style),
        imageDurations: Array.from({ length: clipCount }, (_, i) => imageDurations[i] ?? MIN_IMAGE_SECONDS),
        textLayers: textLayers.filter((layer) => layer.text.trim()),
        imageTextLayers: Array.from({ length: clipCount }, (_, i) =>
          (imageTextLayers[i] ?? []).filter((layer) => layer.text.trim()),
        ),
        imageColorFilters: Array.from({ length: clipCount }, (_, i) => imageColorFilters[i] ?? 'none'),
        template: templateId,
        brandColor,
        titleText,
        logo: logoFile,
        removeLogo: removeLogo && !logoFile,
        logoX,
        logoY,
        logoScale,
        newClips: newClips.map((clip) => clip.file),
        clipTemplates: Array.from({ length: clipCount }, (_, i) => clipTemplates[i] ?? ''),
        ctas: ctas
          .filter((cta) => cta.text.trim())
          .map((cta) => ({ ...cta, link: cta.link?.trim() || null })),
      })
      onChanged()
    } catch (err: any) {
      setRegenerateError(err?.response?.data?.detail ?? 'Failed to regenerate reel')
    } finally {
      setRegenerating(false)
    }
  }

  const onAiEdit = async (instruction: string) => {
    if (!instruction.trim()) return
    setAiBusy(true)
    setAiError(null)
    setAiReply(null)
    try {
      const result = await aiEditReel(post.id, instruction)
      setAiReply(result.reply)
      if (result.changed.length > 0) onChanged()
    } catch (err: any) {
      setAiError(err?.response?.data?.detail ?? 'AI edit failed')
    } finally {
      setAiBusy(false)
    }
  }

  const livePreview = (
    <ReelAnimationPreview
      width={240}
      imageUrls={imageOrder.map((i) => clipUrls[i])}
      videoFlags={imageOrder.map((i) => clipIsVideo[i])}
      transitions={imageOrder.map((i) => imageTransitions[i])}
      zoomStyles={imageOrder.map((i) => imageZoomStyles[i])}
      durations={imageOrder.map((i) => imageDurations[i])}
      colorFilters={imageOrder.map((i) => imageColorFilters[i])}
      textLayers={textLayers}
      imageTextLayers={imageOrder.map((i) => imageTextLayers[i])}
      template={template}
      brand={{ color: brandColor, title: titleText, outro: ctas[0]?.text ?? '' }}
      // The preview indexes clips by on-screen position.
      ctas={ctas.map((cta) => ({ ...cta, clip: imageOrder.indexOf(cta.clip) }))}
      onCtaMove={
        canEditReel
          ? (index, x, y) => setCtas((prev) => prev.map((cta, i) => (i === index ? { ...cta, x, y } : cta)))
          : undefined
      }
      logo={logoUrl ? { url: logoUrl, x: logoX, y: logoY, scale: logoScale } : null}
      clipTemplates={imageOrder.map((i) => templateById(clipTemplates[i]))}
      visiblePositions={
        previewScope === 'reel'
          ? null
          : previewScope === 'selected'
            ? imageOrder.flatMap((o, pos) => (checkedClips.includes(o) ? [pos] : []))
            : [Math.max(0, imageOrder.indexOf(previewScope))]
      }
      onTextMove={canEditReel ? onTextMove : undefined}
      onLogoMove={
        canEditReel
          ? (x, y) => {
              setLogoX(x)
              setLogoY(y)
            }
          : undefined
      }
    />
  )

  return (
    <div className={`mt-4 grid gap-8 ${isReel ? 'md:grid-cols-[260px_minmax(0,1fr)]' : ''}`}>
      {/* Left: live preview of unsaved edits, kept in view while editing. */}
      {isReel && (
        <aside className="md:sticky md:top-4 md:self-start">
          <p className="mb-2 text-sm font-medium text-gray-900">Live preview</p>
          {isGenerating ? (
            // While rendering, a live preview of the settings next to the old
            // video just muddles which is which - show progress instead.
            <div
              className="mx-auto flex flex-col items-center justify-center gap-3 rounded-md border border-dashed border-purple-200 bg-purple-50 px-4 text-center"
              style={{ width: 240, height: 240 * (16 / 9) }}
            >
              <span className="h-8 w-8 animate-spin rounded-full border-4 border-purple-200 border-t-purple-600" aria-hidden />
              <p className="text-sm font-medium text-purple-800">Rendering your reel&hellip;</p>
              <p className="text-xs text-purple-700">
                The new video and the live preview come back here as soon as it's ready - no need to refresh.
              </p>
            </div>
          ) : (
            <>
          {livePreview}
          <label className="mt-2 flex items-center justify-center gap-1.5 text-xs text-gray-600">
            Show
            <select
              value={String(previewScope)}
              onChange={(e) => {
                const value = e.target.value
                setPreviewScope(value === 'reel' || value === 'selected' ? value : Number(value))
              }}
              className="rounded-md border border-gray-300 px-2 py-1 text-xs focus:border-indigo-500 focus:outline-none"
            >
              <option value="reel">Whole reel</option>
              <option value="selected" disabled={!checkedClips.length}>
                Ticked clips ({checkedClips.filter((o) => imageOrder.includes(o)).length})
              </option>
              {imageOrder.map((original, pos) => (
                <option key={original} value={original}>
                  Only clip {pos + 1}
                </option>
              ))}
            </select>
          </label>
          <p className="mt-1 text-center text-xs text-gray-500">
            Updates instantly. Hit <span className="font-medium">Regenerate video</span> to render it for real.
          </p>
            </>
          )}
        </aside>
      )}

      <div className="min-w-0 space-y-6">
      <div className="space-y-4">
        <h1 className="text-xl font-semibold text-gray-900">Post preview</h1>

        {post.media_url && post.media_type === 'image' && (
          <img src={post.media_url} alt="" className="max-h-[420px] rounded-md bg-gray-100 object-contain" />
        )}
        {post.media_url && post.media_type === 'video' && (
          <div>
            {isReel && (
              <p className="mb-1 text-xs font-medium text-gray-500">
                {isGenerating ? 'Previous version - the new one is rendering' : 'Current video (last render)'}
              </p>
            )}
            <div className="relative inline-block">
              <video
                src={post.media_url}
                controls={!isGenerating}
                className={`max-h-[420px] rounded-md bg-black ${isGenerating ? 'opacity-30' : ''}`}
              />
              {isGenerating && (
                <span className="absolute inset-0 flex items-center justify-center">
                  <span className="rounded-full bg-gray-900/80 px-3 py-1 text-xs font-medium text-white">
                    Old version &middot; being replaced
                  </span>
                </span>
              )}
            </div>
          </div>
        )}
        {isGenerating && (
          <p className="rounded-md bg-purple-50 px-3 py-2 text-sm text-purple-700">
            Generating the reel video&hellip; this page updates by itself when it's ready.
          </p>
        )}
        {!post.media_url && !isGenerating && <p className="text-sm italic text-gray-400">No media attached</p>}

        <p className="whitespace-pre-wrap text-sm text-gray-900">{post.caption}</p>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 border-t border-gray-100 pt-4 text-xs text-gray-500">
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
          <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">{post.reel_warning}</p>
        )}
        {post.status === 'generation_failed' && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-800">
            Last generation failed{post.error_message ? `: ${post.error_message}` : ''}. Adjust the settings
            and hit Regenerate video to try again.
          </p>
        )}

        {isReadyDraft && (
          <div className="border-t border-gray-100 pt-4">
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

      {isReel && (
        <fieldset disabled={!canEditReel} className="min-w-0 space-y-6 border-t border-gray-100 pt-6 disabled:opacity-60">
          {!canEditReel && (
            <p className="text-sm text-gray-500">
              {isGenerating ? 'Editing unlocks once the current render finishes.' : 'This reel can no longer be edited.'}
            </p>
          )}

          <section className="rounded-lg border border-indigo-100 bg-indigo-50/60 p-4">
            <label className="block text-sm font-medium text-gray-900">Edit with AI</label>
            <p className="mt-0.5 text-xs text-gray-500">
              Describe the change in your own words - the AI updates the reel's settings and re-renders it.
              Unsaved changes on this page are replaced by the AI's version.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                onAiEdit(aiInstruction)
              }}
              className="mt-2 flex gap-2"
            >
              <input
                value={aiInstruction}
                onChange={(e) => setAiInstruction(e.target.value)}
                placeholder="e.g. make it faster and add 'Sale 50% off' at the top"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
              />
              <button
                type="submit"
                disabled={aiBusy || !aiInstruction.trim()}
                className="flex-none rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                {aiBusy ? 'Thinking...' : 'Apply'}
              </button>
            </form>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {AI_EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => setAiInstruction(example)}
                  className="rounded-full border border-indigo-200 bg-white px-2.5 py-0.5 text-xs text-indigo-700 hover:bg-indigo-50"
                >
                  {example}
                </button>
              ))}
            </div>
            {aiReply && <p className="mt-2 text-sm text-indigo-900">{aiReply}</p>}
            {aiError && <p className="mt-2 text-xs text-red-600">{aiError}</p>}
          </section>

          <section>
            <label className="block text-sm font-medium text-gray-900">Template</label>
            <p className="mt-0.5 text-xs text-gray-500">
              Pick one to see it in the live preview right away. <span className="font-medium">Rhythm</span>{' '}
              templates set each clip's transition, motion and length from a repeating pattern, and cut videos to
              the same beat - add as many images/videos as you like.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-gray-500">Apply to:</span>
              {(['reel', 'selected'] as const).map((scope) => (
                <button
                  key={scope}
                  type="button"
                  disabled={scope === 'selected' && !checkedClips.length}
                  onClick={() => setTemplateScope(scope)}
                  className={`rounded-full border px-2.5 py-1 font-medium disabled:opacity-40 ${
                    templateScope === scope
                      ? 'border-indigo-600 bg-indigo-600 text-white'
                      : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {scope === 'reel' ? 'Whole reel' : `Ticked clips (${checkedClips.length})`}
                </button>
              ))}
              {templateScope === 'selected' && (
                <span className="text-gray-500">
                  Tick clips under <span className="font-medium">Clips</span> below, then pick a template for them.
                </span>
              )}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 lg:grid-cols-3">
              {[null, ...templates].map((t) => {
                // In "ticked clips" mode, highlight the template they all share.
                const shared =
                  templateScope === 'selected' && checkedClips.length
                    ? [...new Set(checkedClips.map((o) => clipTemplates[o] || ''))]
                    : [templateId]
                const selected = shared.length === 1 && (t?.id ?? '') === shared[0]
                return (
                  <button
                    key={t?.id ?? 'none'}
                    type="button"
                    onClick={() => onPickTemplate(t)}
                    className={`rounded-md border px-3 py-2 text-left text-sm ${
                      selected ? 'border-indigo-600 bg-indigo-50 ring-1 ring-indigo-600' : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <span className="flex items-center gap-1.5 font-medium text-gray-900">
                      {t?.name ?? 'No template'}
                      {t?.durations && (
                        <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-purple-700">
                          Rhythm
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block text-xs text-gray-500">
                      {t?.description ?? 'Just your images/clips with the settings below.'}
                    </span>
                  </button>
                )
              })}
            </div>
          </section>

          <section className="border-t border-gray-100 pt-4">
            <TextLayerEditor
              label="Text on the video"
              hint="Only the text you add here goes on the reel (your caption stays in the post). Drag it in the live preview to position it."
              layers={textLayers}
              fonts={fonts}
              onChange={setTextLayers}
            />
          </section>

          <section className="border-t border-gray-100 pt-4">
            <CtaEditor
              ctas={ctas}
              fonts={fonts}
              clipOptions={imageOrder.map((original, pos) => ({
                value: original,
                label: `Clip ${pos + 1}${clipIsVideo[original] ? ' (video)' : ''}`,
              }))}
              defaultClip={imageOrder[selectedPos] ?? 0}
              onChange={setCtas}
            />
          </section>

          <section className="border-t border-gray-100 pt-4">
            <label className="block text-sm font-medium text-gray-900">Logo &amp; branding</label>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs text-gray-500">Logo</label>
                <div className="mt-1 flex items-center gap-2">
                  {logoUrl && <img src={logoUrl} alt="" className="h-9 w-9 rounded object-contain ring-1 ring-gray-200" />}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      setLogoFile(e.target.files?.[0] ?? null)
                      setRemoveLogo(false)
                    }}
                    className="w-full text-xs"
                  />
                  {logoUrl && (
                    <button
                      type="button"
                      onClick={() => {
                        setLogoFile(null)
                        setRemoveLogo(true)
                      }}
                      className="text-xs text-red-600 hover:underline"
                    >
                      Remove
                    </button>
                  )}
                </div>
                {logoUrl && (
                  <label className="mt-2 block text-xs text-gray-500">
                    Logo size: {Math.round(logoScale * 100)}% · drag it in the preview to move it
                    <input
                      type="range"
                      min={0.05}
                      max={0.6}
                      step={0.01}
                      value={logoScale}
                      onChange={(e) => setLogoScale(Number(e.target.value))}
                      className="mt-1 w-full"
                    />
                  </label>
                )}
              </div>
              <div>
                <label className="block text-xs text-gray-500">Brand colour</label>
                <input
                  type="color"
                  value={brandColor}
                  onChange={(e) => setBrandColor(e.target.value)}
                  className="mt-1 h-9 w-full cursor-pointer rounded-md border border-gray-300"
                />
                <p className="mt-1 text-xs text-gray-400">Used by template frames and cards.</p>
              </div>
              {(template?.hook_seconds || template?.intro_card) && (
                <div className="sm:col-span-2">
                  <label className="block text-xs text-gray-500">Title (big hook text / intro card)</label>
                  <input
                    value={titleText}
                    onChange={(e) => setTitleText(e.target.value)}
                    placeholder="Leave empty for no title"
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                  />
                </div>
              )}
            </div>
          </section>

          <section className="border-t border-gray-100 pt-4">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium text-gray-900">
                Clips ({imageOrder.length}/{MAX_CLIPS})
              </label>
              {imageOrder.length < MAX_CLIPS && (
                <label className="cursor-pointer rounded-md border border-indigo-200 px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50">
                  + Add clips
                  <input
                    type="file"
                    accept="image/*,video/*"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      onAddClips(Array.from(e.target.files ?? []))
                      e.target.value = ''
                    }}
                  />
                </label>
              )}
            </div>
            <label className="block text-xs text-gray-500">
              Drag to reorder · click one to edit its duration, zoom, colour and transition · ✕ removes it. Added
              clips are uploaded when you hit Regenerate video.
            </label>
            {newClipError && <p className="mt-1 text-xs text-amber-700">{newClipError}</p>}
            <div className="mt-1 flex gap-3 text-xs">
              <button
                type="button"
                onClick={() => {
                  setCheckedClips([...imageOrder])
                  setTemplateScope('selected')
                }}
                className="text-indigo-600 hover:underline"
              >
                Tick all
              </button>
              {checkedClips.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setCheckedClips([])
                    setTemplateScope('reel')
                    if (previewScope === 'selected') setPreviewScope('reel')
                  }}
                  className="text-gray-600 hover:underline"
                >
                  Clear ticks ({checkedClips.length})
                </button>
              )}
              <span className="text-gray-400">Tick clips to give them their own template or preview just them.</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {imageOrder.map((originalIndex, pos) => {
                const src = clipUrls[originalIndex]
                const Thumb = clipIsVideo[originalIndex] ? 'video' : 'img'
                const isNew = originalIndex >= imageCount
                return (
                  <div key={originalIndex} className="group relative">
                    <Thumb
                      src={src}
                      {...(Thumb === 'video' ? { muted: true, playsInline: true } : { alt: `Clip ${pos + 1}` })}
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
                    <input
                      type="checkbox"
                      aria-label={`Tick clip ${pos + 1}`}
                      checked={checkedClips.includes(originalIndex)}
                      onChange={(e) => {
                        const on = e.target.checked
                        setCheckedClips((prev) => (on ? [...prev, originalIndex] : prev.filter((o) => o !== originalIndex)))
                        if (on) setTemplateScope('selected')
                      }}
                      className="absolute left-1 top-1 h-3.5 w-3.5 cursor-pointer"
                    />
                    {isNew && (
                      <span className="pointer-events-none absolute bottom-0.5 left-0.5 rounded bg-green-600 px-1 text-[9px] font-semibold text-white">
                        NEW
                      </span>
                    )}
                    <span
                      className={`mt-0.5 block w-16 truncate text-center text-[9px] ${
                        clipTemplates[originalIndex] ? 'font-semibold text-purple-700' : 'text-gray-400'
                      }`}
                      title={effectiveTemplate(originalIndex)?.name ?? 'No template'}
                    >
                      {effectiveTemplate(originalIndex)?.name ?? '—'}
                    </span>
                    {imageOrder.length > 1 && (
                      <button
                        type="button"
                        onClick={() => onRemoveClip(pos)}
                        aria-label={`Remove clip ${pos + 1}`}
                        className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-gray-900/80 text-[11px] text-white hover:bg-red-600"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                )
              })}
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-gray-700">
                  Clip {selectedPos + 1} of {imageOrder.length}
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
                    setImageDurations((prev) => ({ ...prev, [imageOrder[selectedPos]]: Number(e.target.value) }))
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
              </div>

              <div>
                <label className="block text-xs text-gray-500 sm:mt-6">Colour filter</label>
                <select
                  value={imageColorFilters[imageOrder[selectedPos]] ?? 'none'}
                  onChange={(e) =>
                    setImageColorFilters((prev) => ({ ...prev, [imageOrder[selectedPos]]: e.target.value }))
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
                      Transition to clip {selectedPos + 2} ({REEL_TRANSITIONS.length})
                    </label>
                    <select
                      value={imageTransitions[imageOrder[selectedPos]] ?? 'fade'}
                      onChange={(e) =>
                        setImageTransitions((prev) => ({ ...prev, [imageOrder[selectedPos]]: e.target.value }))
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
                  <p className="mt-3 text-xs text-gray-400">Last clip in the sequence — no transition after it.</p>
                )}
              </div>
            </div>

            <div className="mt-4">
              <TextLayerEditor
                label={`Text on clip ${selectedPos + 1} only`}
                hint="Shown only while this clip is on screen - pick “Only clip …” under the live preview to place it."
                layers={imageTextLayers[imageOrder[selectedPos]] ?? []}
                fonts={fonts}
                onChange={(layers) => setImageTextLayers((prev) => ({ ...prev, [imageOrder[selectedPos]]: layers }))}
              />
            </div>

            <p className="mt-3 text-xs text-gray-500">
              Total video length: <span className="font-medium text-gray-700">{totalSeconds.toFixed(1)}s</span>
              {template?.intro_card || template?.outro_card ? ' (intro/outro cards are taken out of this)' : ''}
            </p>
          </section>

          <section className="space-y-4 border-t border-gray-100 pt-4">
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
              onFileChange={(file) => onPickVoiceFile(file)}
              start={voiceStart}
              onStartChange={setVoiceStart}
              end={voiceEnd}
              onEndChange={setVoiceEnd}
              onRemove={() => setRemoveVoice(true)}
              knownDuration={voiceFile ? voiceRecordedSeconds : null}
            >
              <div className="mb-2 mt-1">
                <VoiceRecorder
                  videoUrl={post.media_type === 'video' ? post.media_url : null}
                  onRecorded={(file, seconds) => onPickVoiceFile(file, seconds)}
                />
                <p className="mt-2 text-xs text-gray-400">…or upload an audio file:</p>
              </div>
            </AudioTrackEditor>
            {(hasExistingMusic || musicFile) && (hasExistingVoice || voiceFile) && (
              <p className="text-xs text-gray-400">
                Both tracks set — music will auto-duck (get quieter) under the voiceover.
              </p>
            )}
          </section>

          <div className="border-t border-gray-100 pt-4">
            <button
              onClick={onRegenerate}
              disabled={regenerating}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {regenerating ? 'Starting...' : 'Regenerate video'}
            </button>
            {regenerateError && <p className="mt-1 text-xs text-red-600">{regenerateError}</p>}
          </div>
        </fieldset>
      )}
      </div>
    </div>
  )
}
