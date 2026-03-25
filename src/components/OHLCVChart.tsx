import { useState, useMemo } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine
} from 'recharts'
import { useChart, type ChartRange } from '../hooks/useChart'
import { useQuotes } from '../hooks/useQuotes'

const RANGES: ChartRange[] = ['1D', '5D', '1M', '3M', '1Y', '5Y']

function fmtTime(iso: string, range: ChartRange): string {
  const d = new Date(iso)
  if (range === '1D' || range === '5D') {
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

interface TooltipPayload {
  payload?: {
    time: string; open: number; high: number; low: number; close: number; volume: number
  }
}

function CustomTooltip({ active, payload, range }: TooltipPayload & { active?: boolean; range: ChartRange }) {
  if (!active || !(payload as unknown as unknown[])?.length) return null
  const d = (payload as unknown as Array<{ payload: TooltipPayload['payload'] }>)[0]?.payload
  if (!d) return null
  return (
    <div className="bg-surface2 border border-border px-2 py-1.5 text-xs font-mono">
      <div className="text-secondary mb-1">{fmtTime(d.time ?? '', range)}</div>
      <div className="grid gap-x-3" style={{ gridTemplateColumns: 'auto auto' }}>
        <span className="text-secondary">O</span><span className="text-primary">{d.open?.toFixed(2)}</span>
        <span className="text-secondary">H</span><span className="text-green">{d.high?.toFixed(2)}</span>
        <span className="text-secondary">L</span><span className="text-red">{d.low?.toFixed(2)}</span>
        <span className="text-secondary">C</span><span className="text-primary">{d.close?.toFixed(2)}</span>
        <span className="text-secondary">V</span><span className="text-blue">{(d.volume / 1e6)?.toFixed(1)}M</span>
      </div>
    </div>
  )
}

interface OHLCVChartProps {
  symbol: string
  indicators?: {
    rsi?: boolean
    sma20?: boolean
    ema20?: boolean
    macd?: boolean
  }
  onIndicatorsChange?: (next: {
    rsi?: boolean
    sma20?: boolean
    ema20?: boolean
    macd?: boolean
  }) => void
}

function calcSMA(values: number[], period: number) {
  return values.map((_, i) => {
    if (i + 1 < period) return null
    const slice = values.slice(i + 1 - period, i + 1)
    const sum = slice.reduce((a, b) => a + b, 0)
    return sum / period
  })
}

function calcEMA(values: number[], period: number) {
  const k = 2 / (period + 1)
  const out: Array<number | null> = []
  let ema: number | null = null
  values.forEach((v, i) => {
    if (i + 1 < period) {
      out.push(null)
      return
    }
    if (ema == null) {
      const slice = values.slice(i + 1 - period, i + 1)
      ema = slice.reduce((a, b) => a + b, 0) / period
    } else {
      ema = v * k + ema * (1 - k)
    }
    out.push(ema)
  })
  return out
}

function calcRSI(values: number[], period = 14) {
  const out: Array<number | null> = new Array(values.length).fill(null)
  if (values.length < period + 1) return out
  let gains = 0
  let losses = 0
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1]
    if (diff >= 0) gains += diff
    else losses -= diff
  }
  let avgGain = gains / period
  let avgLoss = losses / period
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1]
    const gain = diff > 0 ? diff : 0
    const loss = diff < 0 ? -diff : 0
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  }
  return out
}

function calcMACD(values: number[]) {
  const ema12 = calcEMA(values, 12)
  const ema26 = calcEMA(values, 26)
  const macd = values.map((_, i) => {
    if (ema12[i] == null || ema26[i] == null) return null
    return (ema12[i] as number) - (ema26[i] as number)
  })
  const signal = calcEMA(macd.map(v => v ?? 0), 9)
  const hist = macd.map((m, i) => (m == null || signal[i] == null) ? null : (m - (signal[i] as number)))
  return { macd, signal, hist }
}

