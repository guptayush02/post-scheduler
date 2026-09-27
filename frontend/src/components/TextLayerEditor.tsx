import {
  REEL_MAX_FONT_SIZE,
  REEL_MAX_TEXT_LAYERS,
  REEL_MIN_FONT_SIZE,
  REEL_TEXT_POSITIONS,
  type ReelTextLayer,
} from '../api/client'

export const DEFAULT_TEXT_LAYER: ReelTextLayer = {
  text: '',
  font_size: 48,
  color: '#FFFFFF',
  position: 'bottom_center',
}

export default function TextLayerEditor({
  label,
  hint,
  layers,
  onChange,
}: {
  label: string
  hint?: string
  layers: ReelTextLayer[]
  onChange: (layers: ReelTextLayer[]) => void
}) {
  const update = (index: number, patch: Partial<ReelTextLayer>) => {
    onChange(layers.map((layer, i) => (i === index ? { ...layer, ...patch } : layer)))
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <label className="block text-xs font-medium text-gray-500">{label}</label>
        {layers.length < REEL_MAX_TEXT_LAYERS && (
          <button
            type="button"
            onClick={() => onChange([...layers, { ...DEFAULT_TEXT_LAYER }])}
            className="text-xs text-indigo-600 hover:underline"
          >
            + Add text
          </button>
        )}
      </div>
      {hint && <p className="mt-0.5 text-xs text-gray-400">{hint}</p>}

      {layers.length === 0 && <p className="mt-2 text-xs text-gray-400">No text added.</p>}

      <div className="mt-2 space-y-3">
        {layers.map((layer, i) => (
          <div key={i} className="rounded-md border border-gray-200 p-3">
            <div className="flex items-start gap-2">
              <input
                type="text"
                value={layer.text}
                placeholder="Text to show on the video"
                onChange={(e) => update(i, { text: e.target.value })}
                className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => onChange(layers.filter((_, idx) => idx !== i))}
                className="flex-none px-1 text-xs text-red-600 hover:underline"
              >
                Remove
              </button>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-1.5 text-xs text-gray-500">
                Size
                <input
                  type="number"
                  min={REEL_MIN_FONT_SIZE}
                  max={REEL_MAX_FONT_SIZE}
                  value={layer.font_size}
                  onChange={(e) => update(i, { font_size: Number(e.target.value) })}
                  className="w-16 rounded-md border border-gray-300 px-2 py-1 text-sm"
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
                Position
                <select
                  value={layer.position}
                  onChange={(e) => update(i, { position: e.target.value })}
                  className="rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none"
                >
                  {REEL_TEXT_POSITIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
