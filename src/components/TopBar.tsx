import { useMacro } from '../hooks/useMacro'

function MacroTicker({ label, value, changePct }: { label: string; value: number | null; changePct?: number }) {
  const isPos = (changePct ?? 0) > 0
  const isNeg = (changePct ?? 0) < 0
  const tri = isPos ? '▲' : isNeg ? '▼' : '▶'
  const triColor = isPos ? 'text-green' : isNeg ? 'text-red' : 'text-yellow'
  return (
    <span className="flex items-center gap-1.5 px-3 border-r border-border text-xs font-mono whitespace-nowrap">
      <span className="text-secondary">{label}</span>
      <span className="font-semibold text-primary">
        {value != null ? value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '---'}
      </span>
      <span className={`${triColor} text-[10px] leading-none`}>{tri}</span>
      {changePct != null && (
        <span className="text-secondary">
          {changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}%
        </span>
      )}
    </span>
  )
}

export function TopBar() {
  const { data } = useMacro()

  const now = new Date()
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'America/New_York' })

  return (
    <div className="flex items-center bg-surface border-b border-border" style={{ height: '28px', minHeight: '28px' }}>
      {/* Ticker strip */}
      <div
        className="marquee flex items-center flex-1"
        style={{ ['--marquee-duration' as string]: `${Math.max(24, data.length * 4)}s` }}
      >
        <div className="marquee-track">
          {data.map(m => (
            <MacroTicker key={`a-${m.label}`} label={m.label} value={m.value} changePct={m.changePct} />
          ))}
          {data.map(m => (
            <MacroTicker key={`b-${m.label}`} label={m.label} value={m.value} changePct={m.changePct} />
          ))}
        </div>
      </div>
      {/* Live clock */}
      <div className="flex items-center gap-2 px-3 border-l border-border text-xs font-mono whitespace-nowrap shrink-0">
        <span className="w-2 h-2 rounded-full bg-green animate-pulse inline-block" />
        <span className="text-green font-semibold">LIVE</span>
        <span className="text-primary">{timeStr}</span>
        <span className="text-secondary">EST</span>
      </div>
    </div>
  )
}
