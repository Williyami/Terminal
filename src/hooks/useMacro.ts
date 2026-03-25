import { useState, useEffect, useCallback } from 'react'
import type { MacroData } from '../types'


// Macro symbols via Yahoo Finance
const MACRO_SYMBOLS = [
  { symbol: '^GSPC',  label: 'SPX'  },
  { symbol: '^NDX',   label: 'NDX'  },
  { symbol: '^VIX',   label: 'VIX'  },
  { symbol: '^TNX',   label: '10Y'  },
  { symbol: 'DX-Y.NYB', label: 'DXY' },
  { symbol: '^IRX',   label: '3M'   },
  { symbol: '^FVX',   label: '5Y'   },
  { symbol: '^TYX',   label: '30Y'  },
  { symbol: 'GC=F',   label: 'GOLD' },
  { symbol: 'SI=F',   label: 'SILV' },
  { symbol: 'CL=F',   label: 'WTI'  },
  { symbol: 'NG=F',   label: 'NATG' },
  { symbol: 'HG=F',   label: 'COPR' },
]

async function fetchMacros(): Promise<MacroData[]> {
  return Promise.all(
    MACRO_SYMBOLS.map(async ({ symbol, label }) => {
      try {
        const res = await fetch(`/yf/q1/v8/finance/chart/${symbol}?range=5d&interval=1d&includePrePost=false`)
        if (!res.ok) return { label, value: null }
        const json = await res.json()
        const result = json?.chart?.result?.[0]
        const meta = result?.meta
        if (!meta) return { label, value: null }
        const closes: Array<number | null> = result?.indicators?.quote?.[0]?.close ?? []
        const nonNull = closes.filter(v => v != null) as number[]
        const lastClose = nonNull.length > 0 ? nonNull[nonNull.length - 1] : null
        const prevCloseSeries = nonNull.length > 1 ? nonNull[nonNull.length - 2] : null
        const prevClose = meta.chartPreviousClose ?? meta.previousClose ?? prevCloseSeries
        const rawPrice = meta.regularMarketPrice ?? lastClose
        const value = rawPrice == null ? null : Number(rawPrice)
        let changePct = Number(meta.regularMarketChangePercent)
        if (!Number.isFinite(changePct)) {
          const change = Number(meta.regularMarketChange)
          if (value != null && Number.isFinite(change)) {
            const base = value - change
            if (base !== 0) changePct = (change / base) * 100
          } else if (value != null && prevClose != null && Number(prevClose) !== 0) {
            changePct = ((value - Number(prevClose)) / Number(prevClose)) * 100
          } else if (lastClose != null && prevCloseSeries != null && prevCloseSeries !== 0) {
            changePct = ((lastClose - prevCloseSeries) / prevCloseSeries) * 100
          } else {
            changePct = 0
          }
        }
        return {
          label,
          value,
          change: Number(meta.regularMarketChange) || 0,
          changePct,
        }
      } catch {
        return { label, value: null }
      }
    })
  )
}

export function useMacro(intervalMs = 60000) {
  const [data, setData] = useState<MacroData[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const d = await fetchMacros()
      setData(d)
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

  return { data, loading, error }
}
