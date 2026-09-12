import type { OHLCVBar } from '../types'

// Client half of the Börsdata integration. The API key lives on the dev
// server; everything here goes through /bd/*.
//
// The whole instrument universe (~18k Nordic + Global rows) is small enough to
// pull once and keep in memory, so symbol lookup and search are local and
// instant — no request per keystroke.

export interface Instrument {
  insId: number
  name: string
  urlName: string
  isin: string | null
  ticker: string | null
  yahoo: string | null
  global: boolean
  market: string | null
  sector: string | null
  branch: string | null
  country: string | null
  stockPriceCurrency: string | null
  reportCurrency: string | null
  listingDate: string | null
}

export interface BDPrice {
  d: string
  o: number
  h: number
  l: number
  c: number
  v: number
}

interface Index {
  list: Instrument[]
  byInsId: Map<number, Instrument>
  bySymbol: Map<string, Instrument>
}

let indexPromise: Promise<Index> | null = null

function keysFor(inst: Instrument): string[] {
  const keys: string[] = []
  const push = (s: string | null) => {
    const up = s?.trim().toUpperCase()
    if (up) keys.push(up)
  }
  push(inst.yahoo)
  push(inst.ticker)
  push(inst.isin)
  if (inst.yahoo) {
    const dot = inst.yahoo.indexOf('.')
    if (dot > 0) push(inst.yahoo.slice(0, dot))
  }
  if (inst.ticker) push(inst.ticker.replace(/\s+/g, '-'))
  return keys
}

/** Load (once) and memoise the instrument universe. */
export function loadInstruments(): Promise<Index> {
  if (indexPromise) return indexPromise
  indexPromise = (async () => {
    const res = await fetch('/bd/instruments')
    if (!res.ok) throw new Error(`Börsdata instruments HTTP ${res.status}`)
    const data = await res.json()
    const list: Instrument[] = Array.isArray(data?.instruments) ? data.instruments : []
    const byInsId = new Map<number, Instrument>()
    const bySymbol = new Map<string, Instrument>()
    for (const inst of list) {
      byInsId.set(inst.insId, inst)
      for (const key of keysFor(inst)) {
        const existing = bySymbol.get(key)
        if (!existing || (existing.global && !inst.global)) bySymbol.set(key, inst)
      }
    }
    return { list, byInsId, bySymbol }
  })().catch(err => {
    indexPromise = null // let a later call retry
    throw err
  })
  return indexPromise
}

/** Yahoo symbol, plain ticker or ISIN → instrument, or null if unknown. */
export async function resolveSymbol(symbol: string): Promise<Instrument | null> {
  if (!symbol.trim()) return null
  const idx = await loadInstruments()
  return idx.bySymbol.get(symbol.trim().toUpperCase()) ?? null
}

export async function resolveSymbols(symbols: string[]): Promise<Map<string, Instrument>> {
  const idx = await loadInstruments()
  const out = new Map<string, Instrument>()
  for (const s of symbols) {
    const hit = idx.bySymbol.get(s.trim().toUpperCase())
    if (hit) out.set(s, hit)
  }
  return out
}

/**
 * Local search over the universe. Exact ticker beats prefix beats substring,
 * and Nordic beats Global at equal score, so "VOLV" surfaces Volvo B before an
 * incidental substring match in a US small cap.
 */
export async function searchInstruments(query: string, limit = 12): Promise<Instrument[]> {
  const q = query.trim().toUpperCase()
  if (!q) return []
  const idx = await loadInstruments()

  const scored: Array<{ inst: Instrument; score: number }> = []
  for (const inst of idx.list) {
    const ticker = (inst.ticker ?? '').toUpperCase()
    const yahoo = (inst.yahoo ?? '').toUpperCase()
    const name = inst.name.toUpperCase()

    let score = -1
    if (ticker === q || yahoo === q) score = 0
    else if (ticker.startsWith(q) || yahoo.startsWith(q)) score = 1
    else if (name.startsWith(q)) score = 2
    else if (name.includes(q)) score = 3
    else if (ticker.includes(q)) score = 4
    if (score < 0) continue

    scored.push({ inst, score: score * 2 + (inst.global ? 1 : 0) })
  }

  scored.sort((a, b) => a.score - b.score || a.inst.name.localeCompare(b.inst.name))
  return scored.slice(0, limit).map(s => s.inst)
}

function toBars(prices: BDPrice[]): OHLCVBar[] {
  return prices
    .filter(p => p && p.c != null && Number.isFinite(p.c))
    .map(p => ({
      time: new Date(`${p.d}T00:00:00Z`).toISOString(),
      open: p.o,
      high: p.h,
      low: p.l,
      close: p.c,
      volume: p.v,
    }))
}

/** Daily OHLCV history. Börsdata is end-of-day only — there are no intraday bars. */
export async function fetchDailyBars(
  insId: number,
  opts: { from?: string; to?: string; maxCount?: number } = {},
): Promise<OHLCVBar[]> {
  const params = new URLSearchParams({ insId: String(insId) })
  if (opts.from) params.set('from', opts.from)
  if (opts.to) params.set('to', opts.to)
  if (opts.maxCount) params.set('maxCount', String(opts.maxCount))
  const res = await fetch(`/bd/prices?${params}`)
  if (!res.ok) throw new Error(`Börsdata prices HTTP ${res.status}`)
  const data = await res.json()
  return toBars(data?.stockPricesList ?? [])
}

export interface LastPrice extends BDPrice { i: number }

