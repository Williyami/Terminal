import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'

// ── Börsdata API v1 ─────────────────────────────────────────────────────────
// Docs: https://github.com/Borsdata-Sweden/API
//
// The key stays on this side of the wire — the browser talks to /bd/* and never
// sees authKey. Börsdata allows 100 calls / 10s, so every upstream call goes
// through a shared token bucket and an in-memory cache keyed by the upstream
// URL. The instrument index (Nordic + Global, ~18k rows) is fetched once and
// reused to translate the Yahoo symbols the rest of the app is built around.

const BASE = 'https://apiservice.borsdata.se/v1'

const RATE_WINDOW_MS = 10_000
const RATE_MAX_CALLS = 90 // 100 is the documented ceiling; leave headroom

const TTL = {
  instruments: 12 * 60 * 60_000,
  meta: 24 * 60 * 60_000,
  kpiMetadata: 24 * 60 * 60_000,
  lastPrices: 60_000,
  prices: 60 * 60_000,
  reports: 6 * 60 * 60_000,
  kpi: 60 * 60_000,
} as const

// ── Rate limiter ────────────────────────────────────────────────────────────
let callTimes: number[] = []

async function rateLimit(): Promise<void> {
  for (;;) {
    const now = Date.now()
    callTimes = callTimes.filter(t => now - t < RATE_WINDOW_MS)
    if (callTimes.length < RATE_MAX_CALLS) {
      callTimes.push(now)
      return
    }
    const waitMs = RATE_WINDOW_MS - (now - callTimes[0]) + 25
    await new Promise(r => setTimeout(r, waitMs))
  }
}

// ── Cache ───────────────────────────────────────────────────────────────────
interface CacheEntry { value: unknown; expiresAt: number }
const cache = new Map<string, CacheEntry>()
const inflight = new Map<string, Promise<unknown>>()

