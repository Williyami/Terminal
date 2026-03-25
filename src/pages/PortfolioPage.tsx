import { useState, useRef } from 'react'
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, AreaChart, Area, XAxis, YAxis, CartesianGrid } from 'recharts'
import { usePortfolio } from '../hooks/usePortfolio'
import { useAvanzaImport } from '../hooks/useAvanzaImport'
import type { ImportResult } from '../utils/avanzaParser'

const COLORS = ['#ff6600', '#00cc44', '#4488ff', '#ff3333', '#ffcc00', '#cc44ff', '#00cccc', '#ff6699']

function fmt$(v: number, dec = 2): string {
  const abs = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`
  return `${sign}$${abs.toFixed(dec)}`
}

function plColor(v: number) { return v >= 0 ? 'text-green' : 'text-red' }
function plSign(v: number) { return v >= 0 ? '+' : '' }

interface AddPositionFormProps {
  onAdd: (sym: string, qty: number, cost: number) => void
  onClose: () => void
}

function AddPositionForm({ onAdd, onClose }: AddPositionFormProps) {
  const [sym, setSym] = useState('')
  const [qty, setQty] = useState('')
  const [cost, setCost] = useState('')

  const submit = () => {
    const q = parseFloat(qty)
    const c = parseFloat(cost)
    if (sym && q > 0 && c > 0) {
      onAdd(sym.toUpperCase().trim(), q, c)
      onClose()
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50">
      <div className="bg-surface border border-border p-4 font-mono text-xs w-72">
        <div className="panel-header text-orange font-bold mb-3">ADD POSITION</div>
        <div className="space-y-2">
          {[
            { label: 'SYMBOL', value: sym, set: setSym, ph: 'NVDA' },
            { label: 'QUANTITY', value: qty, set: setQty, ph: '100' },
            { label: 'AVG COST', value: cost, set: setCost, ph: '620.00' },
          ].map(f => (
            <div key={f.label} className="flex items-center gap-2">
              <label className="text-secondary w-20 shrink-0">{f.label}</label>
              <input value={f.value} onChange={e => f.set(e.target.value)}
                placeholder={f.ph}
                className="flex-1 bg-bg border border-border text-primary px-2 py-1 font-mono text-xs focus:outline-none focus:border-orange"
              />
            </div>
          ))}
        </div>
        <div className="flex gap-2 mt-3">
          <button onClick={submit} className="flex-1 bg-orange text-bg font-bold py-1 text-xs">ADD</button>
          <button onClick={onClose} className="flex-1 border border-border text-secondary py-1 text-xs hover:text-primary">CANCEL</button>
        </div>
      </div>
    </div>
  )
}

function fmtCurrency(v: number, cur = 'SEK') {
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(2)}M ${cur}`
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(1)}K ${cur}`
  return `${v.toFixed(0)} ${cur}`
}

interface ImportPreviewProps {
  result: ImportResult
  fileName: string
  onApply: () => void
  onClose: () => void
}

function ImportPreview({ result, fileName, onApply, onClose }: ImportPreviewProps) {
  const cashEntries = Object.entries(result.cashByCurrency)
  return (
    <div className="fixed inset-0 bg-black bg-opacity-80 flex items-start justify-center z-50 overflow-auto py-8">
      <div className="bg-surface border border-border font-mono text-xs w-full max-w-3xl mx-4">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-surface2">
          <span className="text-orange font-bold tracking-widest">IMPORT PREVIEW</span>
          <span className="text-secondary">{fileName}</span>
          <span className="text-secondary ml-auto">{result.transactions.length} TRANSACTIONS</span>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 border-b border-border">
          <div className="px-4 py-2 border-r border-border">
            <div className="text-secondary mb-0.5">OPEN POSITIONS</div>
            <div className="text-primary font-bold text-base">{result.positions.length}</div>
          </div>
          <div className="px-4 py-2 border-r border-border">
            <div className="text-secondary mb-0.5">TOTAL DIVIDENDS</div>
            <div className="text-green font-bold text-base">{fmtCurrency(result.totalDividends)}</div>
          </div>
          <div className="px-4 py-2">
            <div className="text-secondary mb-0.5">CASH BALANCES</div>
            <div className="text-blue font-bold text-sm">
              {cashEntries.length === 0
                ? '—'
                : cashEntries.map(([cur, amt]) => `${fmtCurrency(amt, cur)}`).join('  ')}
            </div>
          </div>
        </div>

        {/* Positions table */}
        <div className="overflow-auto max-h-96">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 bg-surface2">
              <tr className="border-b border-border">
                {['SYMBOL', 'NAME', 'QTY', 'AVG COST', 'TOTAL COST', 'CURRENCY', 'REALIZED P&L'].map(h => (
                  <th key={h} className="px-3 py-1.5 text-left text-secondary text-xs font-mono font-normal tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.positions.map(p => (
                <tr key={p.isin} className="border-b border-border hover:bg-surface2 transition-colors">
                  <td className="px-3 py-1.5 text-primary font-bold">{p.symbol}</td>
                  <td className="px-3 py-1.5 text-secondary max-w-[180px] truncate" title={p.name}>{p.name}</td>
                  <td className="px-3 py-1.5 text-primary">{p.qty % 1 === 0 ? p.qty.toFixed(0) : p.qty.toFixed(4)}</td>
                  <td className="px-3 py-1.5 text-secondary">{p.avgCost.toFixed(2)}</td>
                  <td className="px-3 py-1.5 text-primary">{fmtCurrency(p.totalCost, p.currency)}</td>
                  <td className="px-3 py-1.5 text-secondary">{p.instrumentCurrency || p.currency}</td>
                  <td className={`px-3 py-1.5 font-semibold ${p.realizedPL >= 0 ? 'text-green' : 'text-red'}`}>
                    {p.realizedPL >= 0 ? '+' : ''}{fmtCurrency(p.realizedPL, p.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Warning */}
        <div className="px-4 py-2 border-t border-border text-secondary text-xs">
          NOTE: Symbols are best-effort. Verify tickers before use. Prices will be fetched from Yahoo Finance using the symbol column.
        </div>

        {/* Actions */}
        <div className="flex gap-2 px-4 py-3 border-t border-border">
          <button onClick={onApply}
            className="flex-1 bg-orange text-bg font-bold py-1.5 text-xs tracking-widest hover:bg-orange-dim transition-colors">
            APPLY TO PORTFOLIO
          </button>
          <button onClick={onClose}
            className="flex-1 border border-border text-secondary py-1.5 text-xs hover:text-primary transition-colors">
            CANCEL
          </button>
        </div>
      </div>
    </div>
  )
}

export function PortfolioPage() {
  const { positions, summary, loading, error, updateHolding, addHolding } = usePortfolio()
  const [showAdd, setShowAdd] = useState(false)
  const { state: importState, result: importResult, error: importError, fileName, importFile, reset: resetImport } = useAvanzaImport()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) importFile(file)
    // Reset input so same file can be re-imported
    e.target.value = ''
  }

  const applyImport = () => {
    if (!importResult) return
    for (const p of importResult.positions) {
      addHolding(p.symbol, p.qty, p.avgCost)
    }
    resetImport()
  }

  // Mock P&L history for chart (7 days)
  const plHistory = [
    { day: 'MON', value: -1200 }, { day: 'TUE', value: 2400 },
    { day: 'WED', value: 1800 }, { day: 'THU', value: -800 },
    { day: 'FRI', value: 3200 }, { day: 'SAT', value: 3200 },
    { day: 'SUN', value: summary?.totalDayPL ?? 0 },
  ]

  const allocationData = positions.map((p, i) => ({
    name: p.symbol, value: p.weight, fill: COLORS[i % COLORS.length]
  }))

  return (
    <div className="flex flex-col h-full bg-bg overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-4 px-3 py-1.5 bg-surface border-b border-border shrink-0">
        <span className="panel-header text-orange font-bold text-xs tracking-widest">PORTFOLIO</span>
        <span className="text-secondary text-xs font-mono">PAPER TRADING</span>
        <div className="flex items-center gap-2 ml-auto">
          <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleFileChange} />
          {importState === 'parsing' && (
            <span className="text-secondary text-xs font-mono animate-pulse">[PARSING...]</span>
          )}
          {importState === 'error' && (
            <span className="text-red text-xs font-mono">[ERR: {importError}]</span>
          )}
          <button onClick={() => fileInputRef.current?.click()}
            className="border border-blue text-blue text-xs font-mono px-2 py-0.5 hover:bg-blue hover:text-bg transition-colors">
            [IMPORT CSV]
          </button>
          <button onClick={() => setShowAdd(true)}
            className="border border-orange text-orange text-xs font-mono px-2 py-0.5 hover:bg-orange hover:text-bg transition-colors">
            [+ POSITION]
          </button>
        </div>
        <span className="text-secondary text-xs">F6</span>
      </div>

      {loading && (
        <div className="flex items-center justify-center flex-1 text-secondary text-xs font-mono animate-pulse">
          [LOADING PORTFOLIO...]
        </div>
      )}
      {error && <div className="px-3 py-2 text-red text-xs font-mono">[ERR: {error}]</div>}

      {!loading && summary && (
        <>
          {/* Summary strip */}
          <div className="grid grid-cols-6 border-b border-border shrink-0">
            {[
              { label: 'TOTAL VALUE',   value: fmt$(summary.totalValue),             color: 'text-primary' },
              { label: 'UNREALIZED P&L', value: `${plSign(summary.totalUnrealizedPL)}${fmt$(summary.totalUnrealizedPL)}`, color: plColor(summary.totalUnrealizedPL) },
              { label: 'TOTAL RETURN',  value: `${plSign(summary.totalUnrealizedPLPct)}${summary.totalUnrealizedPLPct.toFixed(2)}%`, color: plColor(summary.totalUnrealizedPLPct) },
              { label: "TODAY'S P&L",   value: `${plSign(summary.totalDayPL)}${fmt$(summary.totalDayPL)}`, color: plColor(summary.totalDayPL) },
              { label: 'CASH',          value: fmt$(summary.cashBalance),             color: 'text-blue' },
              { label: 'BUYING POWER',  value: fmt$(summary.buyingPower),             color: 'text-blue' },
            ].map(s => (
              <div key={s.label} className="px-3 py-2 border-r border-border last:border-r-0">
                <div className="text-secondary text-xs font-mono mb-0.5">{s.label}</div>
                <div className={`font-mono font-bold ${s.color}`}>{s.value}</div>
              </div>
            ))}
          </div>

          {/* Charts + positions */}
          <div className="flex flex-1 overflow-hidden">
            {/* Left: positions table */}
            <div className="flex-1 flex flex-col overflow-hidden border-r border-border">
              <table className="w-full border-collapse">
                <thead className="sticky top-0 bg-surface z-10">
                  <tr className="border-b border-border">
                    {['SYMBOL', 'QTY', 'AVG COST', 'LAST', 'MKT VALUE', 'UNREAL P&L', '%', "DAY P&L", "DAY%", 'WEIGHT', ''].map(h => (
                      <th key={h} className="px-2 py-1.5 text-left text-secondary text-xs font-mono tracking-wider font-normal">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {positions.map(p => (
                    <tr key={p.symbol} className="border-b border-border hover:bg-surface2 transition-colors">
                      <td className="px-2 py-1.5 text-xs font-mono font-bold text-primary">{p.symbol}</td>
                      <td className="px-2 py-1.5 text-xs font-mono text-secondary">{p.qty}</td>
                      <td className="px-2 py-1.5 text-xs font-mono text-secondary">{fmt$(p.avgCost)}</td>
                      <td className="px-2 py-1.5 text-xs font-mono text-primary">{fmt$(p.currentPrice)}</td>
                      <td className="px-2 py-1.5 text-xs font-mono text-primary">{fmt$(p.marketValue)}</td>
                      <td className={`px-2 py-1.5 text-xs font-mono font-semibold ${plColor(p.unrealizedPL)}`}>
                        {plSign(p.unrealizedPL)}{fmt$(p.unrealizedPL)}
                      </td>
                      <td className={`px-2 py-1.5 text-xs font-mono ${plColor(p.unrealizedPLPct)}`}>
                        {plSign(p.unrealizedPLPct)}{p.unrealizedPLPct.toFixed(2)}%
                      </td>
                      <td className={`px-2 py-1.5 text-xs font-mono ${plColor(p.dayPL)}`}>
                        {plSign(p.dayPL)}{fmt$(p.dayPL)}
                      </td>
                      <td className={`px-2 py-1.5 text-xs font-mono ${plColor(p.dayPLPct)}`}>
                        {plSign(p.dayPLPct)}{p.dayPLPct.toFixed(2)}%
                      </td>
                      <td className="px-2 py-1.5 text-xs font-mono">
                        <div className="flex items-center gap-1">
                          <div className="h-1.5 bg-orange" style={{ width: `${p.weight}px`, maxWidth: 60, minWidth: 2 }} />
                          <span className="text-secondary">{p.weight.toFixed(1)}%</span>
                        </div>
                      </td>
                      <td className="px-2 py-1.5">
                        <button onClick={() => updateHolding(p.symbol, 0, 0)}
                          className="text-secondary text-xs font-mono hover:text-red">✕</button>
                      </td>
                    </tr>
                  ))}
                  {/* Cash row */}
                  <tr className="border-b border-border bg-surface">
                    <td className="px-2 py-1.5 text-xs font-mono text-blue font-bold">CASH</td>
                    <td className="px-2 py-1.5 text-xs font-mono text-secondary">—</td>
                    <td className="px-2 py-1.5 text-xs font-mono text-secondary">—</td>
                    <td className="px-2 py-1.5 text-xs font-mono text-secondary">—</td>
                    <td className="px-2 py-1.5 text-xs font-mono text-blue">{fmt$(summary.cashBalance)}</td>
                    <td colSpan={5} />
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Right: charts */}
            <div className="flex flex-col gap-0" style={{ width: '260px', minWidth: '260px' }}>
              {/* Allocation pie */}
              <div className="border-b border-border p-2">
                <div className="text-secondary text-xs font-mono mb-1">ALLOCATION</div>
                <ResponsiveContainer width="100%" height={140}>
                  <PieChart>
                    <Pie data={allocationData} dataKey="value" nameKey="name"
                      cx="50%" cy="50%" innerRadius={35} outerRadius={60}
                      isAnimationActive={false}
                    >
                      {allocationData.map((d, i) => <Cell key={i} fill={d.fill} stroke="none" />)}
                    </Pie>
                    <Tooltip
                      formatter={(v) => [`${Number(v).toFixed(1)}%`, 'WEIGHT']}
                      contentStyle={{ background: '#1a1a1a', border: '1px solid #222', fontFamily: 'JetBrains Mono', fontSize: 10 }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                {/* Legend */}
                <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 mt-1">
                  {allocationData.map(d => (
                    <div key={d.name} className="flex items-center gap-1 text-xs font-mono">
                      <div className="w-2 h-2 shrink-0" style={{ backgroundColor: d.fill }} />
                      <span className="text-secondary">{d.name}</span>
                      <span className="text-primary ml-auto">{d.value.toFixed(1)}%</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Weekly P&L */}
              <div className="p-2 flex-1">
                <div className="text-secondary text-xs font-mono mb-1">WEEKLY P&L</div>
                <ResponsiveContainer width="100%" height={100}>
                  <AreaChart data={plHistory} margin={{ top: 4, right: 4, bottom: 4, left: 0 }}>
                    <CartesianGrid stroke="#222" vertical={false} />
                    <XAxis dataKey="day" tick={{ fill: '#888', fontSize: 9, fontFamily: 'JetBrains Mono' }} axisLine={false} tickLine={false} />
                    <YAxis hide />
                    <Tooltip
                      formatter={(v) => [fmt$(Number(v)), "P&L"]}
                      contentStyle={{ background: '#1a1a1a', border: '1px solid #222', fontFamily: 'JetBrains Mono', fontSize: 10 }}
                    />
                    <Area type="monotone" dataKey="value" stroke="#ff6600" fill="#ff660022" strokeWidth={1.5} isAnimationActive={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </>
      )}

      {showAdd && (
        <AddPositionForm onAdd={addHolding} onClose={() => setShowAdd(false)} />
      )}
      {importState === 'done' && importResult && (
        <ImportPreview
          result={importResult}
          fileName={fileName}
          onApply={applyImport}
          onClose={resetImport}
        />
      )}
    </div>
  )
}
