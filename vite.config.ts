import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { WebSocket } from 'ws'
import { borsdataProxyPlugin } from './server/borsdata'

const YF_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const YF_HEADERS = { 'User-Agent': YF_UA, 'Accept': 'application/json' }

interface OpenSkyToken { accessToken: string; expiresAt: number }
let _openSkyToken: OpenSkyToken | null = null

async function getOpenSkyToken(env: Record<string, string>) {
  if (_openSkyToken && Date.now() < _openSkyToken.expiresAt - 60_000) return _openSkyToken.accessToken
  const clientId = env.OPENSKY_CLIENT_ID
  const clientSecret = env.OPENSKY_CLIENT_SECRET
  if (!clientId || !clientSecret) return null

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  })

  const res = await fetch('https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const json = await res.json() as { access_token?: string; expires_in?: number }
  if (!res.ok || !json?.access_token) {
    throw new Error(`OpenSky token error: ${res.status}`)
  }
  const expiresIn = Number(json.expires_in ?? 3600)
  _openSkyToken = { accessToken: String(json.access_token), expiresAt: Date.now() + expiresIn * 1000 }
  return _openSkyToken.accessToken
}

// ── Yahoo Finance crumb session (server-side, refreshed hourly) ──────────────
interface YFSession { cookie: string; crumb: string; ts: number }
let _session: YFSession | null = null

/** Follow redirects manually so Set-Cookie headers from every hop are captured */
async function fetchCollectingCookies(startUrl: string): Promise<string> {
  const jar: string[] = []
  let url = startUrl

  for (let i = 0; i < 8; i++) {
    const res = await fetch(url, {
      headers: {
        'User-Agent': YF_UA,
        'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cookie': jar.map(c => c.split(';')[0]).join('; '),
      },
      redirect: 'manual',
    })

    // Collect cookies from this hop
    const sc: string[] = (res.headers as any).getSetCookie?.() ??
      [res.headers.get('set-cookie')].filter(Boolean) as string[]
    jar.push(...sc)

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location') ?? ''
      url = loc.startsWith('http') ? loc : new URL(loc, url).href
    } else {
      break
    }
  }

  const cookie = jar.map(c => c.split(';')[0].trim()).filter(Boolean).join('; ')
  console.log(`[YF] cookies collected (${jar.length} hops): ${cookie.slice(0, 100)}`)
  return cookie
}

async function getYFSession(): Promise<YFSession> {
  if (_session && Date.now() - _session.ts < 3_600_000) return _session

  const cookie = await fetchCollectingCookies('https://finance.yahoo.com')

  const r2 = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
    headers: { 'User-Agent': YF_UA, Accept: '*/*', Cookie: cookie },
  })
  const crumb = (await r2.text()).trim()
  console.log(`[YF] crumb status=${r2.status} value="${crumb}"`)

  if (!crumb || crumb.startsWith('<') || crumb.startsWith('{')) {
    throw new Error(`Invalid crumb: "${crumb.slice(0, 60)}"`)
  }

  _session = { cookie, crumb, ts: Date.now() }
  return _session
}

