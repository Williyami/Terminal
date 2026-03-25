import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { DEFAULT_SYMBOLS } from '../hooks/useQuotes'

interface WatchlistContextValue {
  symbols: string[]
  addSymbol: (sym: string) => void
  removeSymbol: (sym: string) => void
}

const WatchlistContext = createContext<WatchlistContextValue | null>(null)

const STORAGE_KEY = 'watchlist.symbols'

export function WatchlistProvider({ children }: { children: ReactNode }) {
  const [symbols, setSymbols] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return DEFAULT_SYMBOLS
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.length > 0) return parsed
    } catch {
      // ignore
    }
    return DEFAULT_SYMBOLS
  })

  const addSymbol = (sym: string) => {
    const s = sym.trim().toUpperCase()
    if (!s) return
    setSymbols(prev => (prev.includes(s) ? prev : [...prev, s]))
  }

  const removeSymbol = (sym: string) => {
    const s = sym.trim().toUpperCase()
    setSymbols(prev => prev.filter(p => p !== s))
  }

  const value = useMemo(() => ({ symbols, addSymbol, removeSymbol }), [symbols])
  return <WatchlistContext.Provider value={value}>{children}</WatchlistContext.Provider>
}

export function usePersistWatchlist(symbols: string[]) {
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(symbols))
    } catch {
      // ignore
    }
  }, [symbols])
}

export function useWatchlist() {
  const ctx = useContext(WatchlistContext)
  if (!ctx) throw new Error('useWatchlist must be used within WatchlistProvider')
  return ctx
}
