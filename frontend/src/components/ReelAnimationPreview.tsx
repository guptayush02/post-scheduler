import { useEffect, useRef, useState } from 'react'
import { isVideoUrl, type ReelCta, type ReelTemplate, type ReelTextLayer, type ReelZoomStyle } from '../api/client'
import { reelFontFamily } from './useReelFonts'

// Every ffmpeg xfade transition mapped to one of a few CSS-approximable
// "families" - this preview is a rough live approximation (cheap, instant,
// runs entirely in the browser), not a pixel-accurate replica of the actual
// ffmpeg render. Any transition not listed falls back to a plain fade.
type TransitionFamily = 'fade' | 'slide-left' | 'slide-right' | 'slide-up' | 'slide-down' | 'zoom'

const TRANSITION_FAMILY: Record<string, TransitionFamily> = {
  fade: 'fade', fadeblack: 'fade', fadewhite: 'fade', fadegrays: 'fade', fadefast: 'fade', fadeslow: 'fade',
  dissolve: 'fade', distance: 'fade', radial: 'fade', circlecrop: 'fade', rectcrop: 'fade', hblur: 'fade', pixelize: 'fade',
  wipeleft: 'slide-left', slideleft: 'slide-left', smoothleft: 'slide-left', coverleft: 'slide-left',
  revealleft: 'slide-left', hlslice: 'slide-left', hlwind: 'slide-left', wipetl: 'slide-left', wipebl: 'slide-left',
  diagtl: 'slide-left', diagbl: 'slide-left', horzclose: 'slide-left', squeezeh: 'slide-left',
  wiperight: 'slide-right', slideright: 'slide-right', smoothright: 'slide-right', coverright: 'slide-right',
  revealright: 'slide-right', hrslice: 'slide-right', hrwind: 'slide-right', wipetr: 'slide-right', wipebr: 'slide-right',
  diagtr: 'slide-right', diagbr: 'slide-right', horzopen: 'slide-right',
  wipeup: 'slide-up', slideup: 'slide-up', smoothup: 'slide-up', coverup: 'slide-up', revealup: 'slide-up',
  vuslice: 'slide-up', vuwind: 'slide-up', vertclose: 'slide-up',
  wipedown: 'slide-down', slidedown: 'slide-down', smoothdown: 'slide-down', coverdown: 'slide-down',
  revealdown: 'slide-down', vdslice: 'slide-down', vdwind: 'slide-down', vertopen: 'slide-down', squeezev: 'slide-down',
  circleopen: 'zoom', circleclose: 'zoom', zoomin: 'zoom',
}

const FAMILY_HIDDEN_TRANSFORM: Record<TransitionFamily, string> = {
  fade: 'none',
  'slide-left': 'translateX(100%)',
  'slide-right': 'translateX(-100%)',
  'slide-up': 'translateY(100%)',
  'slide-down': 'translateY(-100%)',
  zoom: 'scale(0.5)',
}

// CSS stand-ins for the ffmpeg colour presets - close enough to judge the
// look while editing; the real grade is done by ffmpeg on regenerate.
const COLOR_FILTER_CSS: Record<string, string> = {
  none: 'none',
  warm: 'sepia(0.25) saturate(1.25) hue-rotate(-10deg)',
  cool: 'saturate(1.1) hue-rotate(15deg) brightness(1.02)',
  vivid: 'saturate(1.5) contrast(1.12)',
  muted: 'saturate(0.6) contrast(0.95) brightness(1.03)',
  vintage: 'sepia(0.4) saturate(0.85) contrast(0.95)',
  bw: 'grayscale(1)',
}

const DEFAULT_DISPLAY_MS = 2200
const MIN_DISPLAY_MS = 800
const MAX_DISPLAY_MS = 4000
const TRANSITION_MS = 700
const CARD_SECONDS = 3 // must match reel_templates.py's CARD_SECONDS

