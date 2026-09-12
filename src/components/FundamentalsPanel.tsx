import { useState } from 'react'
import { useFundamentals, formatKpi, type KpiRow } from '../hooks/useFundamentals'
import type { Report } from '../utils/borsdata'

interface Props {
  symbol: string
}

const REPORT_TYPES = [
  { key: 'r12', label: 'R12' },
  { key: 'year', label: 'Year' },
  { key: 'quarter', label: 'Quarter' },
] as const

type ReportType = (typeof REPORT_TYPES)[number]['key']

function KpiGrid({ title, rows, currency }: { title: string; rows: KpiRow[]; currency?: string | null }) {
  return (
    <div>
      <div className="text-secondary text-[10px] font-mono tracking-wider mb-1">{title}</div>
      <div className="grid grid-cols-2 gap-x-4">
        {rows.map(row => (
          <div key={row.kpiId} className="flex items-center justify-between text-xs font-mono border-b border-border/60 py-1">
            <span className="text-secondary">{row.label}</span>
            <span className="text-primary">{formatKpi(row, currency)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function millions(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return '—'
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(1)}B`
  return v.toFixed(0)
}

function periodLabel(r: Report): string {
  return r.period ? `${r.year} Q${r.period}` : String(r.year)
}

function ReportTable({ reports }: { reports: Report[] }) {
  // Newest first reads better in a terminal table than the API's oldest-first order
  const rows = [...reports].reverse().slice(0, 8)
  if (rows.length === 0) return <div className="text-secondary text-xs font-mono">No reports.</div>

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs font-mono">
        <thead>
          <tr className="text-secondary border-b border-border">
            <th className="text-left font-normal py-1 pr-3">Period</th>
            <th className="text-right font-normal py-1 pr-3">Revenue</th>
            <th className="text-right font-normal py-1 pr-3">Op. Income</th>
            <th className="text-right font-normal py-1 pr-3">EPS</th>
            <th className="text-right font-normal py-1 pr-3">FCF</th>
            <th className="text-right font-normal py-1">Net Debt</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={`${r.year}-${r.period}`} className="border-b border-border/60">
              <td className="text-secondary py-1 pr-3">{periodLabel(r)}</td>
              <td className="text-primary text-right py-1 pr-3">{millions(r.revenues)}</td>
              <td className={`text-right py-1 pr-3 ${(r.operating_Income ?? 0) < 0 ? 'text-red' : 'text-primary'}`}>
                {millions(r.operating_Income)}
              </td>
              <td className={`text-right py-1 pr-3 ${(r.earnings_Per_Share ?? 0) < 0 ? 'text-red' : 'text-primary'}`}>
                {r.earnings_Per_Share?.toFixed(2) ?? '—'}
              </td>
              <td className="text-primary text-right py-1 pr-3">{millions(r.free_Cash_Flow)}</td>
              <td className="text-primary text-right py-1">{millions(r.net_Debt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function FundamentalsPanel({ symbol }: Props) {
  const [reportType, setReportType] = useState<ReportType>('r12')
  const { data, loading, error } = useFundamentals(symbol, reportType)

  return (
    <section className="border border-border bg-surface2 p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-secondary text-xs font-mono tracking-wider">FUNDAMENTALS</span>
        <div className="flex items-center gap-2">
          {data && (
            <span className="text-secondary text-[10px] font-mono">
              {data.instrument.market} · {data.instrument.sector} · {data.instrument.reportCurrency}
            </span>
          )}
          <div className="flex">
            {REPORT_TYPES.map(t => (
              <button
                key={t.key}
                onClick={() => setReportType(t.key)}
                className={`text-[10px] font-mono border px-2 py-0.5 -ml-px transition-colors
                  ${reportType === t.key ? 'text-orange border-orange' : 'text-secondary border-border hover:text-primary'}`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading && <div className="text-secondary text-xs font-mono">Loading fundamentals…</div>}
      {error && !loading && <div className="text-secondary text-xs font-mono">{error}</div>}

      {data && !loading && (
        <div className="space-y-3">
          <KpiGrid title="VALUATION" rows={data.valuation} currency={data.instrument.reportCurrency} />
          <KpiGrid title="QUALITY & GROWTH" rows={data.quality} currency={data.instrument.reportCurrency} />
          <div>
            <div className="text-secondary text-[10px] font-mono tracking-wider mb-1">
              REPORTS ({reportType.toUpperCase()}, {data.instrument.reportCurrency ?? ''}M)
            </div>
            <ReportTable reports={data.reports} />
          </div>
          <div className="text-secondary text-[10px] font-mono pt-1">Source: Börsdata</div>
        </div>
      )}
    </section>
  )
}
