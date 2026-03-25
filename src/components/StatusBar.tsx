interface StatusBarProps {
  lastUpdate: Date | null
}

const SOURCES = [
  { name: 'YAHOO FINANCE', color: '#00cc44' },
  { name: 'POLYGON.IO',    color: '#00cc44' },
  { name: 'UNUSUAL WHALES', color: '#ff6600' },
  { name: 'FRED API',       color: '#888888' },
]

export function StatusBar({ lastUpdate }: StatusBarProps) {
  const timeStr = lastUpdate
    ? lastUpdate.toLocaleTimeString('en-US', {
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false, timeZone: 'America/New_York'
      })
    : '--:--:--'

  return (
    <div
      className="flex items-center gap-4 px-3 border-t border-border bg-surface text-xs font-mono"
      style={{ height: '24px', minHeight: '24px' }}
    >
      {SOURCES.map(s => (
        <span key={s.name} className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ backgroundColor: s.color }} />
          <span className="text-secondary">{s.name}</span>
        </span>
      ))}
      <span className="ml-auto text-secondary">
        LAST UPDATE: <span className="text-primary">{timeStr}</span>
      </span>
      <span className="text-secondary">·</span>
      <span className="text-secondary">DELAY: 15MIN</span>
      <span className="text-secondary">·</span>
      <span className="text-orange font-bold">ECHELON v0.1</span>
    </div>
  )
}
