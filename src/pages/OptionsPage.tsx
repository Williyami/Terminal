import { useState, useMemo } from 'react'
import { useOptionsChain } from '../hooks/useOptionsChain'

function fmt2(v: number) { return v.toFixed(2) }
function fmtK(v: number) {
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`
  return String(v)
}

type SortKey = 'strike' | 'volume' | 'openInterest' | 'iv'

function IVBar({ iv }: { iv: number }) {
  const pct = Math.min(100, iv)
  const color = iv > 80 ? '#ff3333' : iv > 50 ? '#ff6600' : '#888888'
  return (
    <div className="flex items-center gap-1">
      <div className="flex-1 bg-border h-1" style={{ maxWidth: 40 }}>
        <div style={{ width: `${pct}%`, height: '100%', backgroundColor: color }} />
      </div>
      <span>{iv.toFixed(1)}%</span>
    </div>
  )
}


interface OptionsPageProps {
  symbol: string
}

export function OptionsPage({ symbol }: OptionsPageProps) {
  const { chain, expirations, selectedExpiry, selectExpiry, spot, loading, error } = useOptionsChain(symbol)
  const [sortKey, setSortKey] = useState<SortKey>('strike')
  const [showITM, setShowITM] = useState(true)
  const [view, setView] = useState<'chain' | 'straddle'>('chain')

  const strikes = useMemo(() => {
    if (!chain) return []
    const all = new Set([
      ...chain.calls.map(c => c.strike),
      ...chain.puts.map(c => c.strike),
    ])
    return Array.from(all).sort((a, b) => a - b)
  }, [chain])

  const filteredStrikes = useMemo(() => {
    if (!showITM) return strikes
    // Show 10 strikes around ATM
    const atmIdx = strikes.findIndex(s => s >= spot)
    const start = Math.max(0, atmIdx - 8)
    const end = Math.min(strikes.length, atmIdx + 8)
    return strikes.slice(start, end)
  }, [strikes, spot, showITM])

  const callMap = useMemo(() => new Map(chain?.calls.map(c => [c.strike, c]) ?? []), [chain])
  const putMap = useMemo(() => new Map(chain?.puts.map(c => [c.strike, c]) ?? []), [chain])

  const TH = ({ children = null, k }: { children?: React.ReactNode; k?: SortKey }) => (
    <th
      onClick={k ? () => setSortKey(k) : undefined}
      className={`px-2 py-1.5 text-left text-secondary text-xs font-mono tracking-wider font-normal border-b border-border
        ${k ? 'cursor-pointer hover:text-primary' : ''}
        ${sortKey === k ? 'text-orange' : ''}
      `}
    >
      {children}
    </th>
  )

  return (
    <div className="flex flex-col h-full bg-bg overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-4 px-3 py-1.5 bg-surface border-b border-border shrink-0">
        <span className="panel-header text-orange font-bold text-xs tracking-widest">OPTIONS CHAIN</span>
        <span className="text-primary font-mono text-sm font-semibold">{symbol}</span>
        {spot > 0 && (
          <span className="text-secondary font-mono text-xs">SPOT <span className="text-primary">{spot.toFixed(2)}</span></span>
        )}
        <div className="flex gap-1 ml-2">
          {['chain', 'straddle'].map(v => (
            <button key={v} onClick={() => setView(v as typeof view)}
              className={`px-2 py-0.5 text-xs font-mono uppercase transition-colors
                ${view === v ? 'bg-orange text-bg font-bold' : 'text-secondary hover:text-primary'}`}>
              {v}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1 text-xs font-mono text-secondary cursor-pointer ml-auto">
          <input type="checkbox" checked={showITM} onChange={e => setShowITM(e.target.checked)} className="accent-orange" />
          NEAR ATM
        </label>
        <span className="text-secondary text-xs">F2</span>
      </div>

      {/* Expiry selector */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border bg-surface shrink-0 overflow-x-auto">
        <span className="text-secondary text-xs font-mono mr-2 shrink-0">EXPIRY:</span>
        {expirations.slice(0, 12).map(d => (
          <button key={d} onClick={() => selectExpiry(d)}
            className={`px-2 py-0.5 text-xs font-mono whitespace-nowrap transition-colors
              ${selectedExpiry === d ? 'text-orange border border-orange' : 'text-secondary border border-border hover:text-primary'}`}>
            {d}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {loading && (
          <div className="flex items-center justify-center h-32 text-secondary text-xs font-mono animate-pulse">
            [LOADING OPTIONS DATA...]
          </div>
        )}
        {error && (
          <div className="flex items-center justify-center h-32 text-red text-xs font-mono">
            [ERR: {error}]
          </div>
        )}
        {!loading && !error && chain && (
          <table className="w-full border-collapse" style={{ tableLayout: 'fixed' }}>
            <colgroup>
              {/* CALLS */}
              <col style={{ width: '5%' }} /><col style={{ width: '5%' }} />
              <col style={{ width: '5%' }} /><col style={{ width: '6%' }} />
              <col style={{ width: '6%' }} /><col style={{ width: '8%' }} />
              {/* STRIKE */}
              <col style={{ width: '8%' }} />
              {/* PUTS */}
              <col style={{ width: '5%' }} /><col style={{ width: '5%' }} />
              <col style={{ width: '5%' }} /><col style={{ width: '6%' }} />
              <col style={{ width: '6%' }} /><col style={{ width: '8%' }} />
              <col style={{ width: '5%' }} /><col style={{ width: '5%' }} />
              <col style={{ width: '5%' }} />
            </colgroup>
            <thead className="sticky top-0 z-10 bg-surface">
              {/* Section headers */}
              <tr className="border-b border-border">
                <th colSpan={6} className="px-2 py-1 text-center text-green text-xs font-mono tracking-widest border-r border-border">
                  CALLS
                </th>
                <th className="px-2 py-1 text-center text-orange text-xs font-mono">STRIKE</th>
                <th colSpan={9} className="px-2 py-1 text-center text-red text-xs font-mono tracking-widest border-l border-border">
                  PUTS
                </th>
              </tr>
              <tr>
                <TH>BID</TH><TH>ASK</TH><TH>LAST</TH>
                <TH k="volume">VOL</TH><TH k="openInterest">OI</TH><TH k="iv">IV</TH>
                <TH></TH>
                <TH>DELTA</TH><TH>GAMMA</TH><TH>THETA</TH>
                <TH k="volume">VOL</TH><TH k="openInterest">OI</TH><TH k="iv">IV</TH>
                <TH>LAST</TH><TH>ASK</TH><TH>BID</TH>
              </tr>
            </thead>
            <tbody>
              {filteredStrikes.map(strike => {
                const call = callMap.get(strike)
                const put = putMap.get(strike)
                const isAtm = Math.abs(strike - spot) / (spot || 1) < 0.01
                const callItm = spot > strike
                const putItm = spot < strike
                return (
                  <tr key={strike}
                    className={`border-b border-border text-xs font-mono hover:bg-surface2 transition-colors
                      ${isAtm ? 'ring-1 ring-orange ring-inset' : ''}`}
                  >
                    {/* Calls */}
                    <td className={`px-2 py-1 text-right ${callItm ? 'text-green' : 'text-secondary'}`}>{call ? fmt2(call.bid) : '—'}</td>
                    <td className={`px-2 py-1 text-right ${callItm ? 'text-green' : 'text-secondary'}`}>{call ? fmt2(call.ask) : '—'}</td>
                    <td className="px-2 py-1 text-right text-primary">{call ? fmt2(call.last) : '—'}</td>
                    <td className="px-2 py-1 text-right text-blue">{call ? fmtK(call.volume) : '—'}</td>
                    <td className="px-2 py-1 text-right text-secondary">{call ? fmtK(call.openInterest) : '—'}</td>
                    <td className="px-2 py-1 text-right">{call ? <IVBar iv={call.iv} /> : '—'}</td>
                    {/* Strike */}
                    <td className={`px-2 py-1 text-center font-bold text-sm border-x border-border
                      ${isAtm ? 'text-orange' : 'text-primary'}`}>
                      {strike.toFixed(0)}
                    </td>
                    {/* Puts — greeks shown on put side */}
                    <td className={`px-2 py-1 text-right text-xs ${put ? (put.delta < -0.5 ? 'text-red' : 'text-secondary') : ''}`}>
                      {put ? put.delta.toFixed(3) : '—'}
                    </td>
                    <td className="px-2 py-1 text-right text-secondary">{put ? put.gamma.toFixed(4) : '—'}</td>
                    <td className="px-2 py-1 text-right text-red">{put ? put.theta.toFixed(3) : '—'}</td>
                    <td className="px-2 py-1 text-right text-blue">{put ? fmtK(put.volume) : '—'}</td>
                    <td className="px-2 py-1 text-right text-secondary">{put ? fmtK(put.openInterest) : '—'}</td>
                    <td className="px-2 py-1 text-right">{put ? <IVBar iv={put.iv} /> : '—'}</td>
                    <td className="px-2 py-1 text-right text-primary">{put ? fmt2(put.last) : '—'}</td>
                    <td className={`px-2 py-1 text-right ${putItm ? 'text-red' : 'text-secondary'}`}>{put ? fmt2(put.ask) : '—'}</td>
                    <td className={`px-2 py-1 text-right ${putItm ? 'text-red' : 'text-secondary'}`}>{put ? fmt2(put.bid) : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
