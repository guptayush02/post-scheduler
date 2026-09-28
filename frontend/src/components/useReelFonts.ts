import { useEffect, useState } from 'react'
import { listReelFonts, type ReelFont } from '../api/client'

// The same font files the backend renders reel text with (served from
// /reel-fonts), registered under "reel-<id>" so the live preview and the
// final video use identical fonts.
export function reelFontFamily(id: string): string {
  return `reel-${id}, sans-serif`
}

let loading: Promise<ReelFont[]> | null = null

function loadFonts(): Promise<ReelFont[]> {
  loading ??= listReelFonts()
    .then(async (fonts) => {
      await Promise.all(
        fonts.map(async (font) => {
          try {
            const face = new FontFace(`reel-${font.id}`, `url(${font.url})`)
            document.fonts.add(await face.load())
          } catch {
            // Falls back to sans-serif in the preview; the render is unaffected.
          }
        }),
      )
      return fonts
    })
    .catch(() => {
      loading = null
      return []
    })
  return loading
}

export function useReelFonts(): ReelFont[] {
  const [fonts, setFonts] = useState<ReelFont[]>([])
  useEffect(() => {
    let alive = true
    loadFonts().then((loaded) => alive && setFonts(loaded))
    return () => {
      alive = false
    }
  }, [])
  return fonts
}
