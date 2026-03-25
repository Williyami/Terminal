import { useState, useEffect, useCallback } from 'react'
import type { NewsItem } from '../types'


// Simple keyword-based sentiment scoring (no API key needed)
function scoreSentiment(headline: string): NewsItem['sentiment'] {
  const h = headline.toLowerCase()
  const bull = ['beat', 'beats', 'surge', 'surges', 'rally', 'rallies', 'gains', 'record', 'upgrade',
    'strong', 'rises', 'jumps', 'soars', 'outperform', 'profit', 'growth', 'bullish', 'positive',
    'breakthrough', 'launches', 'unveils', 'wins', 'expands', 'raises']
  const bear = ['miss', 'misses', 'falls', 'drops', 'slumps', 'decline', 'declines', 'cut', 'cuts',
    'layoffs', 'recall', 'warning', 'warns', 'downturn', 'loss', 'losses', 'weak', 'concern',
    'concerns', 'bearish', 'crash', 'collapse', 'investigation', 'fine', 'penalty', 'recession']
  const bullScore = bull.filter(w => h.includes(w)).length
  const bearScore = bear.filter(w => h.includes(w)).length
  if (bullScore > bearScore) return 'BULLISH'
  if (bearScore > bullScore) return 'BEARISH'
  return 'NEUTRAL'
}

function fmtTime(dateStr: string): string {
  try {
    const d = new Date(dateStr)
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
  } catch {
    return '--:--'
  }
}

async function fetchNews(symbol: string): Promise<NewsItem[]> {
  const newsUrl = `/yf-search?q=${symbol}&newsCount=15&quotesCount=0`
  const res = await fetch(newsUrl)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  const items: NewsItem[] = (data?.news ?? []).slice(0, 12).map((n: Record<string, unknown>, i: number) => ({
    id: String(n.uuid ?? i),
    time: fmtTime(n.providerPublishTime ? new Date(Number(n.providerPublishTime) * 1000).toISOString() : ''),
    source: String(n.publisher ?? 'UNKNOWN').toUpperCase().slice(0, 12),
    headline: String(n.title ?? ''),
    sentiment: scoreSentiment(String(n.title ?? '')),
    url: String(n.link ?? ''),
  }))
  return items
}

async function fetchGNews(symbol: string): Promise<NewsItem[]> {
  const url = `/gnews/search?q=${encodeURIComponent(symbol)}&lang=en&max=10`
  const res = await fetch(url)
  if (!res.ok) return []
  const data = await res.json()
  const articles = Array.isArray(data?.articles) ? data.articles : []
  return articles.map((a: Record<string, unknown>, i: number) => ({
    id: String(a.url ?? `gnews-${i}`),
    time: fmtTime(String(a.publishedAt ?? '')),
    source: String(a?.source?.name ?? 'GNEWS').toUpperCase().slice(0, 12),
    headline: String(a.title ?? ''),
    sentiment: scoreSentiment(String(a.title ?? '')),
    url: String(a.url ?? ''),
  }))
}

export function useNews(symbol: string, intervalMs = 60000) {
  const [news, setNews] = useState<NewsItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [yahoo, gnews] = await Promise.all([
        fetchNews(symbol),
        fetchGNews(symbol),
      ])
      const merged = [...yahoo, ...gnews].slice(0, 20)
      setNews(merged)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'fetch error')
    } finally {
      setLoading(false)
    }
  }, [symbol])

  useEffect(() => {
    load()
    const id = setInterval(load, intervalMs)
    return () => clearInterval(id)
  }, [load, intervalMs])

  return { news, loading, error }
}