// ── Vite plugin: /yf-options/<SYMBOL>?date=<unix> ───────────────────────────
function yahooOptionsPlugin(): Plugin {
  async function handle(req: IncomingMessage, res: ServerResponse) {
    try {
      let { cookie, crumb } = await getYFSession()
      const reqUrl = new URL(req.url!, 'http://localhost')
      const symbol = reqUrl.pathname.replace(/^\//, '')
      const date   = reqUrl.searchParams.get('date') ?? ''

      const buildUrl = (c: string) => {
        let u = `https://query2.finance.yahoo.com/v8/finance/options/${symbol}?crumb=${encodeURIComponent(c)}`
        if (date) u += `&date=${date}`
        return u
      }

      let yfRes = await fetch(buildUrl(crumb), {
        headers: { 'User-Agent': YF_UA, Cookie: cookie, Accept: 'application/json' },
      })

      // On auth failure, refresh session once and retry
      if (yfRes.status === 401 || yfRes.status === 403) {
        _session = null
        ;({ cookie, crumb } = await getYFSession())
        yfRes = await fetch(buildUrl(crumb), {
          headers: { 'User-Agent': YF_UA, Cookie: cookie, Accept: 'application/json' },
        })
      }

      // Read body exactly once
      const body = await yfRes.text()
      console.log(`[YF Options] ${symbol} → ${yfRes.status}`)
      if (!yfRes.ok) console.error(`[YF Options] error body: ${body.slice(0, 200)}`)

      res.writeHead(yfRes.status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
      res.end(body)
    } catch (e) {
      console.error('[YF Options]', e)
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: String(e) }))
    }
  }

  return {
    name: 'yahoo-options',
    configureServer(server) {
      server.middlewares.use('/yf-options', handle)
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  function aisStreamPluginWithEnv(): Plugin {
    async function handle(req: IncomingMessage, res: ServerResponse) {
      const apiKey = env.AISSTREAM_API_KEY
      if (!apiKey) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'Access-Control-Allow-Origin': '*',
        })
        res.write(`event: error\ndata: ${JSON.stringify({ error: 'Missing AISSTREAM_API_KEY' })}\n\n`)
        res.end()
        return
      }

      const reqUrl = new URL(req.url!, 'http://localhost')
      const latMin = Number(reqUrl.searchParams.get('latMin') ?? '-90')
      const latMax = Number(reqUrl.searchParams.get('latMax') ?? '90')
      const lonMin = Number(reqUrl.searchParams.get('lonMin') ?? '-180')
      const lonMax = Number(reqUrl.searchParams.get('lonMax') ?? '180')

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      })

      const ws = new WebSocket('wss://stream.aisstream.io/v0/stream')
      const keepAlive = setInterval(() => res.write(':\n\n'), 15000)

      ws.on('open', () => {
        const payload = {
          APIKey: apiKey,
          Apikey: apiKey,
          BoundingBoxes: [[[latMin, lonMin], [latMax, lonMax]]],
          FilterMessageTypes: ['PositionReport'],
        }
        ws.send(JSON.stringify(payload))
      })

      ws.on('message', (data) => {
        res.write(`data: ${data.toString()}\n\n`)
      })

      ws.on('close', () => {
        clearInterval(keepAlive)
        res.end()
      })

      ws.on('error', (err) => {
        clearInterval(keepAlive)
        res.write(`event: error\ndata: ${JSON.stringify({ error: String(err) })}\n\n`)
        res.end()
      })

      req.on('close', () => {
        clearInterval(keepAlive)
        ws.close()
      })
    }

    return {
      name: 'aisstream-proxy',
      configureServer(server) {
        server.middlewares.use('/ais/stream', handle)
      },
    }
  }

  return {
    plugins: [
      react(),
      yahooOptionsPlugin(),
      yahooSearchPlugin(),
      yahooQuoteLitePlugin(),
      yahooQuotePlugin(),
      sp500FreeProxyPlugin(),
      fmpProxyPlugin(env),
      aisStreamPluginWithEnv(),
      openSkyProxyPlugin(env),
      aishubProxyPlugin(env),
      gnewsProxyPlugin(env),
      borsdataProxyPlugin(env),
    ],
    server: {
      host: true,
      port: 5173,
      proxy: {
        '/yf/q1': {
          target: 'https://query1.finance.yahoo.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/yf\/q1/, ''),
          headers: YF_HEADERS,
        },
        '/yf/q2': {
          target: 'https://query2.finance.yahoo.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/yf\/q2/, ''),
          headers: YF_HEADERS,
        },
      },
    },
  }
})

// ── Vite plugin: /opensky proxy (OAuth2 or fallback) ─────────────────────────
function openSkyProxyPlugin(env: Record<string, string>): Plugin {
  async function handle(req: IncomingMessage, res: ServerResponse) {
    try {
      const url = new URL(req.url!, 'http://localhost')
      const targetUrl = `https://opensky-network.org${url.pathname.replace(/^\/opensky/, '')}${url.search}`

      const headers: Record<string, string> = {
        Accept: 'application/json',
        'User-Agent': YF_UA,
      }
      const token = await getOpenSkyToken(env)
      if (token) {
        headers.Authorization = `Bearer ${token}`
      } else if (env.OPENSKY_USER && env.OPENSKY_PASS) {
        const basic = Buffer.from(`${env.OPENSKY_USER}:${env.OPENSKY_PASS}`).toString('base64')
        headers.Authorization = `Basic ${basic}`
      }

      const upstream = await fetch(targetUrl, { headers })
      const body = await upstream.text()
      res.writeHead(upstream.status, {
        'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
        'Access-Control-Allow-Origin': '*',
      })
      res.end(body)
    } catch (e) {
      console.error('[OpenSky Proxy]', e)
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: String(e) }))
    }
  }

  return {
    name: 'opensky-proxy',
    configureServer(server) {
      server.middlewares.use('/opensky', handle)
    },
  }
}

