import {
  DEFAULT_TEXT_LAYER,
  REEL_MAX_FONT_SIZE,
  REEL_MAX_TEXT_LAYERS,
  REEL_MIN_FONT_SIZE,
  type ReelFont,
  type ReelTextLayer,
} from '../api/client'
import { reelFontFamily } from './useReelFonts'

export default function TextLayerEditor({
  label,
  hint,
  layers,
  fonts,
  onChange,
}: {
  label: string
  hint?: string
  layers: ReelTextLayer[]
  fonts: ReelFont[]
  onChange: (layers: ReelTextLayer[]) => void
}) {
  const update = (index: number, patch: Partial<ReelTextLayer>) => {
    onChange(layers.map((layer, i) => (i === index ? { ...layer, ...patch } : layer)))
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <label className="block text-sm font-medium text-gray-900">{label}</label>
        {layers.length < REEL_MAX_TEXT_LAYERS && (
          <button
            type="button"
            // Staggered so several new layers don't land exactly on top of each other.
            onClick={() => onChange([...layers, { ...DEFAULT_TEXT_LAYER, y: 0.3 + (layers.length % 5) * 0.1 }])}
            className="rounded-md border border-indigo-200 px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50"
          >
            + Add text
          </button>
        )}
      </div>
      {hint && <p className="mt-0.5 text-xs text-gray-500">{hint}</p>}

      {layers.length === 0 && <p className="mt-2 text-xs text-gray-400">No text added.</p>}

      <div className="mt-2 space-y-3">
        {layers.map((layer, i) => (
          <div key={i} className="rounded-md border border-gray-200 p-3">
            <div className="flex items-start gap-2">
              <textarea
                value={layer.text}
                rows={Math.min(4, Math.max(1, layer.text.split('\n').length))}
                placeholder="Type the text to show on the video"
                onChange={(e) => update(i, { text: e.target.value })}
                style={{ fontFamily: reelFontFamily(layer.font) }}
                className="w-full resize-y rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => onChange(layers.filter((_, idx) => idx !== i))}
                className="flex-none px-1 text-xs text-red-600 hover:underline"
              >
                Remove
              </button>
            </div>

            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-4">
              <label className="col-span-2 flex flex-col gap-1 text-xs text-gray-500">
                Font
                <select
                  value={layer.font}
                  onChange={(e) => update(i, { font: e.target.value })}
                  style={{ fontFamily: reelFontFamily(layer.font) }}
                  className="rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none"
                >
                  {(fonts.length ? fonts : [{ id: layer.font, name: layer.font, url: '' }]).map((font) => (
                    <option key={font.id} value={font.id} style={{ fontFamily: reelFontFamily(font.id) }}>
                      {font.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="col-span-2 flex flex-col gap-1 text-xs text-gray-500">
                Size: {layer.font_size}
                <input
                  type="range"
                  min={REEL_MIN_FONT_SIZE}
                  max={REEL_MAX_FONT_SIZE}
                  value={layer.font_size}
                  onChange={(e) => update(i, { font_size: Number(e.target.value) })}
                />
              </label>
              <label className="flex items-center gap-1.5 text-xs text-gray-500">
                Colour
                <input
                  type="color"
                  value={layer.color}
                  onChange={(e) => update(i, { color: e.target.value })}
                  className="h-7 w-10 cursor-pointer rounded border border-gray-300"
                />
              </label>
              <label className="flex items-center gap-1.5 text-xs text-gray-500">
                <input
                  type="checkbox"
                  checked={layer.background}
                  onChange={(e) => update(i, { background: e.target.checked })}
                />
                Dark box behind
              </label>
              <button
                type="button"
                onClick={() => update(i, { x: 0.5 })}
                className="justify-self-start text-xs text-indigo-600 hover:underline"
              >
                Centre horizontally
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
