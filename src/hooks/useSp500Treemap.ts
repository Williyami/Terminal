import { useEffect, useMemo, useState } from 'react'

interface Sp500Item {
  symbol: string
  name: string
  sector: string
  marketCap: number
  changePct: number
}

const STORAGE_KEY = 'sp500_caps_v1'

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    const next = text[i + 1]

    if (ch === '"') {
      if (inQuotes && next === '"') {
        cell += '"'
        i += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (ch === ',' && !inQuotes) {
      row.push(cell)
      cell = ''
      continue
    }

    if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && next === '\n') i += 1
      row.push(cell)
      if (row.some(v => v.length > 0)) rows.push(row)
      row = []
      cell = ''
      continue
    }

    cell += ch
  }

  if (cell.length > 0 || row.length) {
    row.push(cell)
    rows.push(row)
  }

  return rows
}

function parseMarketCap(raw: string): number {
  const cleaned = raw.replace(/[^0-9.]/g, '')
  const num = Number(cleaned)
  return Number.isFinite(num) ? num : 0
}

async function fetchConstituents(): Promise<Array<{ symbol: string; name: string; sector: string; marketCap: number }>> {
  let csv = ''
  try {
    const res = await fetch('/sp500/free?file=financials')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    csv = await res.text()
  } catch {
    const fallback = 'https://datahub.io/core/s-and-p-500-companies-financials/_r/-/data/constituents-financials.csv'
    const res = await fetch(fallback)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    csv = await res.text()
  }
  const rows = parseCsv(csv)
  if (!rows.length) return []
  const headers = rows[0].map(h => h.trim().toLowerCase())
  const idx = (key: string) => headers.findIndex(h => h === key)
  const symIdx = idx('symbol')
  const nameIdx = Math.max(idx('security'), idx('name'))
  const sectorIdx = Math.max(idx('gics sector'), idx('sector'))
  const capIdx = Math.max(idx('market cap'), idx('marketcap'))

  return rows.slice(1).map((r) => ({
    symbol: String(r[symIdx] ?? '').trim(),
    name: String(r[nameIdx] ?? '').trim(),
    sector: String(r[sectorIdx] ?? 'Other').trim() || 'Other',
    marketCap: capIdx >= 0 ? parseMarketCap(String(r[capIdx] ?? '')) : 0,
  })).filter(r => r.symbol)
}

async function fetchQuotes(symbols: string[]): Promise<Record<string, { marketCap: number; changePct: number }>> {
  const chunks: string[][] = []
  for (let i = 0; i < symbols.length; i += 100) chunks.push(symbols.slice(i, i + 100))
  const results: Record<string, { marketCap: number; changePct: number }> = {}
  await Promise.all(chunks.map(async (chunk) => {
    const res = await fetch(`/yf-quote?symbols=${encodeURIComponent(chunk.join(','))}`)
    if (!res.ok) return
    const data = await res.json()
    const rows = data?.quoteResponse?.result ?? []
    for (const row of (Array.isArray(rows) ? rows : [])) {
      const sym = String(row.symbol ?? '')
      const cap = Number(row.marketCap ?? 0)
      const direct = Number(row.regularMarketChangePercent ?? 0)
      const price = Number(row.regularMarketPrice ?? 0)
      const prev = Number(row.regularMarketPreviousClose ?? 0)
      const chg = Number.isFinite(direct) && direct !== 0
        ? direct
        : prev > 0
          ? ((price - prev) / prev) * 100
          : 0
      if (sym) results[sym] = { marketCap: cap || 0, changePct: chg || 0 }
    }
  }))
  return results
}

async function fetchChartChanges(symbols: string[]): Promise<Record<string, number>> {
  const results: Record<string, number> = {}
  const chunks: string[][] = []
  for (let i = 0; i < symbols.length; i += 10) chunks.push(symbols.slice(i, i + 10))
  for (const chunk of chunks) {
    await Promise.all(chunk.map(async (symbol) => {
      try {
        const res = await fetch(`/yf/q1/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d&includePrePost=false`)
        if (!res.ok) return
        const json = await res.json()
        const result = json?.chart?.result?.[0]
        const meta = result?.meta
        const closes: Array<number | null> = result?.indicators?.quote?.[0]?.close ?? []
        const nonNull = closes.filter(v => v != null) as number[]
        const last = nonNull.length ? nonNull[nonNull.length - 1] : undefined
        const prev = meta?.chartPreviousClose ?? (nonNull.length > 1 ? nonNull[nonNull.length - 2] : undefined)
        if (last != null && prev != null && prev !== 0) {
          results[symbol] = ((Number(last) - Number(prev)) / Number(prev)) * 100
        }
      } catch {
        // ignore
      }
    }))
  }
  return results
}