// ── Vite plugin: /aishub proxy (optional ship details) ──────────────────────
function aishubProxyPlugin(env: Record<string, string>): Plugin {
  async function handle(req: IncomingMessage, res: ServerResponse) {
    try {
      const username = env.AISHUB_USERNAME
      if (!username) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Missing AISHUB_USERNAME' }))
        return
      }
      const url = new URL(req.url!, 'http://localhost')
      const mmsi = url.searchParams.get('mmsi')
      if (!mmsi) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Missing mmsi' }))
        return
      }

      const target = `https://data.aishub.net/ws.php?username=${encodeURIComponent(username)}&format=1&output=json&compress=0&mmsi=${encodeURIComponent(mmsi)}`
      const upstream = await fetch(target)
      const body = await upstream.text()
      res.writeHead(upstream.status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
      res.end(body)
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: String(e) }))
    }
  }
  return {
    name: 'aishub-proxy',
    configureServer(server) {
      server.middlewares.use('/aishub', handle)
    },
  }
}

// ── Vite plugin: /gnews proxy (optional news source) ────────────────────────
function gnewsProxyPlugin(env: Record<string, string>): Plugin {
  async function handle(req: IncomingMessage, res: ServerResponse) {
    try {
      const apiKey = env.GNEWS_API_KEY
      if (!apiKey) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Missing GNEWS_API_KEY' }))
        return
      }
      const url = new URL(req.url!, 'http://localhost')
      const q = url.searchParams.get('q') ?? ''
      const lang = url.searchParams.get('lang') ?? 'en'
      const max = url.searchParams.get('max') ?? '10'
      const target = `https://gnews.io/api/v4/search?q=${encodeURIComponent(q)}&lang=${encodeURIComponent(lang)}&max=${encodeURIComponent(max)}&apikey=${encodeURIComponent(apiKey)}`
      const upstream = await fetch(target)
      const body = await upstream.text()
      res.writeHead(upstream.status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
      res.end(body)
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: String(e) }))
    }
  }

  return {
    name: 'gnews-proxy',
    configureServer(server) {
      server.middlewares.use('/gnews', handle)
    },
  }
}

// ── Vite plugin: /sp500/free (free S&P 500 constituents CSV) ───────────────
function sp500FreeProxyPlugin(): Plugin {
  async function handle(req: IncomingMessage, res: ServerResponse) {
    try {
      const url = new URL(req.url!, 'http://localhost')
      const file = url.searchParams.get('file') ?? 'constituents'
      const target = file === 'financials'
        ? 'https://datahub.io/core/s-and-p-500-companies-financials/_r/-/data/constituents-financials.csv'
        : 'https://datahub.io/core/s-and-p-500-companies/_r/-/data/constituents.csv'
      const upstream = await fetch(target)
      const body = await upstream.text()
      res.writeHead(upstream.status, { 'Content-Type': 'text/csv', 'Access-Control-Allow-Origin': '*' })
      res.end(body)
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: String(e) }))
    }
  }
  return {
    name: 'sp500-free',
    configureServer(server) {
      server.middlewares.use('/sp500/free', handle)
    },
  }
}

// ── Vite plugin: /fmp proxy (S&P 500 treemap) ───────────────────────────────
function fmpProxyPlugin(env: Record<string, string>): Plugin {
  async function handle(req: IncomingMessage, res: ServerResponse) {
    try {
      const apiKey = env.FMP_API_KEY
      if (!apiKey) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Missing FMP_API_KEY' }))
        return
      }
      const url = new URL(req.url!, 'http://localhost')
      const path = url.pathname.replace(/^\/fmp/, '')
      let target = ''
      if (path === '/sp500') {
        target = `https://financialmodelingprep.com/stable/sp500-constituent?apikey=${encodeURIComponent(apiKey)}`
      } else if (path === '/quote') {
        const symbols = url.searchParams.get('symbol') ?? ''
        target = `https://financialmodelingprep.com/stable/quote?symbol=${encodeURIComponent(symbols)}&apikey=${encodeURIComponent(apiKey)}`
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Unknown FMP path' }))
        return
      }
      const upstream = await fetch(target)
      const body = await upstream.text()
      res.writeHead(upstream.status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
      res.end(body)
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: String(e) }))
    }
  }
  return {
    name: 'fmp-proxy',
    configureServer(server) {
      server.middlewares.use('/fmp', handle)
    },
  }
}

