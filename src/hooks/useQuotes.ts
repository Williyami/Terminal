import { useState, useEffect, useRef, useCallback } from 'react'
import type { Quote } from '../types'
import { resolveSymbols, fetchDailyBars, type Instrument } from '../utils/borsdata'


export const DEFAULT_SYMBOLS = [
  'NVDA', 'AAPL', 'MSFT', 'META', 'TSLA',
  'AMZN', 'GOOGL', 'AMD', 'SPY', 'QQQ'
]

export type QuoteSource = 'yahoo' | 'borsdata'

export interface SourcedQuote extends Quote {
  source: QuoteSource
  currency?: string
  market?: string
}

function fmt(v: unknown): number | undefined {
  const n = Number(v)
  return isNaN(n) ? undefined : n
}

async function fetchYahooQuote(symbol: string): Promise<Quote | null> {
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
}

/**
 * Börsdata close-on-close quote. End-of-day rather than live, but it covers the
 * Nordic listings Yahoo regularly drops, and the two most recent daily bars
 * give a real previous close to change against.
 */
async function fetchBorsdataQuote(symbol: string, inst: Instrument): Promise<SourcedQuote | null> {
  try {
    const from = new Date(Date.now() - 21 * 86_400_000).toISOString().slice(0, 10)
    const bars = await fetchDailyBars(inst.insId, { from })
    if (bars.length === 0) return null
    const latest = bars[bars.length - 1]
    const prev = bars.length > 1 ? bars[bars.length - 2] : null
    const change = prev ? latest.close - prev.close : 0
    const changePct = prev && prev.close !== 0 ? (change / prev.close) * 100 : 0
    return {
      symbol,
      name: inst.name,
      last: latest.close,
      change,
      changePct,
      volume: latest.volume,
      high: latest.high,
      low: latest.low,
      open: latest.open,
      source: 'borsdata',
      currency: inst.stockPriceCurrency ?? undefined,
      market: inst.market ?? undefined,
    }
  } catch {
    return null
  }
}

/**
 * Yahoo leads because it is the only live source; Börsdata backs every symbol
 * Yahoo fails to return and supplies the instrument metadata for the rest.
 */
async function fetchQuotes(symbols: string[]): Promise<SourcedQuote[]> {
  const instruments = await resolveSymbols(symbols).catch(() => new Map<string, Instrument>())
  const yahoo = await Promise.all(symbols.map(fetchYahooQuote))

  const out = await Promise.all(
    symbols.map(async (symbol, i): Promise<SourcedQuote | null> => {
      const inst = instruments.get(symbol)
      const live = yahoo[i]
      if (live) {
        return {
          ...live,
          // Börsdata carries the cleaner instrument name and the listing currency
          name: inst?.name ?? live.name,
          source: 'yahoo',
          currency: inst?.stockPriceCurrency ?? undefined,
          market: inst?.market ?? undefined,
        }
      }
      return inst ? fetchBorsdataQuote(symbol, inst) : null
    })
  )
  return out.filter((q): q is SourcedQuote => q !== null)
}

export function useQuotes(symbols: string[] = DEFAULT_SYMBOLS, intervalMs = 30000) {
  // Callers pass a fresh array each render; key the reload off its contents.
  const symbolKey = symbols.join(',')
  const [quotes, setQuotes] = useState<SourcedQuote[]>([])
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbolKey])

  useEffect(() => {
    load()
    const id = setInterval(load, intervalMs)
    return () => clearInterval(id)
  }, [load, intervalMs])

  return { quotes, loading, error, flashMap, refetch: load }
}
