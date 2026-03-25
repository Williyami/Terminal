import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

interface SpreadsheetContextValue {
  cells: Record<string, string>
  setCells: React.Dispatch<React.SetStateAction<Record<string, string>>>
  activeCell: string
  setActiveCell: (id: string) => void
}

const SpreadsheetContext = createContext<SpreadsheetContextValue | null>(null)

export function SpreadsheetProvider({ children }: { children: ReactNode }) {
  const [cells, setCells] = useState<Record<string, string>>({})
  const [activeCell, setActiveCell] = useState('A1')

  const value = useMemo(() => ({ cells, setCells, activeCell, setActiveCell }), [cells, activeCell])
  return <SpreadsheetContext.Provider value={value}>{children}</SpreadsheetContext.Provider>
}

export function useSpreadsheet() {
  const ctx = useContext(SpreadsheetContext)
  if (!ctx) throw new Error('useSpreadsheet must be used within SpreadsheetProvider')
  return ctx
}
