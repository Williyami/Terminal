import { useState, useEffect, useCallback } from 'react'
import type { OHLCVBar } from '../types'
import { resolveSymbol, fetchDailyBars } from '../utils/borsdata'


const INTERVALS: Record<string, { range: string; interval: string }> = {
  '1D':  { range: '1d',  interval: '5m'  },
  '5D':  { range: '5d',  interval: '15m' },
  '1M':  { range: '1mo', interval: '60m' },
  '3M':  { range: '3mo', interval: '1d'  },
  '1Y':  { range: '1y',  interval: '1d'  },
  '5Y':  { range: '5y',  interval: '1wk' },
}

export type ChartRange = keyof typeof INTERVALS

/**
 * Börsdata is end-of-day only, so it can serve the ranges Yahoo draws from
 * daily or weekly bars. The short ranges stay on Yahoo because they need
 * intraday granularity that Börsdata does not publish.
 */
const BD_LOOKBACK_DAYS: Partial<Record<ChartRange, number>> = {
  '3M': 93,
  '1Y': 366,
  '5Y': 1827,
}

/** Collapse daily bars into weekly ones so 5Y stays readable. */
function toWeekly(bars: OHLCVBar[]): OHLCVBar[] {
  const weeks = new Map<string, OHLCVBar>()
  for (const bar of bars) {
    const d = new Date(bar.time)
    // Monday of this bar's ISO week
    const monday = new Date(d)
    monday.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
    const key = monday.toISOString().slice(0, 10)

    const acc = weeks.get(key)
    if (!acc) {
      weeks.set(key, { ...bar, time: monday.toISOString() })
    } else {
      acc.high = Math.max(acc.high, bar.high)
      acc.low = Math.min(acc.low, bar.low)
      acc.close = bar.close
      acc.volume += bar.volume
    }
  }
  return [...weeks.values()]
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
}

async function fetchFromBorsdata(symbol: string, range: ChartRange): Promise<OHLCVBar[] | null> {
  const days = BD_LOOKBACK_DAYS[range]
  if (days == null) return null
  const inst = await resolveSymbol(symbol)
  if (!inst) return null
  const bars = await fetchDailyBars(inst.insId, { from: isoDaysAgo(days) })
  if (bars.length === 0) return null
  return range === '5Y' ? toWeekly(bars) : bars
}

async function fetchFromYahoo(symbol: string, range: ChartRange): Promise<OHLCVBar[]> {
  const { range: r, interval } = INTERVALS[range]
  const url = `/yf/q1/v8/finance/chart/${symbol}?range=${r}&interval=${interval}&includePrePost=false`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = await res.json()
  const result = json?.chart?.result?.[0]
  if (!result) throw new Error('no data')
  const timestamps: number[] = result.timestamp ?? []
  const q = result.indicators?.quote?.[0] ?? {}
  const opens: number[] = q.open ?? []
  const highs: number[] = q.high ?? []
  const lows: number[] = q.low ?? []
  const closes: number[] = q.close ?? []
  const volumes: number[] = q.volume ?? []

  return timestamps
    .map((ts, i) => ({
      time: new Date(ts * 1000).toISOString(),
      open: opens[i],
      high: highs[i],
      low: lows[i],
      close: closes[i],
      volume: volumes[i],
    }))
    .filter(b => b.close != null && !isNaN(b.close))
}

export type ChartSource = 'borsdata' | 'yahoo'

export function useChart(symbol: string, range: ChartRange = '1D') {
  const [bars, setBars] = useState<OHLCVBar[]>([])
  const [source, setSource] = useState<ChartSource | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const bd = await fetchFromBorsdata(symbol, range).catch(() => null)
      if (bd) {
        setBars(bd)
        setSource('borsdata')
      } else {
        setBars(await fetchFromYahoo(symbol, range))
        setSource('yahoo')
      }
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'fetch error')
    } finally {
      setLoading(false)
    }
  }, [symbol, range])

  useEffect(() => { load() }, [load])

  return { bars, loading, error, source, refetch: load }
}
