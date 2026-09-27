import { useEffect, useState } from 'react'
import { isVideoUrl, type ReelTextLayer, type ReelZoomStyle } from '../api/client'

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

// The reel renders at 1080px wide; the preview box is much smaller, so
// font sizes are scaled by the same ratio (with a floor, or small text
// would be illegible here even though it's fine in the real video).
const PREVIEW_WIDTH_PX = 126
const FONT_SCALE = PREVIEW_WIDTH_PX / 1080

function textLayerStyle(layer: ReelTextLayer): React.CSSProperties {
  const [vertical, horizontal] = layer.position.split('_')
  const style: React.CSSProperties = {
    position: 'absolute',
    color: layer.color,
    fontSize: `${Math.max(6, layer.font_size * FONT_SCALE)}px`,
    fontWeight: 700,
    lineHeight: 1.15,
    textAlign: 'center',
    padding: '1px 3px',
    borderRadius: 2,
    background: 'rgba(0,0,0,0.4)',
    maxWidth: '92%',
    pointerEvents: 'none',
  }
  if (vertical === 'top') style.top = '6%'
  else if (vertical === 'bottom') style.bottom = '8%'
  else {
    style.top = '50%'
    style.transform = 'translateY(-50%)'
  }
  if (horizontal === 'left') style.left = '4%'
  else if (horizontal === 'right') style.right = '4%'
  else {
    style.left = '50%'
    style.transform = style.transform ? 'translate(-50%, -50%)' : 'translateX(-50%)'
  }
  return style
}

const DEFAULT_DISPLAY_MS = 2200
const MIN_DISPLAY_MS = 800
const MAX_DISPLAY_MS = 4000
const TRANSITION_MS = 700

// Real per-image durations can be 2-30s - compressed (capped) here so the
// preview stays quick to watch while still reflecting relative pacing
// (a 3s image previews faster than a 12s one, up to the cap).
function previewMsFor(seconds: number | undefined): number {
  if (!seconds) return DEFAULT_DISPLAY_MS
  return Math.min(MAX_DISPLAY_MS, Math.max(MIN_DISPLAY_MS, seconds * 300))
}

export default function ReelAnimationPreview({
  imageUrls,
  transitions,
  zoomStyles,
  durations,
  colorFilters,
  textLayers,
  imageTextLayers,
}: {
  imageUrls: (string | undefined)[]
  // transitions[i] = the crossfade used leaving image i (last entry unused).
  transitions: (string | undefined)[]
  zoomStyles: (ReelZoomStyle | undefined)[]
  durations: (number | undefined)[]
  colorFilters: (string | undefined)[]
  // Shown for the whole video.
  textLayers: ReelTextLayer[]
  // imageTextLayers[i] shows only while image i is on screen.
  imageTextLayers: (ReelTextLayer[] | undefined)[]
}) {
  const entries = imageUrls
    .map((url, i) => ({
      url,
      transition: transitions[i],
      zoomStyle: zoomStyles[i],
      duration: durations[i],
      colorFilter: colorFilters[i],
      texts: imageTextLayers[i] ?? [],
    }))
    .filter((e): e is {
      url: string
      transition: string | undefined
      zoomStyle: ReelZoomStyle | undefined
      duration: number | undefined
      colorFilter: string | undefined
      texts: ReelTextLayer[]
    } => Boolean(e.url))
  const urls = entries.map((e) => e.url)
  const key = urls.join('|')

  const [index, setIndex] = useState(0)
  const [zoomed, setZoomed] = useState(false)

  useEffect(() => {
    setIndex(0)
  }, [key])

  const activeDisplayMs = previewMsFor(entries[index]?.duration)

  useEffect(() => {
    if (urls.length < 2) return
    const id = setTimeout(() => setIndex((i) => (i + 1) % urls.length), activeDisplayMs)
    return () => clearTimeout(id)
  }, [urls.length, index, activeDisplayMs])

  const activeZoomStyle = entries[index]?.zoomStyle ?? 'zoom_in'

  useEffect(() => {
    setZoomed(false)
    const id = setTimeout(() => setZoomed(true), 30)
    return () => clearTimeout(id)
  }, [index, activeZoomStyle])

  if (urls.length === 0) return null

  // The transition currently animating is the one leaving the *previous*
  // image, into the one that just became active.
  const prevIndex = (index - 1 + urls.length) % urls.length
  const activeTransition = entries[prevIndex]?.transition ?? 'fade'
  const family = TRANSITION_FAMILY[activeTransition] ?? 'fade'
  const hiddenTransform = FAMILY_HIDDEN_TRANSFORM[family]
  const zoomTransform =
    activeZoomStyle === 'zoom_in'
      ? zoomed ? 'scale(1.15)' : 'scale(1)'
      : activeZoomStyle === 'zoom_out'
        ? zoomed ? 'scale(1)' : 'scale(1.15)'
        : 'scale(1)'

  const activeTexts = entries[index]?.texts ?? []

  return (
    <div>
      <div
        className="relative mx-auto overflow-hidden rounded-md bg-black"
        style={{ width: PREVIEW_WIDTH_PX, height: PREVIEW_WIDTH_PX * (16 / 9) }}
      >
        {urls.map((url, i) => {
          const isActive = i === index
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
              {isVideoUrl(url) ? (
                <video
                  src={url}
                  autoPlay
                  muted
                  loop
                  playsInline
                  className="h-full w-full object-cover"
                  style={{ filter: COLOR_FILTER_CSS[entries[i]?.colorFilter ?? 'none'] ?? 'none' }}
                />
              ) : (
              <img
                src={url}
                alt=""
                className="h-full w-full object-cover ease-linear"
                style={{
                  transform: isActive ? zoomTransform : 'scale(1)',
                  transitionProperty: 'transform',
                  transitionDuration: isActive ? `${activeDisplayMs}ms` : '0ms',
                  filter: COLOR_FILTER_CSS[entries[i]?.colorFilter ?? 'none'] ?? 'none',
                }}
              />
              )}
            </div>
          )
        })}

        {/* Text sits above the images: whole-video layers plus whatever
            belongs to the image currently on screen. */}
        <div className="absolute inset-0 z-10">
          {[...textLayers, ...activeTexts]
            .filter((layer) => layer.text.trim())
            .map((layer, i) => (
              <span key={i} style={textLayerStyle(layer)}>
                {layer.text}
              </span>
            ))}
        </div>
      </div>
      <p className="mt-1 text-center text-[10px] text-gray-400">Approximate preview</p>
    </div>
  )
}
