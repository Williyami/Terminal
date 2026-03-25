import { useState, useEffect, useCallback } from 'react'
import type { OHLCVBar } from '../types'


const INTERVALS: Record<string, { range: string; interval: string }> = {
  '1D':  { range: '1d',  interval: '5m'  },
  '5D':  { range: '5d',  interval: '15m' },
  '1M':  { range: '1mo', interval: '60m' },
  '3M':  { range: '3mo', interval: '1d'  },
  '1Y':  { range: '1y',  interval: '1d'  },
  '5Y':  { range: '5y',  interval: '1wk' },
}

export type ChartRange = keyof typeof INTERVALS

export function useChart(symbol: string, range: ChartRange = '1D') {
  const [bars, setBars] = useState<OHLCVBar[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { range: r, interval } = INTERVALS[range]
    const url = `/yf/q1/v8/finance/chart/${symbol}?range=${r}&interval=${interval}&includePrePost=false`
    try {
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

      const parsed: OHLCVBar[] = timestamps
        .map((ts, i) => ({
          time: new Date(ts * 1000).toISOString(),
          open: opens[i],
          high: highs[i],
          low: lows[i],
          close: closes[i],
          volume: volumes[i],
        }))
        .filter(b => b.close != null && !isNaN(b.close))

      setBars(parsed)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'fetch error')
    } finally {
      setLoading(false)
    }
  }, [symbol, range])

  useEffect(() => { load() }, [load])

  return { bars, loading, error, refetch: load }
}
