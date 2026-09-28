import {
  DEFAULT_CTA,
  REEL_CTA_ANIMATIONS,
  REEL_MAX_CTAS,
  REEL_MAX_FONT_SIZE,
  REEL_MIN_FONT_SIZE,
  type ReelCta,
  type ReelCtaAnimation,
  type ReelFont,
} from '../api/client'
import { reelFontFamily } from './useReelFonts'

// `clip` values are original clip indices (the same space as the preview
// page's imageOrder values), so a CTA stays with its clip when clips are
// dragged into a new order.
export default function CtaEditor({
  ctas,
  fonts,
  clipOptions,
  defaultClip,
  onChange,
}: {
  ctas: ReelCta[]
  fonts: ReelFont[]
  clipOptions: { value: number; label: string }[]
  defaultClip: number
  onChange: (ctas: ReelCta[]) => void
}) {
  const update = (index: number, patch: Partial<ReelCta>) => {
    onChange(ctas.map((cta, i) => (i === index ? { ...cta, ...patch } : cta)))
  }
  const inputClass =
    'w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none'

  return (
    <div>
      <div className="flex items-center justify-between">
        <label className="block text-sm font-medium text-gray-900">Calls to action</label>
        {ctas.length < REEL_MAX_CTAS && (
          <button
            type="button"
            onClick={() => onChange([...ctas, { ...DEFAULT_CTA, clip: defaultClip }])}
            className="rounded-md border border-indigo-200 px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50"
          >
            + Add call to action
          </button>
        )}
      </div>
      <p className="mt-0.5 text-xs text-gray-500">
        Buttons that pop up on any clip, at any moment, for as long as you like - even across clips. Drag them in
        the live preview to position them. A link can't be clicked inside a video, so it's added to the end of
        the post text instead (clickable on Facebook).
      </p>

      {ctas.length === 0 && <p className="mt-2 text-xs text-gray-400">No calls to action added.</p>}

      <div className="mt-2 space-y-3">
        {ctas.map((cta, i) => (
          <div key={i} className="rounded-md border border-orange-200 bg-orange-50/40 p-3">
            <div className="flex items-start gap-2">
              <input
                value={cta.text}
                maxLength={80}
                placeholder="Button text, e.g. Call now"
                onChange={(e) => update(i, { text: e.target.value })}
                style={{ fontFamily: reelFontFamily(cta.font) }}
                className={inputClass}
              />
              <button
                type="button"
                onClick={() => onChange(ctas.filter((_, idx) => idx !== i))}
                className="flex-none px-1 text-xs text-red-600 hover:underline"
              >
                Remove
              </button>
            </div>
            <input
              value={cta.link ?? ''}
              placeholder="Link (optional), e.g. yourshop.com"
              inputMode="url"
              onChange={(e) => update(i, { link: e.target.value || null })}
              className={`mt-2 ${inputClass}`}
            />

            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-4">
              <label className="flex flex-col gap-1 text-xs text-gray-500">
                Appears on
                <select value={cta.clip} onChange={(e) => update(i, { clip: Number(e.target.value) })} className={inputClass}>
                  {clipOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-gray-500">
                After (seconds)
                <input
                  type="number"
                  min={0}
                  max={90}
                  step={0.5}
                  value={cta.offset}
                  onChange={(e) => update(i, { offset: Math.max(0, Number(e.target.value)) })}
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-gray-500">
                Stays for (seconds)
                <input
                  type="number"
                  min={0.5}
                  max={90}
                  step={0.5}
                  value={cta.duration}
                  onChange={(e) => update(i, { duration: Math.max(0.5, Number(e.target.value)) })}
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-gray-500">
                Animation
                <select
                  value={cta.animation}
                  onChange={(e) => update(i, { animation: e.target.value as ReelCtaAnimation })}
                  className={inputClass}
                >
                  {REEL_CTA_ANIMATIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="col-span-2 flex flex-col gap-1 text-xs text-gray-500">
                Font
                <select
                  value={cta.font}
                  onChange={(e) => update(i, { font: e.target.value })}
                  style={{ fontFamily: reelFontFamily(cta.font) }}
                  className={inputClass}
                >
                  {(fonts.length ? fonts : [{ id: cta.font, name: cta.font, url: '' }]).map((font) => (
                    <option key={font.id} value={font.id} style={{ fontFamily: reelFontFamily(font.id) }}>
                      {font.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="col-span-2 flex flex-col gap-1 text-xs text-gray-500">
                Size: {cta.font_size}
                <input
                  type="range"
                  min={REEL_MIN_FONT_SIZE}
                  max={REEL_MAX_FONT_SIZE}
                  value={cta.font_size}
                  onChange={(e) => update(i, { font_size: Number(e.target.value) })}
                />
              </label>
              <label className="flex items-center gap-1.5 text-xs text-gray-500">
                Button
                <input
                  type="color"
                  value={cta.bg_color}
                  onChange={(e) => update(i, { bg_color: e.target.value })}
                  className="h-7 w-10 cursor-pointer rounded border border-gray-300"
                />
              </label>
              <label className="flex items-center gap-1.5 text-xs text-gray-500">
                Text
                <input
                  type="color"
                  value={cta.text_color}
                  onChange={(e) => update(i, { text_color: e.target.value })}
                  className="h-7 w-10 cursor-pointer rounded border border-gray-300"
                />
              </label>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
