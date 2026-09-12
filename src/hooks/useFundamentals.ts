import { useState, useEffect, useCallback } from 'react'
import {
  resolveSymbol,
  fetchKpi,
  fetchReports,
  type Instrument,
  type Report,
} from '../utils/borsdata'

// Fundamentals are the part of the terminal Börsdata covers that no free price
// feed does: valuation multiples, margins and returns, plus the underlying
// report series behind them.

export interface KpiRow {
  label: string
  kpiId: number
  value: number | null
  format: 'ratio' | 'pct' | 'currency' | 'millions'
  /** Börsdata screens most KPIs as last/latest; growth rates only exist as CAGRs. */
  group?: string
  calc?: string
}

const VALUATION: Array<Omit<KpiRow, 'value'>> = [
  { label: 'Market Cap',  kpiId: 50, format: 'millions' },
  { label: 'P/E',         kpiId: 2,  format: 'ratio' },
  { label: 'P/S',         kpiId: 3,  format: 'ratio' },
  { label: 'P/B',         kpiId: 4,  format: 'ratio' },
  { label: 'EV/EBIT',     kpiId: 10, format: 'ratio' },
  { label: 'EV/EBITDA',   kpiId: 11, format: 'ratio' },
  { label: 'Div Yield',   kpiId: 1,  format: 'pct' },
]

const QUALITY: Array<Omit<KpiRow, 'value'>> = [
  { label: 'Gross Margin',     kpiId: 28, format: 'pct' },
  { label: 'Operating Margin', kpiId: 29, format: 'pct' },
  { label: 'Profit Margin',    kpiId: 30, format: 'pct' },
  { label: 'Return on Equity', kpiId: 33, format: 'pct' },
  { label: 'Equity Ratio',     kpiId: 39, format: 'pct' },
  { label: 'Revenue CAGR 3Y',  kpiId: 94, format: 'pct', group: '3year', calc: 'cagr' },
  { label: 'Earnings CAGR 3Y', kpiId: 97, format: 'pct', group: '3year', calc: 'cagr' },
]

export interface Fundamentals {
  instrument: Instrument
  valuation: KpiRow[]
  quality: KpiRow[]
  reports: Report[]
}

async function loadKpiGroup(insId: number, defs: Array<Omit<KpiRow, 'value'>>): Promise<KpiRow[]> {
  return Promise.all(
    defs.map(async def => ({
      ...def,
      value: await fetchKpi(insId, def.kpiId, def.group ?? 'last', def.calc ?? 'latest'),
    })),
  )
}

export function useFundamentals(symbol: string, reportType: 'year' | 'quarter' | 'r12' = 'r12') {
  const [data, setData] = useState<Fundamentals | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!symbol.trim()) {
      setData(null)
      return
    }
    setLoading(true)
    try {
      const instrument = await resolveSymbol(symbol)
      if (!instrument) {
        setData(null)
        setError('Not covered by Börsdata')
        return
      }
      const [valuation, quality, reports] = await Promise.all([
        loadKpiGroup(instrument.insId, VALUATION),
        loadKpiGroup(instrument.insId, QUALITY),
        fetchReports(instrument.insId, reportType, 12),
      ])
      setData({ instrument, valuation, quality, reports })
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'fundamentals error')
    } finally {
      setLoading(false)
    }
  }, [symbol, reportType])

  useEffect(() => { load() }, [load])

  return { data, loading, error, refetch: load }
}

export function formatKpi(row: KpiRow, currency?: string | null): string {
  if (row.value == null || !Number.isFinite(row.value)) return '—'
  const v = row.value
  switch (row.format) {
    case 'pct':
      return `${v.toFixed(2)}%`
    case 'millions': {
      const suffix = currency ? ` ${currency}` : ''
      if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}T${suffix}`
      if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(2)}B${suffix}`
      return `${v.toFixed(0)}M${suffix}`
    }
    case 'currency':
      return `${v.toFixed(2)}${currency ? ` ${currency}` : ''}`
    default:
      return v.toFixed(2)
  }
}
