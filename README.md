# Echelon Terminal

A market/tracking terminal built with React 19, TypeScript and Vite. Panels
cover quotes, charts, fundamentals, options, news, macro, a spreadsheet, and
live vessel/flight tracking.

## Setup

```bash
npm install
cp .env.example .env   # then fill in the keys you have
npm run dev            # http://localhost:5173
```

`npm run build` type-checks and builds; `npm run lint` runs ESLint.

## API keys

All provider keys live in `.env`, which is git-ignored and must stay that way.
Keys are read server-side in `vite.config.ts` (via `loadEnv`) and proxied, so
**no key is ever bundled into the browser**. That is why none of them use the
`VITE_` prefix — adding one would expose the key to the client.

The app degrades rather than fails: a missing key blanks one panel.

| Variable | Provider | Used for |
| --- | --- | --- |
| `BORSDATA_API_KEY` | [Börsdata](https://borsdata.se) | Instruments, prices, KPIs, reports |
| `AISSTREAM_API_KEY` | [aisstream.io](https://aisstream.io) | Live vessel positions |
| `AISHUB_USERNAME` | [AISHub](https://www.aishub.net) | Alternative AIS source |
| `OPENSKY_CLIENT_ID` / `_SECRET` | [OpenSky](https://opensky-network.org) | Flight tracking (OAuth2) |
| `FMP_API_KEY` | [FMP](https://site.financialmodelingprep.com) | S&P 500 constituents |
| `GNEWS_API_KEY` | [GNews](https://gnews.io) | News feed |

## Börsdata integration

Börsdata is the primary market-data source. A Pro key covers both the Nordic
(~1.7k) and Global (~16k) instrument universes, and every instrument carries a
`yahoo` ticker — which is how Börsdata data reaches a UI built around Yahoo
symbols.

**Server** — [server/borsdata.ts](server/borsdata.ts) mounts a `/bd/*` proxy
that holds the key, enforces Börsdata's 100-calls-per-10-seconds limit with a
token bucket, caches by upstream URL, and de-duplicates concurrent requests.

| Route | Returns |
| --- | --- |
| `/bd/instruments` | Whole universe, enriched with market/sector/branch/country names |
| `/bd/resolve?symbol=` | Yahoo symbol, ticker or ISIN → instrument |
| `/bd/prices?insId=&from=&to=` | Daily OHLCV history |
| `/bd/last?insId=&global=` | Latest close, served from one bulk call |
| `/bd/movers?global=` | Day-over-day change + market cap for every instrument |
| `/bd/reports?insId=&type=` | Income/balance/cash-flow, `year` \| `quarter` \| `r12` |
| `/bd/kpi?insId=&kpiId=&group=&calc=` | One KPI for one instrument |
| `/bd/kpi/screener?kpiId=` | One KPI across the universe |
| `/bd/kpi/metadata`, `/bd/meta` | KPI definitions; markets/sectors/branches/countries |

**Client** — [src/utils/borsdata.ts](src/utils/borsdata.ts) loads the instrument
universe once and keeps it in memory, so symbol resolution and search are local
and instant rather than a request per keystroke.

Where Börsdata is used:

- **Search** ([StockSearchPage](src/pages/StockSearchPage.tsx)) — local ranked
  match over ~18k instruments, Yahoo only as fallback for indices/ETFs/FX.
- **Fundamentals** ([FundamentalsPanel](src/components/FundamentalsPanel.tsx))
  — valuation multiples, margins, returns and the report series behind them.
  Börsdata-only; no free price feed carries this.
- **Charts** ([useChart](src/hooks/useChart.ts)) — Börsdata serves 3M/1Y/5Y from
  daily bars (5Y aggregated to weekly).
- **Treemap** ([useSp500Treemap](src/hooks/useSp500Treemap.ts)) — market cap and
  daily change for the whole index in three upstream calls.
- **Quotes** ([useQuotes](src/hooks/useQuotes.ts)) — Börsdata supplies instrument
  names and currency, and backs any symbol Yahoo fails to return.

### The one limit

**Börsdata is end-of-day only.** It publishes no intraday bars and no live
price. So the 1D/5D/1M chart ranges and live quote refresh still go to Yahoo;
Börsdata takes over wherever daily granularity is the right answer, and acts as
the fallback when Yahoo fails — which it does regularly for Nordic tickers.
