import { useQuotes } from '../hooks/useQuotes'
import { useWatchlist } from '../context/WatchlistContext'

function fmtPrice(v: number): string {
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtPct(v: number): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
}

interface WatchlistProps {
  onSelect: (symbol: string) => void
  selected: string
}

export function Watchlist({ onSelect, selected }: WatchlistProps) {
  const { symbols, removeSymbol } = useWatchlist()
  const { quotes, loading, error, flashMap } = useQuotes(symbols, 30000)

  return (
    <div className="flex flex-col h-full bg-surface border-r border-border" style={{ width: '220px', minWidth: '220px' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-border">
        <span className="panel-header text-orange font-bold text-xs tracking-widest">WATCHLIST</span>
        <span className="text-secondary text-xs">F1</span>
      </div>

      {/* Column headers */}
      <div className="grid text-secondary text-xs px-2 py-1 border-b border-border" style={{ gridTemplateColumns: '52px 1fr 62px' }}>
        <span>SYM</span>
        <span className="text-right">LAST</span>
        <span className="text-right">CHG%</span>
      </div>

      {/* Rows */}
      <div className="flex-1 overflow-y-auto">
        {loading && Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="px-2 py-1.5 border-b border-border">
            <div className="skeleton h-3 w-full rounded-none" />
          </div>
        ))}
        {error && (
          <div className="px-2 py-2 text-red text-xs font-mono">[ERR: {error}]</div>
        )}
        {!loading && quotes.map(q => {
          const flash = flashMap.get(q.symbol)
          const isPos = q.changePct >= 0
          const isSelected = q.symbol === selected
          return (
            <div
              key={q.symbol}
              onClick={() => onSelect(q.symbol)}
              onContextMenu={(e) => {
                e.preventDefault()
                removeSymbol(q.symbol)
              }}
              className={`grid px-2 py-1 border-b border-border cursor-pointer transition-colors
                ${flash === 'up' ? 'flash-up' : flash === 'down' ? 'flash-down' : ''}
                ${isSelected ? 'bg-surface2' : 'hover:bg-surface2'}
              `}
              style={{ gridTemplateColumns: '52px 1fr 62px' }}
            >
              <span className={`font-bold text-xs font-mono ${isSelected ? 'text-orange' : 'text-primary'}`}>
                {isSelected && <span className="text-orange mr-0.5">|</span>}
                {q.symbol}
              </span>
              <span className={`text-right text-xs font-mono ${isPos ? 'text-green' : 'text-red'}`}>
                {fmtPrice(q.last)}
              </span>
              <span className={`text-right text-xs font-mono ${isPos ? 'text-green' : 'text-red'}`}>
                {fmtPct(q.changePct)}
              </span>
            </div>
          )
        })}
      </div>

      {/* Footer */}
      <div className="px-2 py-1 border-t border-border text-secondary text-xs">
        {quotes.length} SYMBOLS
      </div>
    </div>
  )
}