// ── Vite plugin: /yf-search (Yahoo Finance search with cookie/crumb) ─────────
function yahooSearchPlugin(): Plugin {
  async function handle(req: IncomingMessage, res: ServerResponse) {
    try {
      const reqUrl = new URL(req.url!, 'http://localhost')
      const params = new URLSearchParams(reqUrl.searchParams)
      // Attempt no-crumb search first (often works)
      const targetNoCrumb = `https://query1.finance.yahoo.com/v1/finance/search?${params.toString()}`
      let upstream = await fetch(targetNoCrumb, {
        headers: { 'User-Agent': YF_UA, Accept: 'application/json' },
      })

      // Fallback to crumb+cookie if blocked
      if (!upstream.ok) {
        const { cookie, crumb } = await getYFSession()
        if (!params.has('crumb')) params.set('crumb', crumb)
        const target = `https://query2.finance.yahoo.com/v1/finance/search?${params.toString()}`
        upstream = await fetch(target, {
          headers: { 'User-Agent': YF_UA, Cookie: cookie, Accept: 'application/json' },
        })
      }

      const body = await upstream.text()
      res.writeHead(upstream.status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
      res.end(body)
    } catch (e) {
      console.error('[YF Search]', e)
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: String(e) }))
    }
  }
  return {
    name: 'yahoo-search',
    configureServer(server) {
      server.middlewares.use('/yf-search', handle)
    },
  }
}

// ── Vite plugin: /yf-quote-lite (no-crumb quote batch) ───────────────────────
function yahooQuoteLitePlugin(): Plugin {
  async function handle(req: IncomingMessage, res: ServerResponse) {
    try {
      const reqUrl = new URL(req.url!, 'http://localhost')
      const params = new URLSearchParams(reqUrl.searchParams)
      const target = `https://query1.finance.yahoo.com/v7/finance/quote?${params.toString()}`
      const upstream = await fetch(target, {
        headers: { 'User-Agent': YF_UA, Accept: 'application/json' },
      })
      const body = await upstream.text()
      res.writeHead(upstream.status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
      res.end(body)
    } catch (e) {
      console.error('[YF Quote Lite]', e)
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: String(e) }))
    }
  }
  return {
    name: 'yahoo-quote-lite',
    configureServer(server) {
      server.middlewares.use('/yf-quote-lite', handle)
    },
  }
}

// ── Vite plugin: /yf-quote (Yahoo Finance quote endpoint) ───────────────────
function yahooQuotePlugin(): Plugin {
  async function handle(req: IncomingMessage, res: ServerResponse) {
    try {
      const reqUrl = new URL(req.url!, 'http://localhost')
      const params = new URLSearchParams(reqUrl.searchParams)

      // Try without cookie/crumb first
      const targetNoCrumb = `https://query1.finance.yahoo.com/v7/finance/quote?${params.toString()}`
      let upstream = await fetch(targetNoCrumb, {
        headers: { 'User-Agent': YF_UA, Accept: 'application/json' },
      })

      // Fallback to cookie/crumb if blocked
      if (!upstream.ok) {
        const { cookie, crumb } = await getYFSession()
        if (!params.has('crumb')) params.set('crumb', crumb)
        const target = `https://query1.finance.yahoo.com/v7/finance/quote?${params.toString()}`
        upstream = await fetch(target, {
          headers: { 'User-Agent': YF_UA, Cookie: cookie, Accept: 'application/json' },
        })
      }

      const body = await upstream.text()
      res.writeHead(upstream.status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
      res.end(body)
    } catch (e) {
      console.error('[YF Quote]', e)
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: String(e) }))
    }
  }
  return {
    name: 'yahoo-quote',
    configureServer(server) {
      server.middlewares.use('/yf-quote', handle)
    },
  }
}
