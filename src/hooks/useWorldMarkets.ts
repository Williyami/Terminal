import { useState, useEffect, useCallback } from 'react'

export interface WorldMarket {
  symbol: string
  label: string
  region: 'Americas' | 'Europe' | 'Asia' | 'MENA' | 'Africa'
  country: string
  lon: number   // degrees
  lat: number   // degrees
  value: number | null
  changePct: number
}

// Geographic coordinates are the financial capital of each country
const MARKET_DEFS: Omit<WorldMarket, 'value' | 'changePct'>[] = [
  // Americas (core)
  { symbol: '^GSPC',     label: 'SPX',    region: 'Americas', country: 'US',  lon: -74,  lat: 41   },
  { symbol: '^GSPTSE',   label: 'TSX',    region: 'Americas', country: 'CA',  lon: -79,  lat: 44   },
  { symbol: '^BVSP',     label: 'IBOV',   region: 'Americas', country: 'BR',  lon: -46,  lat: -23  },
  { symbol: '^MXX',      label: 'IPC',    region: 'Americas', country: 'MX',  lon: -99,  lat: 19   },
  // Europe (core)
  { symbol: '^FTSE',     label: 'FTSE',   region: 'Europe',   country: 'GB',  lon: 0,    lat: 51   },
  { symbol: '^GDAXI',    label: 'DAX',    region: 'Europe',   country: 'DE',  lon: 9,    lat: 50   },
  { symbol: '^FCHI',     label: 'CAC',    region: 'Europe',   country: 'FR',  lon: 2,    lat: 49   },
  { symbol: '^SSMI',     label: 'SMI',    region: 'Europe',   country: 'CH',  lon: 8,    lat: 47   },
  // MENA (anchor)
  { symbol: '^TASI.SR',  label: 'TASI',   region: 'MENA',     country: 'SA',  lon: 47,   lat: 25   },
  // Africa (anchor)
  { symbol: '^J203.JO',  label: 'JSE',    region: 'Africa',   country: 'ZA',  lon: 28,   lat: -26  },
  // Asia-Pacific (core)
  { symbol: '^N225',     label: 'N225',   region: 'Asia',     country: 'JP',  lon: 139,  lat: 36   },
  { symbol: '^HSI',      label: 'HSI',    region: 'Asia',     country: 'HK',  lon: 114,  lat: 22   },
  { symbol: '000001.SS', label: 'SHCOMP', region: 'Asia',     country: 'CN',  lon: 121,  lat: 31   },
  { symbol: '^KS11',     label: 'KOSPI',  region: 'Asia',     country: 'KR',  lon: 127,  lat: 37   },
  { symbol: '^NSEI',     label: 'NIFTY',  region: 'Asia',     country: 'IN',  lon: 73,   lat: 19   },
  { symbol: '^AXJO',     label: 'ASX200', region: 'Asia',     country: 'AU',  lon: 151,  lat: -34  },
]

async function fetchMarkets(): Promise<WorldMarket[]> {
  const results = await Promise.all(
    MARKET_DEFS.map(async (def) => {
      try {
        const res = await fetch(`/yf/q1/v8/finance/chart/${def.symbol}?range=5d&interval=1d&includePrePost=false`)
        if (!res.ok) return { ...def, value: null, changePct: 0 }
        const json = await res.json()
        const result = json?.chart?.result?.[0]
        const meta = result?.meta
        if (!meta) return { ...def, value: null, changePct: 0 }

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
          ...def,
          value,
          changePct,
        }
      } catch {
        return { ...def, value: null, changePct: 0 }
      }
    })
  )
  return results
}

export function useWorldMarkets(intervalMs = 60000) {
  const [markets, setMarkets] = useState<WorldMarket[]>(
    () => MARKET_DEFS.map(d => ({ ...d, value: null, changePct: 0 }))
  )
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const data = await fetchMarkets()
      setMarkets(data)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const id = setInterval(load, intervalMs)
    return () => clearInterval(id)
  }, [load, intervalMs])

  return { markets, loading }
}
