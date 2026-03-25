import { useState, useEffect, useCallback } from 'react'

export interface OptionContract {
  strike: number
  expiry: string
  type: 'call' | 'put'
  bid: number
  ask: number
  last: number
  volume: number
  openInterest: number
  iv: number     // percent, e.g. 32.5
  delta: number
  gamma: number
  theta: number
  itm: boolean
}

export interface OptionsExpiry {
  date: string
  calls: OptionContract[]
  puts: OptionContract[]
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Replace any non-finite value with a fallback so NaN never reaches the UI */
function safe(v: number, fallback = 0): number {
  return Number.isFinite(v) ? v : fallback
}

function normCDF(x: number): number {
  if (!Number.isFinite(x)) return x > 0 ? 1 : 0
  if (x > 8)  return 1
  if (x < -8) return 0
  const a = Math.abs(x)
  const t = 1 / (1 + 0.2316419 * a)
  const poly = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))))
  const cdf = 1 - (Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI)) * poly
  return x >= 0 ? cdf : 1 - cdf
}

function normPDF(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI)
}

interface BSOut { price: number; delta: number; gamma: number; theta: number }

function bs(S: number, K: number, T: number, r: number, sigma: number, type: 'call' | 'put'): BSOut {
  if (!(S > 0 && K > 0 && T > 0 && sigma > 0)) {
    const intrinsic = type === 'call' ? Math.max(S - K, 0) : Math.max(K - S, 0)
    return { price: intrinsic, delta: type === 'call' ? (S > K ? 1 : 0) : (S < K ? -1 : 0), gamma: 0, theta: 0 }
  }
  const sqrtT = Math.sqrt(T)
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT)
  const d2 = d1 - sigma * sqrtT
  const disc = Math.exp(-r * T)

  const price = type === 'call'
    ? S * normCDF(d1) - K * disc * normCDF(d2)
    : K * disc * normCDF(-d2) - S * normCDF(-d1)
  const delta = type === 'call' ? normCDF(d1) : normCDF(d1) - 1
  const gamma = normPDF(d1) / (S * sigma * sqrtT)
  const theta = (-(S * normPDF(d1) * sigma) / (2 * sqrtT)
    - r * K * disc * (type === 'call' ? normCDF(d2) : normCDF(-d2))) / 365

  return {
    price: safe(Math.max(0, price)),
    delta: safe(delta),
    gamma: safe(gamma),
    theta: safe(theta),
  }
}

// ── Expiration schedule ───────────────────────────────────────────────────────

function generateExpirations(): string[] {
  const today = new Date()
  const result: string[] = []

  // Next 5 weekly Fridays
  const d = new Date(today)
  const daysUntilFriday = ((5 - d.getDay() + 7) % 7) || 7
  d.setDate(d.getDate() + daysUntilFriday)
  for (let i = 0; i < 5; i++) {
    result.push(d.toISOString().split('T')[0])
    d.setDate(d.getDate() + 7)
  }

  // 3rd Friday of each of the next 9 months
  for (let m = 1; m <= 9; m++) {
    const first = new Date(today.getFullYear(), today.getMonth() + m, 1)
    const offset = (5 - first.getDay() + 7) % 7
    const thirdFriday = new Date(first)
    thirdFriday.setDate(1 + offset + 14)
    const key = thirdFriday.toISOString().split('T')[0]
    if (!result.includes(key)) result.push(key)
  }

  return result.sort()
}

// ── Synthetic chain builder ───────────────────────────────────────────────────

function buildChain(spot: number, expiry: string): { calls: OptionContract[]; puts: OptionContract[] } {
  const ms = new Date(expiry).getTime() - Date.now()
  const T = Number.isFinite(ms) && ms > 0 ? ms / (365 * 24 * 3600 * 1000) : 0.001
  const r = 0.045

  // Term-structure: short-dated ATM IV is higher
  const atmIV = safe(0.22 + 0.06 * Math.exp(-T * 3), 0.25)

  // Strike grid sized to price level
  const inc = spot > 1000 ? 25 : spot > 200 ? 5 : spot > 50 ? 2.5 : spot > 10 ? 1 : 0.5
  const lo = Math.floor(spot * 0.80 / inc) * inc
  const hi = Math.ceil(spot * 1.20 / inc) * inc
  const strikes: number[] = []
  for (let k = lo; k <= hi + inc * 0.5; k = Math.round((k + inc) * 10000) / 10000) {
    strikes.push(k)
  }

  const makeContracts = (type: 'call' | 'put'): OptionContract[] =>
    strikes.map(K => {
      const m = safe(Math.log(K / spot))
      const skew = (type === 'put' ? -0.03 : 0.01) * m
      const smile = 0.08 * m * m
      const iv = Math.max(0.05, safe(atmIV + smile + skew, atmIV))

      const { price, delta, gamma, theta } = bs(spot, K, T, r, iv, type)
      const spread = Math.max(0.01, price * 0.04)

      const dist = safe(Math.abs(K - spot) / spot)
      const base = Math.floor(safe(8000 * Math.exp(-12 * dist * dist)))

      return {
        strike: K,
        expiry,
        type,
        bid:  parseFloat(Math.max(0, price - spread / 2).toFixed(2)),
        ask:  parseFloat((price + spread / 2).toFixed(2)),
        last: parseFloat(price.toFixed(2)),
        volume:       Math.max(0, Math.floor(base * (0.4 + Math.random() * 0.6))),
        openInterest: Math.max(0, Math.floor(base * (2   + Math.random() * 4))),
        iv:    parseFloat((iv * 100).toFixed(1)),
        delta: parseFloat(delta.toFixed(3)),
        gamma: parseFloat(gamma.toFixed(4)),
        theta: parseFloat(theta.toFixed(3)),
        itm: type === 'call' ? spot > K : spot < K,
      }
    })

  return { calls: makeContracts('call'), puts: makeContracts('put') }
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useOptionsChain(symbol: string) {
  const [chain, setChain]       = useState<OptionsExpiry | null>(null)
  const [expirations]           = useState<string[]>(() => generateExpirations())
  const [selectedExpiry, setSelectedExpiry] = useState<string>('')
  const [spot, setSpot]         = useState<number>(0)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)

  const load = useCallback(async (expiry?: string) => {
    setLoading(true)
    try {
      const res = await fetch(`/yf/q1/v8/finance/chart/${symbol}?range=1d&interval=1d&includePrePost=false`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      const price = Number(json?.chart?.result?.[0]?.meta?.regularMarketPrice)
      if (!(price > 0)) throw new Error('no price data')

      const target = expiry ?? expirations[0] ?? ''
      setSpot(price)
      setChain({ date: target, ...buildChain(price, target) })
      if (!expiry) setSelectedExpiry(target)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'fetch error')
    } finally {
      setLoading(false)
    }
  }, [symbol, expirations])

  useEffect(() => { load() }, [load])

  const selectExpiry = useCallback((date: string) => {
    setSelectedExpiry(date)
    setChain(prev => prev ? { date, ...buildChain(spot > 0 ? spot : 1, date) } : null)
    if (spot <= 0) load(date)
  }, [spot, load])

  return { chain, expirations, selectedExpiry, selectExpiry, spot, loading, error }
}
