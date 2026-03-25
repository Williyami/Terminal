import { useEffect, useMemo, useState } from 'react'
import { useSpreadsheet } from '../context/SpreadsheetContext'
import { useWatchlist } from '../context/WatchlistContext'
import { OHLCVChart } from '../components/OHLCVChart'
import { Watchlist } from '../components/Watchlist'
import { NewsFeed } from '../components/NewsFeed'
import { offsetCell } from '../utils/sheet'

interface SearchItem {
  symbol: string
  name: string
  exchange: string
  type: string
}

interface QuoteInfo {
  symbol: string
  shortName?: string
  regularMarketPrice?: number
  regularMarketChange?: number
  regularMarketChangePercent?: number
  marketCap?: number
  trailingPE?: number
  forwardPE?: number
  regularMarketDayHigh?: number
  regularMarketDayLow?: number
  regularMarketOpen?: number
  regularMarketVolume?: number
  currency?: string
  longName?: string
}

async function fetchSearch(q: string): Promise<SearchItem[]> {
  const res = await fetch(`/yf-search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0`)
  if (res.ok) {
    const data = await res.json()
    const quotes = Array.isArray(data?.quotes) ? data.quotes : []
    const items = quotes.map((r: Record<string, unknown>) => ({
      symbol: String(r.symbol ?? ''),
      name: String(r.shortname ?? r.longname ?? ''),
      exchange: String(r.exchange ?? ''),
      type: String(r.quoteType ?? ''),
    })).filter(q => q.symbol)
    if (items.length > 0) return items
  }

  // Fallback: treat query as symbol(s) and use quote endpoint
  const symbols = q.split(',').map(s => s.trim()).filter(Boolean).slice(0, 10)
  if (symbols.length === 0) return []
  const qres = await fetch(`/yf/q1/v7/finance/quote?symbols=${encodeURIComponent(symbols.join(','))}`)
  if (!qres.ok) throw new Error(`HTTP ${qres.status}`)
  const qdata = await qres.json()
  const result = Array.isArray(qdata?.quoteResponse?.result) ? qdata.quoteResponse.result : []
  return result.map((r: Record<string, unknown>) => ({
    symbol: String(r.symbol ?? ''),
    name: String(r.shortName ?? r.longName ?? ''),
    exchange: String(r.fullExchangeName ?? r.exchange ?? ''),
    type: String(r.quoteType ?? ''),
  })).filter(q => q.symbol)
}

