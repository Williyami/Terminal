import { useState, useMemo } from 'react'
import { useOptionsFlow, type FlowItem } from '../hooks/useOptionsFlow'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell } from 'recharts'

const TAG_STYLE: Record<FlowItem['tag'], string> = {
  SWEEP:   'text-orange border border-orange',
  BLOCK:   'text-blue border border-blue',
  SPLIT:   'text-secondary border border-secondary',
  UNUSUAL: 'text-green border border-green',
}

const SENT_STYLE: Record<FlowItem['sentiment'], string> = {
  BULLISH: 'text-green',
  BEARISH: 'text-red',
}

function fmtPremium(v: number): string {
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`
  return `$${v}`
}

function PCRGauge({ ratio }: { ratio: number }) {
  const pct = Math.min(100, (ratio / 2) * 100)
  const color = ratio > 1.2 ? '#ff3333' : ratio < 0.8 ? '#00cc44' : '#ff6600'
  const label = ratio > 1.2 ? 'BEARISH' : ratio < 0.8 ? 'BULLISH' : 'NEUTRAL'
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-xs font-mono text-secondary">
        <span>PUT/CALL RATIO</span>
        <span className="font-bold" style={{ color }}>{ratio.toFixed(2)} — {label}</span>
      </div>
      <div className="h-2 bg-border w-full">
        <div className="h-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <div className="flex justify-between text-xs font-mono text-secondary">
        <span>0.0 BULLISH</span>
        <span>1.0 NEUTRAL</span>
        <span>2.0 BEARISH</span>
      </div>
    </div>
  )
}

function SentimentBar({ flow }: { flow: FlowItem[] }) {
  const bullPremium = flow.filter(f => f.sentiment === 'BULLISH').reduce((s, f) => s + f.premium, 0)
  const bearPremium = flow.filter(f => f.sentiment === 'BEARISH').reduce((s, f) => s + f.premium, 0)
  const total = bullPremium + bearPremium
  const bullPct = total > 0 ? (bullPremium / total) * 100 : 50

  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-xs font-mono">
        <span className="text-green">BULL {fmtPremium(bullPremium)} ({bullPct.toFixed(0)}%)</span>
        <span className="text-secondary">PREMIUM FLOW SENTIMENT</span>
        <span className="text-red">BEAR {fmtPremium(bearPremium)} ({(100 - bullPct).toFixed(0)}%)</span>
      </div>
      <div className="h-3 flex">
        <div className="h-full bg-green" style={{ width: `${bullPct}%` }} />
        <div className="h-full bg-red flex-1" />
      </div>
    </div>
  )
}

function SymbolBreakdown({ flow }: { flow: FlowItem[] }) {
  const bySymbol = useMemo(() => {
    const map = new Map<string, number>()
    for (const f of flow) map.set(f.symbol, (map.get(f.symbol) ?? 0) + f.premium)
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([sym, prem]) => ({ sym, prem }))
  }, [flow])

  return (
    <ResponsiveContainer width="100%" height={120}>
      <BarChart data={bySymbol} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
        <XAxis dataKey="sym" tick={{ fill: '#888', fontSize: 10, fontFamily: 'JetBrains Mono' }} axisLine={false} tickLine={false} />
        <YAxis hide />
        <Tooltip
          formatter={(v) => [fmtPremium(Number(v)), 'PREMIUM']}
          contentStyle={{ background: '#1a1a1a', border: '1px solid #222', fontFamily: 'JetBrains Mono', fontSize: 10 }}
          labelStyle={{ color: '#e8e8e8' }}
        />
        <Bar dataKey="prem" isAnimationActive={false}>
          {bySymbol.map((_, i) => <Cell key={i} fill="#ff6600" fillOpacity={1 - i * 0.08} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

export function FlowPage() {
  const { flow, loading, error, putCallRatio, totalPremium, refetch } = useOptionsFlow(60000)
  const [filter, setFilter] = useState<'ALL' | 'SWEEP' | 'BLOCK' | 'UNUSUAL' | 'BULLISH' | 'BEARISH'>('ALL')
  const [minPremium, setMinPremium] = useState(0)

  const filtered = useMemo(() => flow.filter(f => {
    if (filter === 'BULLISH') return f.sentiment === 'BULLISH'
    if (filter === 'BEARISH') return f.sentiment === 'BEARISH'
    if (filter !== 'ALL') return f.tag === filter
    return f.premium >= minPremium * 1000
  }), [flow, filter, minPremium])

  const sweepCount = flow.filter(f => f.tag === 'SWEEP').length
  const blockCount = flow.filter(f => f.tag === 'BLOCK').length

  return (
    <div className="flex flex-col h-full bg-bg overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-4 px-3 py-1.5 bg-surface border-b border-border shrink-0">
        <span className="panel-header text-orange font-bold text-xs tracking-widest">OPTIONS FLOW</span>
        <span className="text-secondary text-xs font-mono">UNUSUAL ACTIVITY DETECTOR</span>
        <button onClick={refetch} className="ml-auto text-secondary text-xs font-mono hover:text-primary border border-border px-2 py-0.5">
          [REFRESH]
        </button>
        <span className="text-secondary text-xs">F4</span>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-0 border-b border-border shrink-0">
        {[
          { label: 'TOTAL PREMIUM', value: fmtPremium(totalPremium), color: 'text-orange' },
          { label: 'PUT/CALL RATIO', value: putCallRatio.toFixed(2), color: putCallRatio > 1 ? 'text-red' : 'text-green' },
          { label: 'SWEEPS TODAY', value: String(sweepCount), color: 'text-orange' },
          { label: 'BLOCKS TODAY', value: String(blockCount), color: 'text-blue' },
        ].map(s => (
          <div key={s.label} className="px-3 py-2 border-r border-border">
            <div className="text-secondary text-xs font-mono mb-0.5">{s.label}</div>
            <div className={`font-mono font-bold text-base ${s.color}`}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-2 gap-0 border-b border-border shrink-0" style={{ height: '160px' }}>
        <div className="px-3 pt-2 pb-1 border-r border-border flex flex-col gap-2">
          <PCRGauge ratio={putCallRatio} />
          <SentimentBar flow={flow} />
        </div>
        <div className="px-2 pt-1">
          <div className="text-secondary text-xs font-mono mb-1 px-2">PREMIUM BY SYMBOL</div>
          <SymbolBreakdown flow={flow} />
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-surface shrink-0">
        <span className="text-secondary text-xs font-mono">FILTER:</span>
        {(['ALL', 'SWEEP', 'BLOCK', 'UNUSUAL', 'BULLISH', 'BEARISH'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-2 py-0.5 text-xs font-mono transition-colors
              ${filter === f ? 'text-orange border border-orange' : 'text-secondary border border-border hover:text-primary'}`}>
            {f}
          </button>
        ))}
        <span className="text-secondary text-xs font-mono ml-4">MIN $</span>
        <select value={minPremium} onChange={e => setMinPremium(Number(e.target.value))}
          className="bg-surface2 border border-border text-primary text-xs font-mono px-1 py-0.5">
          {[0, 100, 250, 500, 1000].map(v => (
            <option key={v} value={v}>{v === 0 ? 'ALL' : `${v}K+`}</option>
          ))}
        </select>
        <span className="ml-auto text-secondary text-xs font-mono">{filtered.length} CONTRACTS</span>
      </div>

      {/* Flow table */}
      <div className="flex-1 overflow-auto">
        {loading && (
          <div className="flex items-center justify-center h-32 text-secondary text-xs font-mono animate-pulse">
            [LOADING FLOW DATA...]
          </div>
        )}
        {error && <div className="px-3 py-2 text-red text-xs font-mono">[ERR: {error}]</div>}
        {!loading && (
          <table className="w-full border-collapse">
            <thead className="sticky top-0 z-10 bg-surface">
              <tr className="border-b border-border">
                {['TIME', 'SYM', 'EXP', 'STRIKE', 'TYPE', 'SIDE', 'SIZE', 'PREMIUM', 'IV%', 'SPOT', 'TAG', 'SENT'].map(h => (
                  <th key={h} className="px-2 py-1.5 text-left text-secondary text-xs font-mono tracking-wider font-normal">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(f => (
                <tr key={f.id} className="border-b border-border hover:bg-surface2 transition-colors">
                  <td className="px-2 py-1 text-xs font-mono text-secondary">{f.time}</td>
                  <td className="px-2 py-1 text-xs font-mono font-bold text-primary">{f.symbol}</td>
                  <td className="px-2 py-1 text-xs font-mono text-secondary">{f.expiry}</td>
                  <td className="px-2 py-1 text-xs font-mono text-primary">{f.strike.toFixed(0)}</td>
                  <td className={`px-2 py-1 text-xs font-mono font-bold ${f.type === 'CALL' ? 'text-green' : 'text-red'}`}>
                    {f.type}
                  </td>
                  <td className={`px-2 py-1 text-xs font-mono font-bold ${f.side === 'BUY' ? 'text-green' : 'text-red'}`}>
                    {f.side}
                  </td>
                  <td className="px-2 py-1 text-xs font-mono text-primary">{f.size.toLocaleString()}</td>
                  <td className="px-2 py-1 text-xs font-mono font-semibold text-orange">{fmtPremium(f.premium)}</td>
                  <td className="px-2 py-1 text-xs font-mono text-secondary">{f.iv.toFixed(1)}</td>
                  <td className="px-2 py-1 text-xs font-mono text-secondary">{f.spot.toFixed(2)}</td>
                  <td className="px-2 py-1">
                    <span className={`text-xs font-mono px-1 ${TAG_STYLE[f.tag]}`}>{f.tag}</span>
                  </td>
                  <td className={`px-2 py-1 text-xs font-mono font-bold ${SENT_STYLE[f.sentiment]}`}>
                    {f.sentiment === 'BULLISH' ? '▲' : '▼'} {f.sentiment}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
