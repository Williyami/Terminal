export interface Quote {
  symbol: string
  name: string
  last: number
  change: number
  changePct: number
  bid?: number
  ask?: number
  volume?: number
  high?: number
  low?: number
  open?: number
}

export interface OHLCVBar {
  time: string   // ISO date string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface NewsItem {
  id: string
  time: string       // HH:MM
  source: string
  headline: string
  sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL'
  url?: string
}

export interface MacroData {
  label: string
  value: number | null
  change?: number
  changePct?: number
  unit?: string
}