// Real per-image durations can be 2-60s - compressed (capped) here so the
// preview stays quick to watch while still reflecting relative pacing
// (a 3s image previews faster than a 12s one, up to the cap).
function previewMsFor(seconds: number | undefined): number {
  if (!seconds) return DEFAULT_DISPLAY_MS
  return Math.min(MAX_DISPLAY_MS, Math.max(MIN_DISPLAY_MS, seconds * 300))
}

const clamp01 = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 1000) / 1000
const XFADE_SECONDS = 1 // must match reel_generator.py's XFADE_SECONDS (templates may override)

// CTA pop-up animations - mirror reel_chrome.py's render_cta_frames
// (0.4s in; pulse = a gentle 0.9s beat afterwards).
const CTA_KEYFRAMES = `
@keyframes reelCtaPop { 0% { transform: translate(-50%,-50%) scale(.3); opacity: 0 } 30% { opacity: 1 }
  70% { transform: translate(-50%,-50%) scale(1.08) } 100% { transform: translate(-50%,-50%) scale(1); opacity: 1 } }
@keyframes reelCtaSlide { 0% { transform: translate(-50%,-50%) translateY(80%); opacity: 0 }
  100% { transform: translate(-50%,-50%); opacity: 1 } }
@keyframes reelCtaFade { 0% { opacity: 0 } 100% { opacity: 1 } }
@keyframes reelCtaPulse { 0%, 100% { transform: translate(-50%,-50%) scale(1) } 50% { transform: translate(-50%,-50%) scale(1.05) } }
`
function ctaAnimationCss(animation: string, delayMs: number): string {
  const d = Math.round(delayMs)
  switch (animation) {
    case 'pulse':
      return `reelCtaPop 0.4s ease-out ${d}ms both, reelCtaPulse 0.9s ease-in-out ${d + 400}ms infinite`
    case 'slide_up':
      return `reelCtaSlide 0.4s ease-out ${d}ms both`
    case 'fade':
      return `reelCtaFade 0.4s linear ${d}ms both`
    default:
      return `reelCtaPop 0.4s ease-out ${d}ms both`
  }
}

export interface ReelBrand {
  color: string
  title: string
  // Outro card text (the first call to action).
  outro: string
}

export interface ReelLogo {
  url: string
  x: number
  y: number
  // Width as a fraction of the frame width.
  scale: number
}

// Which text a drag moved: the whole-video layers, or clip `pos`'s own.
export type TextTarget = { scope: 'global' } | { scope: 'clip'; pos: number }

type Entry =
  | {
      kind: 'media'
      // Index into imageUrls (the clip's on-screen position).
      pos: number
      url: string
      video: boolean
      transition?: string
      zoomStyle?: ReelZoomStyle
      duration?: number
      colorFilter?: string
      texts: ReelTextLayer[]
      // The template governing this clip (its own, else the reel's).
      tpl: ReelTemplate | null
      // Seconds on the real reel timeline.
      span?: { start: number; end: number }
    }
  | {
      kind: 'card'
      title: string
      duration: number
      transition: string
      tpl: ReelTemplate | null
      span?: { start: number; end: number }
    }

