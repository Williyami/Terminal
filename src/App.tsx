import { useState, useEffect, useCallback } from 'react'
import { NavBar, type Panel } from './components/NavBar'
import { TopBar } from './components/TopBar'
import { Watchlist } from './components/Watchlist'
import { OHLCVChart } from './components/OHLCVChart'
import { NewsFeed } from './components/NewsFeed'
import { MacroPanel } from './components/MacroPanel'
import { StatusBar } from './components/StatusBar'
import { Sp500Treemap } from './components/Sp500Treemap'
import { OptionsPage } from './pages/OptionsPage'
import { FlowPage } from './pages/FlowPage'
import { PortfolioPage } from './pages/PortfolioPage'
import { TrackingPage } from './pages/TrackingPage'
import { SpreadsheetPage } from './pages/SpreadsheetPage'
import { StockSearchPage } from './pages/StockSearchPage'
import { SpreadsheetProvider } from './context/SpreadsheetContext'
import { WatchlistProvider, usePersistWatchlist, useWatchlist } from './context/WatchlistContext'
import './index.css'

export default function App() {
  const [panel, setPanel] = useState<Panel>('HOME')
  const [selectedSymbol, setSelectedSymbol] = useState('NVDA')
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)

  // Update "last update" timestamp on an interval
  useEffect(() => {
    setLastUpdate(new Date())
    const id = setInterval(() => setLastUpdate(new Date()), 30000)
    return () => clearInterval(id)
  }, [])

  // Keyboard shortcuts F1–F9
  useEffect(() => {
    const panels: Panel[] = ['HOME', 'OPTIONS', 'MACRO', 'FLOW', 'NEWS', 'PORTFOLIO', 'TRACKING', 'SPREADSHEET', 'STOCKS']
    const handler = (e: KeyboardEvent) => {
      if (e.key >= 'F1' && e.key <= 'F9') {
        e.preventDefault()
        const idx = parseInt(e.key.slice(1)) - 1
        if (panels[idx]) setPanel(panels[idx])
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const handleSelectSymbol = useCallback((sym: string) => {
    setSelectedSymbol(sym)
  }, [])

  return (
    <SpreadsheetProvider>
      <WatchlistProvider>
        <WatchlistPersist />
        <div className="flex flex-col bg-bg" style={{ height: '100vh', width: '100vw', overflow: 'hidden' }}>
        {/* Navigation bar */}
        <NavBar active={panel} onSelect={setPanel} />

        {/* Macro ticker strip */}
        <TopBar />

        {/* Main content */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left: Watchlist (home only) */}
          {panel === 'HOME' && (
            <Watchlist onSelect={handleSelectSymbol} selected={selectedSymbol} />
          )}

          {/* Center panel */}
          <div className="flex flex-col flex-1 overflow-hidden">
            {/* Top: chart area */}
            <div className="flex-1 overflow-hidden" style={{ minHeight: 0 }}>
              {panel === 'HOME' && (
                <div className="h-full flex flex-col min-h-0">
                  <div className="flex-1 min-h-0">
                    <Sp500Treemap />
                  </div>
                  <div style={{ height: '260px', minHeight: '260px' }}>
                    <NewsFeed symbol={selectedSymbol} />
                  </div>
                </div>
              )}
              {panel === 'MACRO' && (
                <div className="h-full overflow-y-auto">
                  <MacroPanel />
                </div>
              )}
              {panel === 'NEWS' && (
                <div className="h-full overflow-y-auto">
                  <NewsFeed symbol={selectedSymbol} />
                </div>
              )}
              {panel === 'OPTIONS' && <OptionsPage symbol={selectedSymbol} />}
              {panel === 'FLOW' && <FlowPage />}
              {panel === 'PORTFOLIO' && <PortfolioPage />}
              {panel === 'TRACKING' && <TrackingPage />}
              {panel === 'SPREADSHEET' && <SpreadsheetPage />}
              {panel === 'STOCKS' && <StockSearchPage />}
            </div>

            {/* Bottom: news feed handled in HOME layout */}
          </div>

          {/* Right sidebar: macro panel (always visible) */}
          <div style={{ width: '240px', minWidth: '240px' }} className="border-l border-border overflow-y-auto">
            <MacroPanel compact />
          </div>
        </div>

        {/* Status bar */}
        <StatusBar lastUpdate={lastUpdate} />
        </div>
      </WatchlistProvider>
    </SpreadsheetProvider>
  )
}

function WatchlistPersist() {
  const { symbols } = useWatchlist()
  usePersistWatchlist(symbols)
  return null
}
