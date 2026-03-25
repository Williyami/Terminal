import { useMacro } from '../hooks/useMacro'
import { useWorldMarkets } from '../hooks/useWorldMarkets'
import { WorldMap } from './WorldMap'
import { useWorldClock } from '../hooks/useWorldClock'

const YIELD_LABELS = ['3M', '5Y', '10Y', '30Y']

function fmt(v: number | null, decimals = 2): string {
  if (v == null) return '---'
  return v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function pctColor(pct: number, flip = false) {
  const pos = pct >= 0
  return (pos !== flip) ? 'text-green' : 'text-red'
}

function PctBadge({ pct, flip = false }: { pct: number; flip?: boolean }) {
  return (
    <span className={`text-xs font-mono ${pctColor(pct, flip)}`}>
      {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
    </span>
  )
}

const REGIONS = ['Americas', 'Europe', 'Asia', 'MENA', 'Africa'] as const

interface Props { compact?: boolean }

export function MacroPanel({ compact = false }: Props) {
  const { data, loading: ratesLoading } = useMacro(60000)
  const { markets, loading: marketsLoading } = useWorldMarkets(60000)
  const clocks = useWorldClock(60000)

  const get = (label: string) => data.find(d => d.label === label)
  const yieldItems = YIELD_LABELS.map(l => get(l))
  const vix = get('VIX')
  const dxy = get('DXY')
  const spx = get('SPX')
  const ndx = get('NDX')

  return (
    <div className="flex flex-col h-full bg-surface">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border shrink-0">
        <span className="panel-header text-orange font-bold text-xs tracking-widest">MACRO</span>
        {!compact && <span className="text-secondary text-xs">F3</span>}
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* ── World Map ─────────────────────────────────────── */}
        <div className={`border-b border-border ${compact ? '' : 'px-1 py-1'}`}>
          <WorldMap markets={markets} compact={compact} loading={marketsLoading} />
        </div>

        <div className={`space-y-3 ${compact ? 'p-2' : 'p-3'}`}>

          {/* ── US Indices ─────────────────────────────────── */}
          <section>
            <div className="text-secondary text-xs font-mono mb-1.5 tracking-wider">US INDICES</div>
            <div className="space-y-0.5">
              {[spx, ndx].map((m, i) => !m ? null : (
                <div key={i} className="flex items-center justify-between gap-1">
                  <span className="text-secondary text-xs font-mono w-8 shrink-0">{m.label}</span>
                  <span className={`text-xs font-mono font-semibold flex-1 text-right ${(m.changePct ?? 0) >= 0 ? 'text-green' : 'text-red'}`}>
                    {fmt(m.value)}
                  </span>
                  <PctBadge pct={m.changePct ?? 0} />
                </div>
              ))}
            </div>
          </section>

          {/* ── Global Markets ──────────────────────────────── */}
          {REGIONS.map(region => {
            const regionMarkets = markets.filter(m => m.region === region && m.value !== null)
            if (regionMarkets.length === 0) return null
            return (
              <section key={region}>
                <div className="text-secondary text-xs font-mono mb-1.5 tracking-wider">{region.toUpperCase()}</div>
                <div className="space-y-0.5">
                  {regionMarkets.map(m => (
                    <div key={m.symbol} className="flex items-center justify-between gap-1">
                      <span className="text-secondary text-xs font-mono shrink-0" style={{ width: compact ? 36 : 44 }}>
                        {m.label}
                      </span>
                      {!compact && (
                        <span className={`text-xs font-mono flex-1 text-right ${m.changePct >= 0 ? 'text-green' : 'text-red'}`}>
                          {fmt(m.value)}
                        </span>
                      )}
                      <PctBadge pct={m.changePct} />
                    </div>
                  ))}
                </div>
              </section>
            )
          })}

          {/* ── VIX / DXY ───────────────────────────────────── */}
          <section>
            <div className="text-secondary text-xs font-mono mb-1.5 tracking-wider">VOL / FX</div>
            <div className="space-y-0.5">
              {[vix, dxy].map((m, i) => !m ? null : (
                <div key={i} className="flex items-center justify-between gap-1">
                  <span className="text-secondary text-xs font-mono w-8 shrink-0">{m.label}</span>
                  <span className={`text-xs font-mono font-semibold flex-1 text-right ${pctColor(m.changePct ?? 0, m.label === 'VIX')}`}>
                    {fmt(m.value)}
                  </span>
                  <PctBadge pct={m.changePct ?? 0} flip={m.label === 'VIX'} />
                </div>
              ))}
            </div>
          </section>

          {/* ── Yield Curve ─────────────────────────────────── */}
          <section>
            <div className="text-secondary text-xs font-mono mb-1.5 tracking-wider">YIELD CURVE</div>
            <div className="space-y-0.5">
              {yieldItems.map((m, i) => !m ? null : (
                <div key={i} className="flex items-center justify-between gap-1">
                  <span className="text-secondary text-xs font-mono w-8 shrink-0">{m.label}</span>
                  <span className="text-primary text-xs font-mono font-semibold flex-1 text-right">
                    {fmt(m.value, 3)}%
                  </span>
                  <span className={`text-xs font-mono ${(m.change ?? 0) >= 0 ? 'text-red' : 'text-green'}`}>
                    {(m.change ?? 0) >= 0 ? '+' : ''}{(m.change ?? 0).toFixed(1)}bp
                  </span>
                </div>
              ))}
            </div>
            {/* Sparkline bars */}
            <div className="mt-2 flex items-end gap-1 h-10 border-b border-border">
              {yieldItems.map((m, i) => {
                const pct = m?.value ? Math.min(100, (m.value / 6) * 100) : 0
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                    <div className="w-full bg-orange opacity-70" style={{ height: `${pct}%`, minHeight: 2 }} />
                    <span className="text-secondary font-mono" style={{ fontSize: 8 }}>{m?.label}</span>
                  </div>
                )
              })}
            </div>
          </section>

          {compact && (
            <section>
              <div className="text-secondary text-xs font-mono mb-1.5 tracking-wider">WORLD CLOCK</div>
              <div className="space-y-1">
                {clocks.map(c => (
                  <div key={c.label} className="flex items-center justify-between text-xs font-mono">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${c.isOpen ? 'bg-green' : 'bg-red'}`} />
                      <span className="text-secondary">{c.label}</span>
                    </div>
                    <span className="text-primary">{c.time}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

        </div>
      </div>
    </div>
  )
}