export function OHLCVChart({ symbol, indicators, onIndicatorsChange }: OHLCVChartProps) {
  const [range, setRange] = useState<ChartRange>('1D')
  const { bars, loading, error } = useChart(symbol, range)
  const { quotes } = useQuotes([symbol], 999999)
  const quote = quotes[0]

  const isUp = useMemo(() => {
    if (bars.length > 1) {
      const first = bars[0]?.close
      const last = bars[bars.length - 1]?.close
      if (first != null && last != null) return last >= first
    }
    return (quote?.changePct ?? 0) >= 0
  }, [bars, quote?.changePct])
  const lineColor = isUp ? '#00cc44' : '#ff3333'

  const ticks = useMemo(() => {
    if (bars.length === 0) return []
    const step = Math.max(1, Math.floor(bars.length / 6))
    return bars.filter((_, i) => i % step === 0).map(b => b.time)
  }, [bars])

  const derived = useMemo(() => {
    if (bars.length === 0) return []
    const closes = bars.map(b => b.close)
    const sma20 = indicators?.sma20 ? calcSMA(closes, 20) : []
    const ema20 = indicators?.ema20 ? calcEMA(closes, 20) : []
    const rsi = indicators?.rsi ? calcRSI(closes, 14) : []
    const macd = indicators?.macd ? calcMACD(closes) : null
    return bars.map((b, i) => ({
      ...b,
      sma20: sma20[i] ?? null,
      ema20: ema20[i] ?? null,
      rsi: rsi[i] ?? null,
      macd: macd ? macd.macd[i] : null,
      macdSignal: macd ? macd.signal[i] : null,
      macdHist: macd ? macd.hist[i] : null,
    }))
  }, [bars, indicators?.sma20, indicators?.ema20, indicators?.rsi, indicators?.macd])

  const priceMin = useMemo(() => bars.length ? Math.min(...bars.map(b => b.low)) * 0.999 : 0, [bars])
  const priceMax = useMemo(() => bars.length ? Math.max(...bars.map(b => b.high)) * 1.001 : 0, [bars])
  const volMax = useMemo(() => bars.length ? Math.max(...bars.map(b => b.volume)) * 4 : 0, [bars])

  return (
    <div className="flex flex-col h-full bg-bg relative">
      {/* Chart header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-surface">
        <div className="flex items-center gap-3">
          <span className="panel-header text-primary font-bold text-sm tracking-wide">
            {symbol}
          </span>
          {quote && (
            <>
              <span className={`font-mono text-sm font-bold ${isUp ? 'text-green' : 'text-red'}`}>
                {quote.last.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              <span className={`font-mono text-xs ${isUp ? 'text-green' : 'text-red'}`}>
                {isUp ? '+' : ''}{quote.change.toFixed(2)} ({isUp ? '+' : ''}{quote.changePct.toFixed(2)}%)
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-1">
          {RANGES.map(r => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-2 py-0.5 text-xs font-mono transition-colors
                ${range === r ? 'bg-orange text-bg font-bold' : 'text-secondary hover:text-primary'}`}
            >
              {r}
            </button>
          ))}
          <span className="ml-2 text-secondary text-xs">OHLCV · F2</span>
        </div>
      </div>

      {/* Chart body */}
      <div className="flex-1 relative">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-secondary text-xs font-mono animate-pulse">[LOADING...]</span>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-red text-xs font-mono">[ERR: {error}]</span>
          </div>
        )}
        {!loading && !error && bars.length > 0 && (
          <div className="h-full flex flex-col">
            <div className={`${(indicators?.rsi || indicators?.macd) ? 'h-[65%]' : 'h-full'}`}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={derived} margin={{ top: 8, right: 48, bottom: 4, left: 8 }}>
              <CartesianGrid stroke="#222222" strokeDasharray="0" vertical={false} />
              <XAxis
                dataKey="time"
                tickFormatter={t => fmtTime(t, range)}
                ticks={ticks}
                tick={{ fill: '#888888', fontSize: 10, fontFamily: 'JetBrains Mono' }}
                axisLine={{ stroke: '#222222' }}
                tickLine={false}
              />
              <YAxis
                yAxisId="price"
                orientation="right"
                domain={[priceMin, priceMax]}
                tick={{ fill: '#888888', fontSize: 10, fontFamily: 'JetBrains Mono' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={v => v.toFixed(0)}
                width={44}
              />
              <YAxis
                yAxisId="volume"
                orientation="left"
                domain={[0, volMax]}
                hide
              />
              <Tooltip content={<CustomTooltip range={range} />} />
              <Bar
                yAxisId="volume"
                dataKey="volume"
                fill="#333333"
                opacity={0.7}
                isAnimationActive={false}
              />
              <Line
                yAxisId="price"
                type="monotone"
                dataKey="close"
                stroke={lineColor}
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
              {indicators?.sma20 && (
                <Line yAxisId="price" type="monotone" dataKey="sma20" stroke="#ffaa00" strokeWidth={1} dot={false} isAnimationActive={false} />
              )}
              {indicators?.ema20 && (
                <Line yAxisId="price" type="monotone" dataKey="ema20" stroke="#00bcd4" strokeWidth={1} dot={false} isAnimationActive={false} />
              )}
              {quote && (
                <ReferenceLine
                  yAxisId="price"
                  y={quote.last}
                  stroke={lineColor}
                  strokeDasharray="3 3"
                  strokeOpacity={0.5}
                />
              )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            {(indicators?.rsi || indicators?.macd) && (
              <div className="h-[35%] border-t border-border flex flex-col">
                {indicators?.rsi && (
                  <div className={`${indicators?.macd ? 'h-1/2' : 'h-full'} relative`}>
                    <div className="absolute left-2 top-1 text-[10px] font-mono text-secondary">RSI (14)</div>
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={derived} margin={{ top: 6, right: 24, bottom: 4, left: 8 }}>
                        <CartesianGrid stroke="#1f2937" strokeDasharray="0" vertical={false} />
                        <XAxis dataKey="time" tick={false} axisLine={false} />
                        <YAxis
                          domain={[0, 100]}
                          ticks={[30, 70]}
                          tick={{ fill: '#9ca3af', fontSize: 9 }}
                          width={32}
                        />
                        <Tooltip
                          formatter={(v) => [`${Number(v).toFixed(2)}`, 'RSI']}
                          contentStyle={{ background: '#111111', border: '1px solid #333', fontFamily: 'JetBrains Mono', fontSize: 10 }}
                          labelFormatter={() => 'RSI'}
                        />
                        <Line yAxisId="rsi" type="monotone" dataKey="rsi" stroke="#e5e7eb" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                        <ReferenceLine y={70} stroke="#3b82f6" strokeDasharray="4 4" label={{ position: 'right', value: '70', fill: '#3b82f6', fontSize: 9 }} />
                        <ReferenceLine y={30} stroke="#ef4444" strokeDasharray="4 4" label={{ position: 'right', value: '30', fill: '#ef4444', fontSize: 9 }} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                )}
                {indicators?.macd && (
                  <div className={`${indicators?.rsi ? 'h-1/2 border-t border-border' : 'h-full'} relative`}>
                    <div className="absolute left-2 top-1 text-[10px] font-mono text-secondary">MACD (12,26,9)</div>
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={derived} margin={{ top: 6, right: 24, bottom: 4, left: 8 }}>
                        <CartesianGrid stroke="#1f2937" strokeDasharray="0" vertical={false} />
                        <XAxis dataKey="time" tick={false} axisLine={false} />
                        <YAxis tick={{ fill: '#9ca3af', fontSize: 9 }} width={32} />
                        <Tooltip
                          formatter={(v, name) => [`${Number(v).toFixed(2)}`, String(name).toUpperCase()]}
                          contentStyle={{ background: '#111111', border: '1px solid #333', fontFamily: 'JetBrains Mono', fontSize: 10 }}
                        />
                        <Bar dataKey="macdHist" fill="#444444" isAnimationActive={false} />
                        <Line type="monotone" dataKey="macd" stroke="#3b82f6" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                        <Line type="monotone" dataKey="macdSignal" stroke="#ef4444" strokeWidth={1.2} dot={false} isAnimationActive={false} />
                        <ReferenceLine y={0} stroke="#6b7280" strokeDasharray="4 4" />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {onIndicatorsChange && indicators && (
          <div className="absolute top-2 right-2">
            <button
              className="w-7 h-7 border border-border bg-surface/80 text-secondary hover:text-primary text-sm font-mono"
              onClick={(e) => {
                const btn = e.currentTarget
                const panel = btn.nextElementSibling as HTMLElement | null
                if (panel) panel.classList.toggle('hidden')
              }}
              title="Indicators"
            >
              ⚙
            </button>
            <div className="hidden mt-2 border border-border bg-surface/90 w-40">
              <div className="px-2 py-1 border-b border-border">
                <span className="text-secondary text-[10px] font-mono tracking-wider">INDICATORS</span>
              </div>
              <div className="p-2 space-y-1">
                {(['rsi', 'sma20', 'ema20', 'macd'] as const).map(key => (
                  <button
                    key={key}
                    className={`w-full text-left px-2 py-1 text-xs font-mono border transition-colors
                      ${indicators[key] ? 'text-orange border-orange' : 'text-secondary border-border hover:text-primary'}`}
                    onClick={() => onIndicatorsChange({ ...indicators, [key]: !indicators[key] })}
                  >
                    {indicators[key] ? '●' : '○'} {key.toUpperCase().replace('SMA20', 'SMA 20').replace('EMA20', 'EMA 20')}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