async function fetchQuote(symbol: string): Promise<QuoteInfo | null> {
  const res = await fetch(`/yf/q1/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d&includePrePost=false`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  const meta = data?.chart?.result?.[0]?.meta
  if (!meta) return null
  return {
    symbol,
    shortName: meta.shortName,
    longName: meta.longName,
    regularMarketPrice: meta.regularMarketPrice,
    regularMarketChange: meta.regularMarketChange,
    regularMarketChangePercent: meta.regularMarketChangePercent,
    marketCap: meta.marketCap,
    trailingPE: meta.trailingPE,
    forwardPE: meta.forwardPE,
    regularMarketDayHigh: meta.regularMarketDayHigh,
    regularMarketDayLow: meta.regularMarketDayLow,
    regularMarketOpen: meta.regularMarketOpen,
    regularMarketVolume: meta.regularMarketVolume,
    currency: meta.currency,
  }
}

function fmtNum(v?: number) {
  if (v == null || Number.isNaN(v)) return '—'
  return v.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

export function StockSearchPage() {
  const { cells, setCells, activeCell } = useSpreadsheet()
  const { addSymbol } = useWatchlist()
  const [flash, setFlash] = useState<'watchlist' | 'export' | null>(null)
  const [indicators, setIndicators] = useState({
    rsi: false,
    sma20: false,
    ema20: false,
    macd: false,
  })
  const [query, setQuery] = useState('AAPL')
  const [results, setResults] = useState<SearchItem[]>([])
  const [selected, setSelected] = useState<SearchItem | null>(null)
  const [quote, setQuote] = useState<QuoteInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancel = false
    if (!query.trim()) {
      setResults([])
      return
    }
    setLoading(true)
    fetchSearch(query)
      .then(r => { if (!cancel) setResults(r) })
      .catch(e => { if (!cancel) setError(e instanceof Error ? e.message : 'search error') })
      .finally(() => { if (!cancel) setLoading(false) })
    return () => { cancel = true }
  }, [query])

  useEffect(() => {
    let cancel = false
    if (!selected) return
    setLoading(true)
    fetchQuote(selected.symbol)
      .then(q => { if (!cancel) setQuote(q) })
      .catch(e => { if (!cancel) setError(e instanceof Error ? e.message : 'quote error') })
      .finally(() => { if (!cancel) setLoading(false) })
    return () => { cancel = true }
  }, [selected])

  const sheetAnchor = activeCell

  const exportToSheet = () => {
    if (!quote) return
    const rows: Array<[string, string]> = [
      ['Symbol', quote.symbol ?? ''],
      ['Name', quote.longName ?? quote.shortName ?? ''],
      ['Price', fmtNum(quote.regularMarketPrice)],
      ['Change', fmtNum(quote.regularMarketChange)],
      ['Change %', quote.regularMarketChangePercent != null ? `${quote.regularMarketChangePercent.toFixed(2)}%` : '—'],
      ['Market Cap', fmtNum(quote.marketCap)],
      ['PE (TTM)', fmtNum(quote.trailingPE)],
      ['PE (Fwd)', fmtNum(quote.forwardPE)],
      ['Day High', fmtNum(quote.regularMarketDayHigh)],
      ['Day Low', fmtNum(quote.regularMarketDayLow)],
      ['Open', fmtNum(quote.regularMarketOpen)],
      ['Volume', fmtNum(quote.regularMarketVolume)],
      ['Currency', quote.currency ?? ''],
    ]

    const updates: Record<string, string> = { ...cells }
    rows.forEach((row, i) => {
      const keyCell = offsetCell(sheetAnchor, 0, i, 26, 30)
      const valCell = offsetCell(sheetAnchor, 1, i, 26, 30)
      updates[keyCell] = row[0]
      updates[valCell] = row[1]
    })
    setCells(updates)
    setFlash('export')
    setTimeout(() => setFlash(null), 900)
  }

  const info = useMemo(() => {
    if (!quote) return null
    return [
      ['Price', `${fmtNum(quote.regularMarketPrice)} ${quote.currency ?? ''}`.trim()],
      ['Change', quote.regularMarketChange != null ? `${fmtNum(quote.regularMarketChange)} (${quote.regularMarketChangePercent?.toFixed(2) ?? '—'}%)` : '—'],
      ['Market Cap', fmtNum(quote.marketCap)],
      ['PE (TTM)', fmtNum(quote.trailingPE)],
      ['PE (Fwd)', fmtNum(quote.forwardPE)],
      ['Day Range', `${fmtNum(quote.regularMarketDayLow)} – ${fmtNum(quote.regularMarketDayHigh)}`],
      ['Volume', fmtNum(quote.regularMarketVolume)],
    ]
  }, [quote])

  return (
    <div className="h-full bg-surface flex">
      <Watchlist
        selected={selected?.symbol ?? ''}
        onSelect={(symbol) => {
          setQuery(symbol)
          setSelected({ symbol, name: symbol, exchange: '', type: '' })
        }}
      />

      <div className="flex-1 overflow-y-auto">
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-border">
          <span className="panel-header text-orange font-bold text-xs tracking-widest">STOCKS</span>
          <span className="text-secondary text-xs">F9</span>
        </div>

        <div className="p-4 space-y-4">
        <section className="border border-border bg-surface2 p-3">
          <div className="text-secondary text-xs font-mono mb-2 tracking-wider">SEARCH</div>
          <input
            className="w-full bg-bg border border-border px-2 py-1 text-primary text-xs font-mono"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search ticker or company"
          />
          {loading && <div className="text-secondary text-xs font-mono mt-2">Loading…</div>}
          {error && <div className="text-red text-xs font-mono mt-2">{error}</div>}
          <div className="mt-2 space-y-1">
            {results.map(r => (
              <div
                key={r.symbol}
                role="button"
                tabIndex={0}
                onClick={() => setSelected(r)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') setSelected(r)
                }}
                className={`w-full text-left text-xs font-mono px-2 py-1 border border-border/60 hover:bg-surface cursor-pointer
                  ${selected?.symbol === r.symbol ? 'bg-surface border-orange text-orange' : 'text-secondary'}
                `}
              >
                <span className="text-primary">{r.symbol}</span> — {r.name} <span className="text-secondary">({r.exchange})</span>
              </div>
            ))}
          </div>
        </section>

        <section className="border border-border bg-surface2 p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-secondary text-xs font-mono tracking-wider">DETAILS</span>
            <div className="flex items-center gap-2">
              <button
                className={`text-xs font-mono border px-2 py-1 transition-colors
                  ${flash === 'watchlist' ? 'bg-green text-bg border-green' : 'text-secondary border-border hover:text-primary hover:border-primary'}`}
                onClick={() => {
                  if (!selected) return
                  addSymbol(selected.symbol)
                  setFlash('watchlist')
                  setTimeout(() => setFlash(null), 900)
                }}
                disabled={!selected}
              >
                {flash === 'watchlist' ? 'Added' : 'Add to Watchlist'}
              </button>
              <button
                className={`text-xs font-mono border px-2 py-1 transition-colors
                  ${flash === 'export' ? 'bg-green text-bg border-green' : 'text-orange border-orange hover:bg-orange hover:text-bg'}`}
                onClick={exportToSheet}
                disabled={!quote}
                title={`Export to spreadsheet at ${sheetAnchor}`}
              >
                {flash === 'export' ? 'Exported' : `Export → Sheet (${sheetAnchor})`}
              </button>
            </div>
          </div>
          {!quote && <div className="text-secondary text-xs font-mono">Select a symbol to view details.</div>}
          {quote && (
            <div className="space-y-1">
              <div className="text-primary text-sm font-mono font-semibold">
                {quote.longName ?? quote.shortName ?? quote.symbol}
              </div>
              <div className="text-secondary text-xs font-mono">{quote.symbol}</div>
              <div className="mt-2 space-y-1">
                {info?.map((row) => (
                  <div key={row[0]} className="flex items-center justify-between text-xs font-mono border-b border-border/60 py-1">
                    <span className="text-secondary">{row[0]}</span>
                    <span className="text-primary">{row[1]}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {selected && (
          <section className="border border-border bg-surface2 p-3">
            <div className="text-secondary text-xs font-mono mb-2 tracking-wider">CHART</div>
            <div className="h-[360px] border border-border">
              <OHLCVChart symbol={selected.symbol} indicators={indicators} onIndicatorsChange={setIndicators} />
            </div>
          </section>
        )}

        {selected && (
          <section className="border border-border bg-surface2 overflow-hidden" style={{ height: '420px' }}>
            <NewsFeed symbol={selected.symbol} />
          </section>
        )}
      </div>
      </div>
    </div>
  )
}
