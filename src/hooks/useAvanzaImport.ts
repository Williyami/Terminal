import { useState, useCallback } from 'react'
import { parseAvanzaCsv, aggregateTransactions, type ImportResult } from '../utils/avanzaParser'

export type ImportState = 'idle' | 'parsing' | 'done' | 'error'

export function useAvanzaImport() {
  const [state, setState] = useState<ImportState>('idle')
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string>('')

  const importFile = useCallback((file: File) => {
    setState('parsing')
    setError(null)
    setFileName(file.name)

    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string
        const txns = parseAvanzaCsv(text)
        if (txns.length === 0) throw new Error('No transactions found — check the file format')
        const res = aggregateTransactions(txns)
        setResult(res)
        setState('done')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Parse error')
        setState('error')
      }
    }
    reader.onerror = () => {
      setError('Failed to read file')
      setState('error')
    }
    reader.readAsText(file, 'utf-8')
  }, [])

  const reset = useCallback(() => {
    setState('idle')
    setResult(null)
    setError(null)
    setFileName('')
  }, [])

  return { state, result, error, fileName, importFile, reset }
}