export function useSp500Treemap() {
  const [items, setItems] = useState<Sp500Item[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancel = false
    const cachedRaw = localStorage.getItem(STORAGE_KEY)
    const now = Date.now()
    const weekMs = 7 * 24 * 60 * 60 * 1000
    let cacheIsFresh = false
    let baseItemsRef: Sp500Item[] = []
    if (cachedRaw) {
      try {
        const cached = JSON.parse(cachedRaw) as {
          ts: number
          items: Array<{ symbol: string; name: string; sector: string; marketCap: number }>
        }
        if (Array.isArray(cached.items) && cached.items.length > 0) {
          cacheIsFresh = Number.isFinite(cached.ts) && now - cached.ts < weekMs
          baseItemsRef = cached.items.map(i => ({
            symbol: i.symbol,
            name: i.name,
            sector: i.sector,
            marketCap: i.marketCap,
            changePct: 0,
          }))
          setItems(baseItemsRef)
          setLoading(false)
        }
      } catch {
        // ignore cache parsing errors
      }
    }

    async function refreshQuotes(base: Sp500Item[]) {
      if (base.length === 0) return
      const symbols = base.map(b => b.symbol)
      const quotes = await fetchQuotes(symbols)
      let merged = base.map(b => ({
        ...b,
        changePct: quotes[b.symbol]?.changePct ?? b.changePct ?? 0,
        marketCap: b.marketCap > 0 ? b.marketCap : 1,
      }))
      const zeroSyms = merged.filter(m => !Number.isFinite(m.changePct) || m.changePct === 0)
        .sort((a, b) => b.marketCap - a.marketCap)
        .slice(0, 80)
        .map(m => m.symbol)
      if (zeroSyms.length > 0) {
        const chartMap = await fetchChartChanges(zeroSyms)
        merged = merged.map(m => ({
          ...m,
          changePct: chartMap[m.symbol] ?? m.changePct,
        }))
      }
      if (!cancel) setItems(merged)
    }

    async function load() {
      try {
        setLoading(true)
        const constituents = await fetchConstituents()
        const symbols = constituents.map(c => c.symbol)
        const quotes = await fetchQuotes(symbols)
        const merged: Sp500Item[] = constituents.map(c => {
          const cap = quotes[c.symbol]?.marketCap ?? c.marketCap ?? 0
          return {
            symbol: c.symbol,
            name: c.name,
            sector: c.sector,
            marketCap: cap > 0 ? cap : 1,
            changePct: quotes[c.symbol]?.changePct ?? 0,
          }
        })
        const zeroSyms = merged.filter(m => !Number.isFinite(m.changePct) || m.changePct === 0)
          .sort((a, b) => b.marketCap - a.marketCap)
          .slice(0, 80)
          .map(m => m.symbol)
        let mergedFinal = merged
        if (zeroSyms.length > 0) {
          const chartMap = await fetchChartChanges(zeroSyms)
          mergedFinal = merged.map(m => ({
            ...m,
            changePct: chartMap[m.symbol] ?? m.changePct,
          }))
        }
        if (!cancel) {
          baseItemsRef = mergedFinal
          setItems(mergedFinal)
          try {
            const cachePayload = {
              ts: Date.now(),
              items: mergedFinal.map(i => ({
                symbol: i.symbol,
                name: i.name,
                sector: i.sector,
                marketCap: i.marketCap,
              })),
            }
            localStorage.setItem(STORAGE_KEY, JSON.stringify(cachePayload))
          } catch {
            // ignore cache write errors
          }
          setError(null)
        }
      } catch (e) {
        if (!cancel) setError(e instanceof Error ? e.message : 'fetch error')
      } finally {
        if (!cancel) setLoading(false)
      }
    }
    if (!cacheIsFresh) {
      load()
    } else {
      refreshQuotes(baseItemsRef)
    }
    const capId = setInterval(load, weekMs)
    const quoteId = setInterval(() => refreshQuotes(baseItemsRef), 2 * 60_000)
    return () => { cancel = true; clearInterval(capId); clearInterval(quoteId) }
  }, [])

  const treemapData = useMemo(() => {
    const sorted = [...items].sort((a, b) => b.marketCap - a.marketCap).slice(0, 100)
    return {
      name: 'S&P 500',
      children: sorted.map(s => ({
        name: s.symbol,
        value: s.marketCap,
        changePct: s.changePct,
        fullName: s.name,
      })),
    }
  }, [items])

  return { treemapData, loading, error }
}