/** Last close for a set of instruments, served out of one bulk upstream call. */
export async function fetchLastPrices(insIds: number[]): Promise<Map<number, LastPrice>> {
  if (insIds.length === 0) return new Map()
  const idx = await loadInstruments()
  const wantGlobal = insIds.some(id => idx.byInsId.get(id)?.global)
  const wantNordic = insIds.some(id => idx.byInsId.get(id)?.global === false)

  const calls: Array<Promise<LastPrice[]>> = []
  const get = async (global: boolean) => {
    const res = await fetch(`/bd/last?global=${global ? 1 : 0}`)
    if (!res.ok) throw new Error(`Börsdata last HTTP ${res.status}`)
    const data = await res.json()
    return (data?.stockPricesList ?? []) as LastPrice[]
  }
  if (wantNordic) calls.push(get(false))
  if (wantGlobal) calls.push(get(true))

  const wanted = new Set(insIds)
  const out = new Map<number, LastPrice>()
  for (const batch of await Promise.all(calls)) {
    for (const p of batch) if (wanted.has(p.i)) out.set(p.i, p)
  }
  return out
}

// ── Fundamentals ────────────────────────────────────────────────────────────
export interface KpiMeta {
  kpiId: number
  nameSv: string
  nameEn: string
  format: string | null
  isString: boolean
}

let kpiMetaPromise: Promise<Map<number, KpiMeta>> | null = null

export function loadKpiMetadata(): Promise<Map<number, KpiMeta>> {
  if (kpiMetaPromise) return kpiMetaPromise
  kpiMetaPromise = (async () => {
    const res = await fetch('/bd/kpi/metadata')
    if (!res.ok) throw new Error(`Börsdata KPI metadata HTTP ${res.status}`)
    const data = await res.json()
    const rows: KpiMeta[] = data?.kpiHistoryMetadatas ?? []
    return new Map(rows.map(r => [r.kpiId, r]))
  })().catch(err => {
    kpiMetaPromise = null
    throw err
  })
  return kpiMetaPromise
}

export async function fetchKpi(
  insId: number,
  kpiId: number,
  group = 'last',
  calc = 'latest',
): Promise<number | null> {
  const params = new URLSearchParams({ insId: String(insId), kpiId: String(kpiId), group, calc })
  const res = await fetch(`/bd/kpi?${params}`)
  if (!res.ok) return null
  const data = await res.json()
  const n = data?.value?.n
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

export interface Report {
  year: number
  period: number
  revenues: number | null
  operating_Income: number | null
  profit_To_Equity_Holders: number | null
  earnings_Per_Share: number | null
  dividend: number | null
  total_Assets: number | null
  total_Equity: number | null
  net_Debt: number | null
  free_Cash_Flow: number | null
  number_Of_Shares: number | null
  currency: string | null
  report_End_Date: string | null
}

export type ReportType = 'year' | 'quarter' | 'r12'

export async function fetchReports(
  insId: number,
  type: ReportType = 'r12',
  maxCount = 12,
): Promise<Report[]> {
  const params = new URLSearchParams({ insId: String(insId), type, maxCount: String(maxCount) })
  const res = await fetch(`/bd/reports?${params}`)
  if (!res.ok) throw new Error(`Börsdata reports HTTP ${res.status}`)
  const data = await res.json()
  return (data?.reports ?? []) as Report[]
}

// ── Market movers ───────────────────────────────────────────────────────────
export interface Mover {
  insId: number
  date: string
  close: number
  open: number
  high: number
  low: number
  previousClose: number | null
  changePct: number | null
  /** Millions of the instrument's report currency. */
  marketCap: number | null
  volume: number
}

export interface MoversSnapshot {
  asOf: string | null
  previousDate: string | null
  movers: Mover[]
}

const moversCache = new Map<boolean, Promise<MoversSnapshot>>()

/** Day-over-day move and market cap for every instrument, in one request. */
export function fetchMovers(global: boolean): Promise<MoversSnapshot> {
  const hit = moversCache.get(global)
  if (hit) return hit
  const task = (async () => {
    const res = await fetch(`/bd/movers?global=${global ? 1 : 0}`)
    if (!res.ok) throw new Error(`Börsdata movers HTTP ${res.status}`)
    return (await res.json()) as MoversSnapshot
  })().catch(err => {
    moversCache.delete(global)
    throw err
  })
  moversCache.set(global, task)
  return task
}

/**
 * Change % and market cap keyed by the caller's own symbols. Pulls both halves
 * of the universe only when the symbol list actually spans them.
 */
export async function fetchMoversBySymbol(
  symbols: string[],
): Promise<Record<string, { marketCap: number; changePct: number }>> {
  const instruments = await resolveSymbols(symbols)
  if (instruments.size === 0) return {}

  const needGlobal = [...instruments.values()].some(i => i.global)
  const needNordic = [...instruments.values()].some(i => !i.global)

  const snapshots = await Promise.all([
    needNordic ? fetchMovers(false) : Promise.resolve(null),
    needGlobal ? fetchMovers(true) : Promise.resolve(null),
  ])

  const byInsId = new Map<number, Mover>()
  for (const snap of snapshots) {
    if (!snap) continue
    for (const m of snap.movers) byInsId.set(m.insId, m)
  }

  const out: Record<string, { marketCap: number; changePct: number }> = {}
  for (const [symbol, inst] of instruments) {
    const mover = byInsId.get(inst.insId)
    if (!mover) continue
    out[symbol] = {
      marketCap: mover.marketCap ?? 0,
      changePct: mover.changePct ?? 0,
    }
  }
  return out
}
