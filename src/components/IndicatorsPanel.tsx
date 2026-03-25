export interface Indicators {
  rsi: boolean
  sma20: boolean
  ema20: boolean
  macd: boolean
}

interface Props {
  indicators: Indicators
  onChange: (next: Indicators) => void
}

function Toggle({ label, value, onToggle }: { label: string; value: boolean; onToggle: () => void }) {
  return (
    <button
      className={`w-full text-left px-2 py-1 text-xs font-mono border transition-colors
        ${value ? 'text-orange border-orange' : 'text-secondary border-border hover:text-primary'}`}
      onClick={onToggle}
    >
      {value ? '●' : '○'} {label}
    </button>
  )
}

export function IndicatorsPanel({ indicators, onChange }: Props) {
  const set = (key: keyof Indicators) => {
    onChange({ ...indicators, [key]: !indicators[key] })
  }

  return (
    <div className="border border-border bg-surface/80">
      <div className="px-2 py-1 border-b border-border">
        <span className="text-secondary text-[10px] font-mono tracking-wider">INDICATORS</span>
      </div>
      <div className="p-2 space-y-1">
        <Toggle label="RSI" value={indicators.rsi} onToggle={() => set('rsi')} />
        <Toggle label="SMA 20" value={indicators.sma20} onToggle={() => set('sma20')} />
        <Toggle label="EMA 20" value={indicators.ema20} onToggle={() => set('ema20')} />
        <Toggle label="MACD" value={indicators.macd} onToggle={() => set('macd')} />
      </div>
    </div>
  )
}
