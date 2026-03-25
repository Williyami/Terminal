import { useState } from 'react'
import { useNews } from '../hooks/useNews'
import type { NewsItem } from '../types'

const SENTIMENT_STYLE: Record<string, string> = {
  BULLISH: 'text-green border border-green',
  BEARISH: 'text-red border border-red',
  NEUTRAL: 'text-secondary border border-secondary',
}

interface NewsFeedProps {
  symbol: string
}

export function NewsFeed({ symbol }: NewsFeedProps) {
  const { news, loading, error } = useNews(symbol, 60000)
  const [selected, setSelected] = useState<NewsItem | null>(null)

  return (
    <div className="relative flex flex-col h-full bg-surface border-t border-border">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border">
        <span className="panel-header text-orange font-bold text-xs tracking-widest">NEWS FEED</span>
        <span className="text-secondary text-xs font-mono">AI SCORED · F6</span>
      </div>

      {/* News list */}
      <div className="flex-1 overflow-y-auto">
        {loading && Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="px-3 py-2 border-b border-border">
            <div className="skeleton h-2 w-1/3 mb-1.5 rounded-none" />
            <div className="skeleton h-3 w-full rounded-none" />
            <div className="skeleton h-3 w-4/5 mt-1 rounded-none" />
          </div>
        ))}
        {error && (
          <div className="px-3 py-2 text-red text-xs font-mono">[ERR: {error}]</div>
        )}
        {!loading && news.map(item => (
          <div
            key={item.id}
            className="px-3 py-2 border-b border-border hover:bg-surface2 cursor-pointer"
            onClick={() => setSelected(item)}
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="text-secondary text-xs font-mono">{item.time}</span>
              <span className="text-secondary text-xs font-mono">·</span>
              <span className="text-secondary text-xs font-mono tracking-wider">{item.source}</span>
            </div>
            <p className="text-primary text-xs leading-4 mb-1.5">
              {item.headline}
            </p>
            <span className={`text-xs font-mono px-1.5 py-0.5 font-bold ${SENTIMENT_STYLE[item.sentiment]}`}>
              {item.sentiment}
            </span>
          </div>
        ))}
        {!loading && news.length === 0 && !error && (
          <div className="px-3 py-2 text-secondary text-xs font-mono">[NO DATA]</div>
        )}
      </div>

      {selected && (
        <div className="absolute inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-surface border border-border w-[90%] h-[85%] flex flex-col">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border">
              <div className="text-primary text-xs font-mono">
                {selected.source} · {selected.time}
              </div>
              <div className="flex items-center gap-2">
                {selected.url && (
                  <button
                    className="text-xs font-mono text-secondary border border-border px-2 py-1"
                    onClick={() => window.open(selected.url, '_blank', 'noopener,noreferrer')}
                  >
                    Open in New Tab
                  </button>
                )}
                <button
                  className="text-xs font-mono text-orange border border-orange px-2 py-1"
                  onClick={() => setSelected(null)}
                >
                  Close
                </button>
              </div>
            </div>
            <div className="px-3 py-2 border-b border-border text-primary text-sm font-mono">
              {selected.headline}
            </div>
            <div className="flex-1 bg-bg">
              {selected.url ? (
                <iframe
                  title="Article"
                  src={selected.url}
                  className="w-full h-full"
                />
              ) : (
                <div className="p-4 text-secondary text-xs font-mono">No article URL available.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
