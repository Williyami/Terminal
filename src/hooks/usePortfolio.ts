import { useState, useEffect, useCallback } from 'react'

export interface Position {
  symbol: string
  qty: number
  avgCost: number
  currentPrice: number
  marketValue: number
  unrealizedPL: number
  unrealizedPLPct: number
  dayPL: number
  dayPLPct: number
  weight: number   // % of portfolio
}

export interface PortfolioSummary {
  totalValue: number
  totalCost: number
  totalUnrealizedPL: number
  totalUnrealizedPLPct: number
  totalDayPL: number
  cashBalance: number
  buyingPower: number
}

// Default demo portfolio — user can edit in localStorage
const DEFAULT_HOLDINGS: { symbol: string; qty: number; avgCost: number }[] = [
  { symbol: 'NVDA', qty: 50,  avgCost: 620.00 },
  { symbol: 'AAPL', qty: 100, avgCost: 155.00 },
  { symbol: 'MSFT', qty: 30,  avgCost: 380.00 },
  { symbol: 'META', qty: 20,  avgCost: 450.00 },
  { symbol: 'TSLA', qty: 40,  avgCost: 220.00 },
  { symbol: 'AMZN', qty: 25,  avgCost: 170.00 },
  { symbol: 'SPY',  qty: 15,  avgCost: 500.00 },
]

const STORAGE_KEY = 'echelon_portfolio'

export function loadHoldings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as typeof DEFAULT_HOLDINGS
  } catch {}
  return DEFAULT_HOLDINGS
}

export function saveHoldings(h: typeof DEFAULT_HOLDINGS) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(h))
}

async function fetchPrices(symbols: string[]): Promise<Map<string, { price: number; prevClose: number }>> {
  const map = new Map<string, { price: number; prevClose: number }>()
  await Promise.all(
    symbols.map(async (symbol) => {
      try {
        const res = await fetch(`/yf/q1/v8/finance/chart/${symbol}?range=1d&interval=1d&includePrePost=false`)
        if (!res.ok) return
        const json = await res.json()
        const meta = json?.chart?.result?.[0]?.meta
        if (!meta) return
        map.set(symbol, {
          price: Number(meta.regularMarketPrice) || 0,
          prevClose: Number(meta.chartPreviousClose) || Number(meta.regularMarketPrice) || 0,
        })
      } catch {}
    })
  )
  return map
}

export function usePortfolio(intervalMs = 30000) {
  const [holdings, setHoldings] = useState(loadHoldings)
  const [positions, setPositions] = useState<Position[]>([])
  const [summary, setSummary] = useState<PortfolioSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (holdings.length === 0) { setLoading(false); return }
    try {
      const prices = await fetchPrices(holdings.map(h => h.symbol))
      const totalCost = holdings.reduce((s, h) => s + h.qty * h.avgCost, 0)
      const cashBalance = 10000 // demo
      let totalValue = cashBalance

      const pos: Position[] = holdings.map(h => {
        const q = prices.get(h.symbol) ?? { price: h.avgCost, prevClose: h.avgCost }
        const mv = h.qty * q.price
        const cost = h.qty * h.avgCost
        const upl = mv - cost
        const uplPct = cost > 0 ? (upl / cost) * 100 : 0
        const dayPL = h.qty * (q.price - q.prevClose)
        const dayPLPct = q.prevClose > 0 ? ((q.price - q.prevClose) / q.prevClose) * 100 : 0
        totalValue += mv
        return { symbol: h.symbol, qty: h.qty, avgCost: h.avgCost, currentPrice: q.price, marketValue: mv, unrealizedPL: upl, unrealizedPLPct: uplPct, dayPL, dayPLPct, weight: 0 }
      })

      // weights after we know totalValue
      pos.forEach(p => { p.weight = totalValue > 0 ? (p.marketValue / totalValue) * 100 : 0 })
      pos.sort((a, b) => b.marketValue - a.marketValue)

      const totalUPL = pos.reduce((s, p) => s + p.unrealizedPL, 0)
      const totalDayPL = pos.reduce((s, p) => s + p.dayPL, 0)

      setPositions(pos)
      setSummary({
        totalValue,
        totalCost,
        totalUnrealizedPL: totalUPL,
        totalUnrealizedPLPct: totalCost > 0 ? (totalUPL / totalCost) * 100 : 0,
        totalDayPL,
        cashBalance,
        buyingPower: cashBalance * 2,
      })
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'fetch error')
    } finally {
      setLoading(false)
    }
  }, [holdings])

  useEffect(() => {
    load()
    const id = setInterval(load, intervalMs)
    return () => clearInterval(id)
  }, [load, intervalMs])

  const updateHolding = useCallback((symbol: string, qty: number, avgCost: number) => {
    setHoldings(prev => {
      const next = prev.filter(h => h.symbol !== symbol)
      if (qty > 0) next.push({ symbol, qty, avgCost })
      saveHoldings(next)
      return next
    })
  }, [])

  const addHolding = useCallback((symbol: string, qty: number, avgCost: number) => {
    setHoldings(prev => {
      const existing = prev.find(h => h.symbol === symbol)
      let next: typeof DEFAULT_HOLDINGS
      if (existing) {
        // Average down/up
        const totalQty = existing.qty + qty
        const newAvg = (existing.qty * existing.avgCost + qty * avgCost) / totalQty
        next = prev.map(h => h.symbol === symbol ? { ...h, qty: totalQty, avgCost: newAvg } : h)
      } else {
        next = [...prev, { symbol, qty, avgCost }]
      }
      saveHoldings(next)
      return next
    })
  }, [])

  return { positions, summary, loading, error, holdings, updateHolding, addHolding, refetch: load }
}
