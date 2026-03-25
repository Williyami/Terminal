import { useState, useEffect, useRef, useCallback } from 'react'
import type { Quote } from '../types'


export const DEFAULT_SYMBOLS = [
  'NVDA', 'AAPL', 'MSFT', 'META', 'TSLA',
  'AMZN', 'GOOGL', 'AMD', 'SPY', 'QQQ'
]

function fmt(v: unknown): number | undefined {
  const n = Number(v)
  return isNaN(n) ? undefined : n
}

async function fetchQuotes(symbols: string[]): Promise<Quote[]> {
  const results = await Promise.all(
    symbols.map(async (symbol): Promise<Quote | null> => {
      try {
        const res = await fetch(`/yf/q1/v8/finance/chart/${symbol}?range=5d&interval=1d&includePrePost=false`)
        if (!res.ok) return null
        const json = await res.json()
        const result = json?.chart?.result?.[0]
        const meta = result?.meta
        const closes: Array<number | null> = result?.indicators?.quote?.[0]?.close ?? []
        const nonNull = closes.filter(v => v != null) as number[]
        const lastClose = nonNull.length > 0 ? nonNull[nonNull.length - 1] : null
        const prevCloseSeries = nonNull.length > 1 ? nonNull[nonNull.length - 2] : null
        const prevClose = meta?.chartPreviousClose ?? meta?.previousClose ?? prevCloseSeries
        const rawPrice = meta?.regularMarketPrice ?? lastClose
        const last = rawPrice == null ? null : Number(rawPrice)
        if (last == null) return null

        let change = Number(meta?.regularMarketChange)
        if (!Number.isFinite(change)) {
          if (prevClose != null) change = last - Number(prevClose)
          else change = 0
        }
        let changePct = Number(meta?.regularMarketChangePercent)
        if (!Number.isFinite(changePct)) {
          const base = last - change
          if (base !== 0) changePct = (change / base) * 100
          else changePct = 0
        }
        return {
          symbol,
          name: String(meta?.shortName ?? meta?.longName ?? symbol),
          last,
          change,
          changePct,
          volume: fmt(meta?.regularMarketVolume),
          high: fmt(meta?.regularMarketDayHigh),
          low: fmt(meta?.regularMarketDayLow),
          open: fmt(meta?.regularMarketOpen),
          bid: undefined,
          ask: undefined,
        }
      } catch {
        return null
      }
    })
  )
  return results.filter((q): q is Quote => q !== null)
}

export function useQuotes(symbols: string[] = DEFAULT_SYMBOLS, intervalMs = 30000) {
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const prevRef = useRef<Map<string, number>>(new Map())
  const [flashMap, setFlashMap] = useState<Map<string, 'up' | 'down'>>(new Map())

  const load = useCallback(async () => {
    try {
      const data = await fetchQuotes(symbols)
      const newFlash = new Map<string, 'up' | 'down'>()
      data.forEach(q => {
        const prev = prevRef.current.get(q.symbol)
        if (prev !== undefined && prev !== q.last) {
          newFlash.set(q.symbol, q.last > prev ? 'up' : 'down')
        }
        prevRef.current.set(q.symbol, q.last)
      })
      setFlashMap(newFlash)
      setQuotes(data)
      setError(null)
      setTimeout(() => setFlashMap(new Map()), 700)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'fetch error')
    } finally {
      setLoading(false)
    }
  }, [symbols.join(',')])

  useEffect(() => {
    load()
    const id = setInterval(load, intervalMs)
    return () => clearInterval(id)
  }, [load, intervalMs])

  return { quotes, loading, error, flashMap, refetch: load }
}
