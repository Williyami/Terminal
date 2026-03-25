import { useState, useEffect, useCallback } from 'react'

export interface FlowItem {
  id: string
  time: string
  symbol: string
  expiry: string
  strike: number
  type: 'CALL' | 'PUT'
  side: 'BUY' | 'SELL'
  size: number
  premium: number   // total premium $
  iv: number
  spot: number
  tag: 'SWEEP' | 'BLOCK' | 'SPLIT' | 'UNUSUAL'
  sentiment: 'BULLISH' | 'BEARISH'
}

// Since Unusual Whales free tier requires auth, we generate realistic
// synthetic flow seeded from live Yahoo quote data
function generateFlow(symbols: string[], spots: Map<string, number>): FlowItem[] {
  const items: FlowItem[] = []
  const now = Date.now()

  const expiries = ['2025-04-04', '2025-04-11', '2025-04-17', '2025-05-16', '2025-06-20']

  for (let i = 0; i < 40; i++) {
    const sym = symbols[Math.floor(Math.random() * symbols.length)]
    const spot = spots.get(sym) ?? 100
    const type: FlowItem['type'] = Math.random() > 0.5 ? 'CALL' : 'PUT'
    const side: FlowItem['side'] = Math.random() > 0.5 ? 'BUY' : 'SELL'
    const strikePct = 0.85 + Math.random() * 0.3  // 85–115% of spot
    const strike = parseFloat((Math.round(spot * strikePct / 5) * 5).toFixed(0))
    const size = Math.floor(10 + Math.random() * 2000)
    const contractPrice = 0.5 + Math.random() * 15
    const premium = Math.round(size * contractPrice * 100)
    const iv = 20 + Math.random() * 80
    const expiry = expiries[Math.floor(Math.random() * expiries.length)]
    const minsAgo = Math.floor(Math.random() * 390) // market hours
    const t = new Date(now - minsAgo * 60000)
    const tag = premium > 500000
      ? 'BLOCK'
      : Math.random() > 0.7
        ? 'SWEEP'
        : Math.random() > 0.5
          ? 'UNUSUAL'
          : 'SPLIT'
    const bullish = type === 'CALL' ? side === 'BUY' : side === 'SELL'

    items.push({
      id: `flow-${i}`,
      time: t.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
      symbol: sym,
      expiry,
      strike,
      type,
      side,
      size,
      premium,
      iv: parseFloat(iv.toFixed(1)),
      spot,
      tag,
      sentiment: bullish ? 'BULLISH' : 'BEARISH',
    })
  }

  return items.sort((a, b) => b.premium - a.premium)
}

const FLOW_SYMBOLS = ['NVDA', 'AAPL', 'TSLA', 'SPY', 'QQQ', 'AMZN', 'MSFT', 'META', 'AMD', 'GOOGL']

async function fetchSpots(): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  await Promise.all(
    FLOW_SYMBOLS.map(async (symbol) => {
      try {
        const res = await fetch(`/yf/q1/v8/finance/chart/${symbol}?range=1d&interval=1d&includePrePost=false`)
        if (!res.ok) return
        const json = await res.json()
        const price = json?.chart?.result?.[0]?.meta?.regularMarketPrice
        if (price) map.set(symbol, Number(price))
      } catch {}
    })
  )
  return map
}

export function useOptionsFlow(intervalMs = 60000) {
  const [flow, setFlow] = useState<FlowItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [putCallRatio, setPutCallRatio] = useState<number>(0)
  const [totalPremium, setTotalPremium] = useState<number>(0)

  const load = useCallback(async () => {
    try {
      const spots = await fetchSpots()
      const items = generateFlow(FLOW_SYMBOLS, spots)
      const calls = items.filter(f => f.type === 'CALL')
      const puts = items.filter(f => f.type === 'PUT')
      const ratio = calls.length > 0 ? puts.length / calls.length : 1
      const total = items.reduce((s, f) => s + f.premium, 0)
      setFlow(items)
      setPutCallRatio(parseFloat(ratio.toFixed(2)))
      setTotalPremium(total)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'fetch error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const id = setInterval(load, intervalMs)
    return () => clearInterval(id)
  }, [load, intervalMs])

  return { flow, loading, error, putCallRatio, totalPremium, refetch: load }
}
