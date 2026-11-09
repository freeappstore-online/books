import {
  BOOK_TEXT, UI_TEXT,
  setReaderFontSize, setUiScale, useReaderFontSize, useUiScale,
} from '../hooks/usePreferences'

interface RowProps {
  label: string
  hint: string
  value: number
  unit: string
  range: { min: number; max: number; step: number; default: number }
  onChange: (v: number) => void
}

function SizeRow({ label, hint, value, unit, range, onChange }: RowProps) {
  const btn = 'w-9 h-9 shrink-0 rounded-lg bg-surface-hover text-text hover:bg-border disabled:opacity-40 transition'
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <label className="text-sm text-text">{label}</label>
        <span className="text-xs text-text-muted tabular-nums">
          {value}{unit}
          {value !== range.default && (
            <button onClick={() => onChange(range.default)} className="ml-2 text-accent hover:underline">Reset</button>
          )}
        </span>
      </div>
      <p className="text-xs text-text-dim mb-2">{hint}</p>
      <div className="flex items-center gap-2">
        <button className={btn} onClick={() => onChange(value - range.step)} disabled={value <= range.min}
          aria-label={`Smaller ${label.toLowerCase()}`}><span className="text-xs">A</span></button>
        <input
          type="range" min={range.min} max={range.max} step={range.step} value={value}
          onChange={e => onChange(Number(e.target.value))}
          aria-label={label}
          className="flex-1 accent-accent"
        />
        <button className={btn} onClick={() => onChange(value + range.step)} disabled={value >= range.max}
          aria-label={`Larger ${label.toLowerCase()}`}><span className="text-lg leading-none">A</span></button>
      </div>
    </div>
  )
}

/** Book text size and interface text size: independent, applied immediately, saved on this device. */
export function TextSizeControls({ preview = true }: { preview?: boolean }) {
  const bookSize = useReaderFontSize()
  const uiScale = useUiScale()
  return (
    <div className="space-y-5">
      <SizeRow
        label="Book text size"
        hint="Only the text of the book you're reading."
        value={bookSize} unit="px" range={BOOK_TEXT} onChange={setReaderFontSize}
      />
      {preview && (
        <p className="text-text-muted rounded-lg bg-page p-3 -mt-2" style={{ fontSize: `${bookSize}px`, lineHeight: 1.8 }}>
          Alice was beginning to get very tired of sitting by her sister on the bank.
        </p>
      )}
      <SizeRow
        label="Interface text size"
        hint="Menus, buttons, labels and the player. Book text stays as set above."
        value={uiScale} unit="%" range={UI_TEXT} onChange={setUiScale}
      />
    </div>
  )
}