export default function ReelAnimationPreview({
  imageUrls,
  videoFlags,
  transitions,
  zoomStyles,
  durations,
  colorFilters,
  textLayers,
  imageTextLayers,
  template = null,
  clipTemplates,
  brand,
  logo = null,
  visiblePositions = null,
  ctas = [],
  onTextMove,
  onLogoMove,
  onCtaMove,
  width = 126,
}: {
  imageUrls: (string | undefined)[]
  // Which clips are videos, when the URL can't tell (blob: URLs of clips
  // not uploaded yet). Defaults to checking the URL's extension.
  videoFlags?: boolean[]
  // transitions[i] = the crossfade used leaving image i (last entry unused).
  transitions: (string | undefined)[]
  zoomStyles: (ReelZoomStyle | undefined)[]
  durations: (number | undefined)[]
  colorFilters: (string | undefined)[]
  // Shown for the whole video.
  textLayers: ReelTextLayer[]
  // imageTextLayers[i] shows only while image i is on screen.
  imageTextLayers: (ReelTextLayer[] | undefined)[]
  // The reel's template; clipTemplates[i] overrides it for clip i.
  template?: ReelTemplate | null
  clipTemplates?: (ReelTemplate | null | undefined)[]
  brand?: ReelBrand
  logo?: ReelLogo | null
  // Only play these clips (by position) instead of the whole reel - a
  // single clip holds still, handy for placing its text.
  visiblePositions?: number[] | null
  // CTAs with `clip` as an index into imageUrls (on-screen position).
  ctas?: ReelCta[]
  // When given, text/logo can be dragged; x/y are 0-1 frame fractions of the centre.
  onTextMove?: (target: TextTarget, index: number, x: number, y: number) => void
  onLogoMove?: (x: number, y: number) => void
  onCtaMove?: (index: number, x: number, y: number) => void
  width?: number
}) {
  const scale = width / 1080
  const px = (n: number, min = 1) => Math.max(min, n * scale)
  const brandColor = brand?.color ?? '#4F46E5'
  const title = brand?.title?.trim() ?? ''
  const outro = brand?.outro?.trim() ?? ''
  const frameRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)

  const allEntries: Entry[] = []
  imageUrls.forEach((url, i) => {
    if (!url) return
    const tpl = clipTemplates?.[i] ?? template
    const base = {
      kind: 'media' as const,
      pos: i,
      url,
      video: videoFlags?.[i] ?? isVideoUrl(url),
      transition: transitions[i],
      zoomStyle: zoomStyles[i],
      duration: durations[i],
      colorFilter: colorFilters[i],
      texts: imageTextLayers[i] ?? [],
      tpl,
    }
    const pattern = tpl?.cut_videos && tpl.durations?.length ? tpl.durations : null
    const duration = durations[i] ?? 0
    if (pattern && base.video && duration >= Math.min(...pattern) * 1.5) {
      // Rhythm templates cut videos to their clip-length pattern (a few
      // pieces is enough to show it), via media-fragment start times -
      // same idea as reel_generator.py's _rhythm_cuts.
      const cycle = tpl?.transitions ?? [tpl?.transition ?? 'fade']
      let sourceT = 0
      for (let j = 0; j < 4 && sourceT < duration; j++) {
        const len = pattern[j % pattern.length]
        const last = j === 3 || sourceT + len >= duration
        allEntries.push({
          ...base,
          url: `${url}#t=${sourceT.toFixed(1)}`,
          duration: len,
          transition: last ? base.transition : cycle[j % cycle.length],
        })
        sourceT += len
      }
    } else {
      allEntries.push(base)
    }
  })
  // Intro per the first clip's template, outro per the last's (as the render does).
  const mediaEntries = allEntries.filter((e) => e.kind === 'media')
  const firstTpl = mediaEntries[0]?.tpl ?? null
  const lastTpl = mediaEntries[mediaEntries.length - 1]?.tpl ?? null
  if (firstTpl?.intro_card) allEntries.unshift({ kind: 'card', title, duration: CARD_SECONDS, transition: 'fade', tpl: firstTpl })
  if (lastTpl?.outro_card) allEntries.push({ kind: 'card', title: outro, duration: CARD_SECONDS, transition: 'fade', tpl: lastTpl })

  // Each entry's span on the real reel timeline (clips overlap by the
  // transition out of the previous one), to know when CTAs are on screen.
  let clock = 0
  for (const entry of allEntries) {
    const len = entry.duration ?? DEFAULT_DISPLAY_MS / 300
    entry.span = { start: clock, end: clock + len }
    clock += len - (entry.tpl?.xfade ?? XFADE_SECONDS)
  }
  const ctaWindows = ctas.map((cta) => {
    const first = allEntries.find((e) => e.kind === 'media' && e.pos === cta.clip)
    const start = (first?.span?.start ?? 0) + cta.offset
    return { start, end: start + cta.duration }
  })

  // What plays: the whole reel, or just the chosen clips.
  const entries = visiblePositions
    ? allEntries.filter((e) => e.kind === 'media' && visiblePositions.includes(e.pos))
    : allEntries

  const key = entries.map((e) => (e.kind === 'media' ? e.url : `card:${e.title}`)).join('|')
  const firstMediaEntry = mediaEntries[0]
  const paused = dragging

  const [index, setIndex] = useState(0)
  const [zoomed, setZoomed] = useState(false)

  useEffect(() => {
    setIndex(0)
  }, [key])

  const safeIndex = index < entries.length ? index : 0
  const active = entries[safeIndex]
  // Cards hold text to read, so they get longer than the compressed clips.
  const activeDisplayMs = active?.kind === 'card' ? 2000 : previewMsFor(active?.duration)

  useEffect(() => {
    if (entries.length < 2 || paused) return
    const id = setTimeout(() => setIndex((i) => (i + 1) % entries.length), activeDisplayMs)
    return () => clearTimeout(id)
  }, [entries.length, safeIndex, activeDisplayMs, paused])

  const activeZoomStyle = active?.kind === 'media' ? (active.zoomStyle ?? 'zoom_in') : 'zoom_in'

  useEffect(() => {
    setZoomed(false)
    const id = setTimeout(() => setZoomed(true), 30)
    return () => clearTimeout(id)
  }, [safeIndex, activeZoomStyle])

  if (entries.length === 0) return null

  // Drags keep the grab offset, so the element doesn't jump its centre to
  // the pointer; positions are reported as 0-1 fractions of the frame.
  const startDrag = (e: React.PointerEvent<HTMLElement>, onMove: (x: number, y: number) => void) => {
    const frame = frameRef.current
    if (!frame) return
    e.preventDefault()
    e.stopPropagation()
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const rect = frame.getBoundingClientRect()
    const box = el.getBoundingClientRect()
    const offsetX = e.clientX - (box.left + box.width / 2)
    const offsetY = e.clientY - (box.top + box.height / 2)
    setDragging(true)
    const move = (ev: PointerEvent) =>
      onMove(clamp01((ev.clientX - offsetX - rect.left) / rect.width), clamp01((ev.clientY - offsetY - rect.top) / rect.height))
    const end = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', end)
      el.removeEventListener('pointercancel', end)
      setDragging(false)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', end)
    el.addEventListener('pointercancel', end)
  }

  // The transition currently animating is the one leaving the *previous*
  // entry, into the one that just became active.
  const prevIndex = (safeIndex - 1 + entries.length) % entries.length
  const activeTransition = entries[prevIndex]?.transition ?? 'fade'
  const family = TRANSITION_FAMILY[activeTransition] ?? 'fade'
  const hiddenTransform = FAMILY_HIDDEN_TRANSFORM[family]
  // CSS stand-ins for reel_generator.py's ZOOM_STYLES (centred zooms; pans
  // drift across a 1.15x crop).
  const ZOOM_CSS: Record<string, [string, string]> = {
    zoom_in: ['scale(1)', 'scale(1.15)'],
    zoom_out: ['scale(1.15)', 'scale(1)'],
    pan_left: ['scale(1.15) translateX(6%)', 'scale(1.15) translateX(-6%)'],
    pan_right: ['scale(1.15) translateX(-6%)', 'scale(1.15) translateX(6%)'],
    none: ['scale(1)', 'scale(1)'],
  }
  const [zoomFrom, zoomTo] = ZOOM_CSS[activeZoomStyle] ?? ZOOM_CSS.zoom_in
  const zoomTransform = zoomed ? zoomTo : zoomFrom

  const height = width * (16 / 9)
  const activeTpl = active?.tpl ?? null
  const letterboxH = activeTpl?.letterbox ? height * 0.11 : 0
  const frameW = activeTpl?.frame ? px(18, 2) : 0
  const canDrag = Boolean(onTextMove)
  const activeSpan = active?.span

  // Mirrors reel_chrome.py's _draw_text_layer (size, padding, line height, box).
  const renderText = (layer: ReelTextLayer, key: string, target: TextTarget, i: number) => {
    const fontSize = Math.max(6, layer.font_size * scale)
    return (
      <span
        key={key}
        onPointerDown={canDrag ? (e) => startDrag(e, (x, y) => onTextMove?.(target, i, x, y)) : undefined}
        title={canDrag ? 'Drag to move' : undefined}
        className={`pointer-events-auto absolute select-none text-center ${canDrag ? 'cursor-move hover:outline hover:outline-1 hover:outline-white/80' : ''}`}
        style={{
          left: `${layer.x * 100}%`,
          top: `${layer.y * 100}%`,
          transform: 'translate(-50%, -50%)',
          maxWidth: '90%',
          width: 'max-content',
          whiteSpace: 'pre-wrap',
          fontFamily: reelFontFamily(layer.font),
          fontSize,
          lineHeight: 1.25,
          color: layer.color,
          padding: `${fontSize * 0.2}px ${fontSize * 0.35}px`,
          borderRadius: fontSize * 0.25,
          background: layer.background ? 'rgba(0,0,0,0.43)' : 'transparent',
          textShadow: `0 0 ${Math.max(1, fontSize * 0.06)}px rgba(0,0,0,0.8)`,
          touchAction: 'none',
        }}
      >
        {layer.text}
      </span>
    )
  }

  return (
    <div>
      <style>{CTA_KEYFRAMES}</style>
      <div
        ref={frameRef}
        className="relative mx-auto overflow-hidden rounded-md bg-black"
        style={{ width, height }}
      >
        {entries.map((entry, i) => {
          const isActive = i === safeIndex
          return (
            <div
              key={i}
              className="absolute inset-0 overflow-hidden ease-in-out"
              style={{
                transitionProperty: 'transform, opacity',
                transitionDuration: `${TRANSITION_MS}ms`,
                transform: isActive ? 'none' : hiddenTransform,
                opacity: family === 'fade' ? (isActive ? 1 : 0) : 1,
                zIndex: isActive ? 2 : 1,
              }}
            >
              {entry.kind === 'card' ? (
                <div
                  className="flex h-full w-full flex-col items-center justify-center gap-2 px-3 text-center"
                  style={{ background: `linear-gradient(180deg, ${brandColor}, #111827)` }}
                >
                  {logo && <img src={logo.url} alt="" style={{ width: px(300, 20) }} className="object-contain" />}
                  {entry.title && (
                    <span className="text-white" style={{ fontFamily: reelFontFamily('poppins'), fontSize: px(88, 9), lineHeight: 1.25 }}>
                      {entry.title}
                    </span>
                  )}
                </div>
              ) : entry.video ? (
                <video
                  src={entry.url}
                  autoPlay
                  muted
                  loop
                  playsInline
                  className="h-full w-full object-cover"
                  style={{ filter: COLOR_FILTER_CSS[entry.colorFilter ?? 'none'] ?? 'none' }}
                />
              ) : (
                <img
                  src={entry.url}
                  alt=""
                  className="h-full w-full object-cover ease-linear"
                  style={{
                    transform: isActive ? zoomTransform : 'scale(1)',
                    transitionProperty: 'transform',
                    transitionDuration: isActive ? `${activeDisplayMs}ms` : '0ms',
                    filter: COLOR_FILTER_CSS[entry.colorFilter ?? 'none'] ?? 'none',
                  }}
                />
              )}
            </div>
          )
        })}

        {active?.kind === 'media' && (
          <div className="pointer-events-none absolute inset-0 z-10">
            {/* Template chrome - mirrors reel_chrome.py's _draw_chrome. */}
            {activeTpl?.letterbox && (
              <>
                <div className="absolute inset-x-0 top-0 bg-black" style={{ height: letterboxH }} />
                <div className="absolute inset-x-0 bottom-0 bg-black" style={{ height: letterboxH }} />
              </>
            )}
            {activeTpl?.frame && (
              <div className="absolute inset-0" style={{ border: `${frameW}px solid ${brandColor}` }} />
            )}
            {logo && (
              <img
                src={logo.url}
                alt=""
                draggable={false}
                onPointerDown={onLogoMove ? (e) => startDrag(e, onLogoMove) : undefined}
                title={onLogoMove ? 'Drag to move' : undefined}
                className={`absolute object-contain ${onLogoMove ? 'pointer-events-auto cursor-move hover:outline hover:outline-1 hover:outline-white/80' : ''}`}
                style={{
                  left: `${logo.x * 100}%`,
                  top: `${logo.y * 100}%`,
                  width: `${logo.scale * 100}%`,
                  transform: 'translate(-50%, -50%)',
                  touchAction: 'none',
                }}
              />
            )}
            {firstTpl?.hook_seconds && active === firstMediaEntry && title && (
              firstTpl.hook_style === 'elegant' ? (
                <span
                  className="absolute inset-x-0 top-1/2 -translate-y-1/2 px-3 text-center text-white"
                  style={{ fontFamily: reelFontFamily('dmserif'), fontSize: px(76, 9), textShadow: '0 1px 3px rgba(0,0,0,0.9)' }}
                >
                  {title}
                </span>
              ) : (
                <span
                  className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-md text-center uppercase text-white"
                  style={{ top: '36%', maxWidth: '88%', background: brandColor, fontFamily: reelFontFamily('anton'), fontSize: px(92, 10), padding: `${px(18, 2)}px ${px(32, 4)}px` }}
                >
                  {title}
                </span>
              )
            )}

            {/* The user's own text: whole-video layers, then this clip's. */}
            {textLayers.map((layer, i) =>
              layer.text.trim() ? renderText(layer, `g${i}`, { scope: 'global' }, i) : null,
            )}
            {active.texts.map((layer, i) =>
              layer.text.trim() ? renderText(layer, `c${i}`, { scope: 'clip', pos: active.pos }, i) : null,
            )}

            {/* Calls to action on screen during this clip. Their pop-up
                plays on the clip they start in; clips they carry over onto
                show them already in place. */}
            {ctas.map((cta, i) => {
              const window = ctaWindows[i]
              if (!cta.text.trim() || !activeSpan) return null
              if (window.end <= activeSpan.start || window.start >= activeSpan.end) return null
              const startsHere = window.start >= activeSpan.start
              // Preview time is compressed ~0.3x (see previewMsFor).
              const delayMs = startsHere ? Math.min((window.start - activeSpan.start) * 300, activeDisplayMs * 0.6) : 0
              const fontSize = Math.max(6, cta.font_size * scale)
              return (
                <span
                  key={`cta${i}-${safeIndex}`}
                  onPointerDown={onCtaMove ? (e) => startDrag(e, (x, y) => onCtaMove(i, x, y)) : undefined}
                  title={onCtaMove ? 'Drag to move' : undefined}
                  className={`absolute select-none whitespace-nowrap rounded-full ${onCtaMove ? 'pointer-events-auto cursor-move hover:outline hover:outline-1 hover:outline-white/80' : ''}`}
                  style={{
                    left: `${cta.x * 100}%`,
                    top: `${cta.y * 100}%`,
                    transform: 'translate(-50%, -50%)',
                    fontFamily: reelFontFamily(cta.font),
                    fontSize,
                    lineHeight: 1.25,
                    color: cta.text_color,
                    background: cta.bg_color,
                    padding: `${fontSize * 0.45}px ${fontSize * 0.8}px`,
                    animation: startsHere && !dragging ? ctaAnimationCss(cta.animation, delayMs) : undefined,
                    touchAction: 'none',
                  }}
                >
                  {cta.text}
                </span>
              )
            })}
          </div>
        )}
      </div>
      <p className="mt-1 text-center text-[10px] text-gray-400">
        {canDrag ? 'Drag text, logo and buttons to move them · approximate' : 'Live preview · approximate'}
      </p>
    </div>
  )
}