/** Fetch an upstream path (without authKey), with caching and de-duplication. */
async function bdFetch<T>(apiKey: string, path: string, ttlMs: number): Promise<T> {
  const hit = cache.get(path)
  if (hit && Date.now() < hit.expiresAt) return hit.value as T

  const pending = inflight.get(path)
  if (pending) return pending as Promise<T>

  const task = (async () => {
    await rateLimit()
    const sep = path.includes('?') ? '&' : '?'
    const res = await fetch(`${BASE}${path}${sep}authKey=${encodeURIComponent(apiKey)}`, {
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Börsdata ${res.status} on ${path}${text ? `: ${text.slice(0, 200)}` : ''}`)
    }
    const json = await res.json()
    cache.set(path, { value: json, expiresAt: Date.now() + ttlMs })
    return json
  })()

  inflight.set(path, task)
  try {
    return (await task) as T
  } finally {
    inflight.delete(path)
  }
}

// ── Instrument index ────────────────────────────────────────────────────────
export interface BDInstrument {
  insId: number
  name: string
  urlName: string
  instrument: number
  isin: string | null
  ticker: string | null
  yahoo: string | null
  sectorId: number | null
  marketId: number | null
  branchId: number | null
  countryId: number | null
  listingDate: string | null
  stockPriceCurrency: string | null
  reportCurrency: string | null
}

/** An instrument plus the market/sector/country names resolved from /meta. */
export interface BDInstrumentEnriched extends BDInstrument {
  global: boolean
  market: string | null
  sector: string | null
  branch: string | null
  country: string | null
}

interface IndexShape {
  list: BDInstrumentEnriched[]
  byInsId: Map<number, BDInstrumentEnriched>
  bySymbol: Map<string, BDInstrumentEnriched>
  builtAt: number
}

let index: IndexShape | null = null
let indexBuild: Promise<IndexShape> | null = null

interface NamedRow { id: number; name: string }

async function fetchMeta(apiKey: string) {
  const [markets, sectors, branches, countries] = await Promise.all([
    bdFetch<{ markets: NamedRow[] }>(apiKey, '/markets', TTL.meta),
    bdFetch<{ sectors: NamedRow[] }>(apiKey, '/sectors', TTL.meta),
    bdFetch<{ branches: NamedRow[] }>(apiKey, '/branches', TTL.meta),
    bdFetch<{ countries: NamedRow[] }>(apiKey, '/countries', TTL.meta),
  ])
  return { markets, sectors, branches, countries }
}

function nameMap(rows: NamedRow[] | undefined): Map<number, string> {
  return new Map((rows ?? []).map(r => [r.id, r.name]))
}

/**
 * A symbol can arrive as a Yahoo ticker ("ERIC-B.ST"), a plain ticker
 * ("ERIC B") or an ISIN. Normalise aggressively so all three land on the
 * same key — Börsdata writes "ERIC B" where Yahoo writes "ERIC-B.ST".
 */
function symbolKeys(inst: BDInstrument): string[] {
  const keys: string[] = []
  const push = (s: string | null | undefined) => {
    if (!s) return
    const up = s.trim().toUpperCase()
    if (up) keys.push(up)
  }
  push(inst.yahoo)
  push(inst.ticker)
  push(inst.isin)
  // Yahoo symbol without its exchange suffix, and ticker with spaces as dashes
  if (inst.yahoo) {
    const dot = inst.yahoo.indexOf('.')
    if (dot > 0) push(inst.yahoo.slice(0, dot))
  }
  if (inst.ticker) push(inst.ticker.replace(/\s+/g, '-'))
  return keys
}

async function buildIndex(apiKey: string): Promise<IndexShape> {
  if (index && Date.now() - index.builtAt < TTL.instruments) return index
  if (indexBuild) return indexBuild

  indexBuild = (async () => {
    const [nordic, global, meta] = await Promise.all([
      bdFetch<{ instruments: BDInstrument[] }>(apiKey, '/instruments', TTL.instruments),
      bdFetch<{ instruments: BDInstrument[] }>(apiKey, '/instruments/global', TTL.instruments)
        .catch(() => ({ instruments: [] as BDInstrument[] })), // Global needs Pro
      fetchMeta(apiKey),
    ])

    const markets = nameMap(meta.markets?.markets)
    const sectors = nameMap(meta.sectors?.sectors)
    const branches = nameMap(meta.branches?.branches)
    const countries = nameMap(meta.countries?.countries)

    const enrich = (inst: BDInstrument, isGlobal: boolean): BDInstrumentEnriched => ({
      ...inst,
      global: isGlobal,
      market: inst.marketId != null ? markets.get(inst.marketId) ?? null : null,
      sector: inst.sectorId != null ? sectors.get(inst.sectorId) ?? null : null,
      branch: inst.branchId != null ? branches.get(inst.branchId) ?? null : null,
      country: inst.countryId != null ? countries.get(inst.countryId) ?? null : null,
    })

    const list = [
      ...(nordic.instruments ?? []).map(i => enrich(i, false)),
      ...(global.instruments ?? []).map(i => enrich(i, true)),
    ]

    const byInsId = new Map<number, BDInstrumentEnriched>()
    const bySymbol = new Map<string, BDInstrumentEnriched>()
    for (const inst of list) {
      byInsId.set(inst.insId, inst)
      for (const key of symbolKeys(inst)) {
        // Nordic wins ties — it is the better-maintained half of the dataset
        const existing = bySymbol.get(key)
        if (!existing || (existing.global && !inst.global)) bySymbol.set(key, inst)
      }
    }

    const built: IndexShape = { list, byInsId, bySymbol, builtAt: Date.now() }
    index = built
    return built
  })()

  try {
    return await indexBuild
  } finally {
    indexBuild = null
  }
}


/** Previous calendar day as YYYY-MM-DD. */
function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

interface DatedPrice { i: number; d: string; o: number; h: number; l: number; c: number; v: number }

/**
 * Day-over-day move plus market cap for the whole universe, in three upstream
 * calls rather than one per symbol. Börsdata has no bulk "change %" feed, so
 * the prior close comes from the dated bulk snapshot — walking back a few days
 * to skip weekends and holidays.
 */
async function loadMovers(apiKey: string, global: boolean) {
  const lastPath = global ? '/instruments/stockprices/global/last' : '/instruments/stockprices/last'
  const datePath = global ? '/instruments/stockprices/global/date' : '/instruments/stockprices/date'

  const last = await bdFetch<{ stockPricesList: DatedPrice[] }>(apiKey, lastPath, TTL.lastPrices)
  const latest = last.stockPricesList ?? []
  if (latest.length === 0) return { asOf: null, previousDate: null, movers: [] }

  // The feed's own latest trading date, not today's wall clock
  const asOf = latest.reduce((max, p) => (p.d > max ? p.d : max), latest[0].d)

  let prior: DatedPrice[] = []
  let previousDate: string | null = null
  for (let back = 1; back <= 7; back += 1) {
    const candidate = shiftDate(asOf, -back)
    const res = await bdFetch<{ stockPricesList: DatedPrice[] }>(
      apiKey,
      `${datePath}?date=${candidate}`,
      TTL.prices,
    )
    const rows = res.stockPricesList ?? []
    if (rows.length > 0) {
      prior = rows
      previousDate = candidate
      break
    }
  }

  const priorClose = new Map(prior.map(p => [p.i, p.c]))
  const caps = await bdFetch<{ values: Array<{ i: number; n: number | null }> }>(
    apiKey,
    '/instruments/kpis/50/last/latest',
    TTL.kpi,
  )
  const capById = new Map((caps.values ?? []).map(v => [v.i, v.n]))

  const movers = latest.map(p => {
    const prev = priorClose.get(p.i)
    const changePct = prev != null && prev !== 0 ? ((p.c - prev) / prev) * 100 : null
    return {
      insId: p.i,
      date: p.d,
      close: p.c,
      open: p.o,
      high: p.h,
      low: p.l,
      volume: p.v,
      previousClose: prev ?? null,
      changePct,
      marketCap: capById.get(p.i) ?? null,
    }
  })

  return { asOf, previousDate, movers }
}

// ── Route handlers ──────────────────────────────────────────────────────────
function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  })
  res.end(JSON.stringify(body))
}

/** Comma-separated ints from a query param, capped so one request can't fan out forever. */
function intList(raw: string | null, max = 50): number[] {
  if (!raw) return []
  return raw
    .split(',')
    .map(s => Number(s.trim()))
    .filter(n => Number.isFinite(n))
    .slice(0, max)
}

const REPORT_TYPES = new Set(['year', 'quarter', 'r12'])

export function borsdataProxyPlugin(env: Record<string, string>): Plugin {
  const apiKey = env.BORSDATA_API_KEY

  async function handle(req: IncomingMessage, res: ServerResponse) {
    if (!apiKey) {
      json(res, 200, { error: 'Missing BORSDATA_API_KEY', instruments: [], items: [] })
      return
    }

    const url = new URL(req.url!, 'http://localhost')
    const path = url.pathname.replace(/\/+$/, '') || '/'
    const q = url.searchParams

    try {
      switch (path) {
        // Full instrument universe, already enriched with market/sector names.
        case '/':
        case '/instruments': {
          const idx = await buildIndex(apiKey)
          json(res, 200, { instruments: idx.list })
          return
        }

        // Yahoo symbol / ticker / ISIN → instrument.
        case '/resolve': {
          const idx = await buildIndex(apiKey)
          const symbols = (q.get('symbol') ?? '').split(',').map(s => s.trim()).filter(Boolean)
          const out: Record<string, BDInstrumentEnriched | null> = {}
          for (const sym of symbols.slice(0, 100)) {
            out[sym] = idx.bySymbol.get(sym.toUpperCase()) ?? null
          }
          json(res, 200, { resolved: out })
          return
        }

        case '/meta': {
          const meta = await fetchMeta(apiKey)
          json(res, 200, {
            markets: meta.markets?.markets ?? [],
            sectors: meta.sectors?.sectors ?? [],
            branches: meta.branches?.branches ?? [],
            countries: meta.countries?.countries ?? [],
          })
          return
        }

        // Daily OHLCV history for one instrument.
        case '/prices': {
          const insId = Number(q.get('insId'))
          if (!Number.isFinite(insId)) { json(res, 400, { error: 'insId required' }); return }
          const params = new URLSearchParams()
          const from = q.get('from')
          const to = q.get('to')
          const maxCount = q.get('maxCount')
          if (from) params.set('from', from)
          if (to) params.set('to', to)
          if (maxCount) params.set('maxCount', maxCount)
          const suffix = params.toString() ? `?${params}` : ''
          const data = await bdFetch(apiKey, `/instruments/${insId}/stockprices${suffix}`, TTL.prices)
          json(res, 200, data)
          return
        }

        // Last close for specific instruments, served out of the one bulk call.
        case '/last': {
          const ids = intList(q.get('insId'), 500)
          const wantGlobal = q.get('global') === '1'
          const data = await bdFetch<{ stockPricesList: Array<{ i: number }> }>(
            apiKey,
            wantGlobal ? '/instruments/stockprices/global/last' : '/instruments/stockprices/last',
            TTL.lastPrices,
          )
          const all = data.stockPricesList ?? []
          json(res, 200, {
            stockPricesList: ids.length ? all.filter(p => ids.includes(p.i)) : all,
          })
          return
        }

        case '/reports': {
          const insId = Number(q.get('insId'))
          const type = (q.get('type') ?? 'r12').toLowerCase()
          if (!Number.isFinite(insId)) { json(res, 400, { error: 'insId required' }); return }
          if (!REPORT_TYPES.has(type)) { json(res, 400, { error: 'type must be year|quarter|r12' }); return }
          const maxCount = q.get('maxCount') ?? '20'
          const data = await bdFetch(
            apiKey,
            `/instruments/${insId}/reports/${type}?maxCount=${encodeURIComponent(maxCount)}`,
            TTL.reports,
          )
          json(res, 200, data)
          return
        }

        // Day-over-day change and market cap for the whole universe.
        case '/movers': {
          const data = await loadMovers(apiKey, q.get('global') === '1')
          json(res, 200, data)
          return
        }

        case '/kpi/metadata': {
          const data = await bdFetch(apiKey, '/instruments/kpis/metadata', TTL.kpiMetadata)
          json(res, 200, data)
          return
        }

        // One KPI for one instrument.
        case '/kpi': {
          const insId = Number(q.get('insId'))
          const kpiId = Number(q.get('kpiId'))
          const group = q.get('group') ?? 'last'
          const calc = q.get('calc') ?? 'latest'
          if (!Number.isFinite(insId) || !Number.isFinite(kpiId)) {
            json(res, 400, { error: 'insId and kpiId required' }); return
          }
          const data = await bdFetch(
            apiKey,
            `/instruments/${insId}/kpis/${kpiId}/${encodeURIComponent(group)}/${encodeURIComponent(calc)}`,
            TTL.kpi,
          )
          json(res, 200, data)
          return
        }

        // The same KPI across the whole universe — the screener feed.
        case '/kpi/screener': {
          const kpiId = Number(q.get('kpiId'))
          const group = q.get('group') ?? 'last'
          const calc = q.get('calc') ?? 'latest'
          if (!Number.isFinite(kpiId)) { json(res, 400, { error: 'kpiId required' }); return }
          const data = await bdFetch(
            apiKey,
            `/instruments/kpis/${kpiId}/${encodeURIComponent(group)}/${encodeURIComponent(calc)}`,
            TTL.kpi,
          )
          json(res, 200, data)
          return
        }

        default:
          json(res, 404, { error: `Unknown Börsdata path: ${path}` })
          return
      }
    } catch (e) {
      json(res, 502, { error: e instanceof Error ? e.message : String(e) })
    }
  }

  return {
    name: 'borsdata-proxy',
    configureServer(server) {
      server.middlewares.use('/bd', handle)
    },
  }
}
