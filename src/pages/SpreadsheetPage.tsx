import { useMemo, useRef, useState } from 'react'
import { useSpreadsheet } from '../context/SpreadsheetContext'
import { cellId, colLabel, offsetCell, parseCell } from '../utils/sheet'

const COLS = 26
const ROWS = 80

function parseRange(range: string) {
  const [a, b] = range.split(':')
  if (!a || !b) return []
  const m1 = a.match(/^([A-Z]+)(\d+)$/)
  const m2 = b.match(/^([A-Z]+)(\d+)$/)
  if (!m1 || !m2) return []
  const c1 = m1[1].charCodeAt(0) - 65
  const r1 = Number(m1[2]) - 1
  const c2 = m2[1].charCodeAt(0) - 65
  const r2 = Number(m2[2]) - 1
  const cells: string[] = []
  const cMin = Math.min(c1, c2)
  const cMax = Math.max(c1, c2)
  const rMin = Math.min(r1, r2)
  const rMax = Math.max(r1, r2)
  for (let r = rMin; r <= rMax; r++) {
    for (let c = cMin; c <= cMax; c++) {
      cells.push(cellId(c, r))
    }
  }
  return cells
}

function toNumber(v: string | number | null | undefined) {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

export function SpreadsheetPage() {
  const { cells, setCells, activeCell, setActiveCell } = useSpreadsheet()
  const [editing, setEditing] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [rangeStart, setRangeStart] = useState<string>('A1')
  const [rangeEnd, setRangeEnd] = useState<string>('A1')
  const [isFilling, setIsFilling] = useState(false)
  const [fillAnchor, setFillAnchor] = useState<string>('A1')
  const gridRef = useRef<HTMLDivElement | null>(null)
  const cellRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  const formulaHints = [
    { key: 'SUM', desc: 'Sum of values' },
    { key: 'AVG', desc: 'Average of values' },
    { key: 'MIN', desc: 'Minimum value' },
    { key: 'MAX', desc: 'Maximum value' },
  ]

  const isFormula = editValue.startsWith('=')
  const formulaQuery = isFormula ? editValue.slice(1).toUpperCase() : ''
  const matchedHint =
    isFormula && formulaQuery.length > 0 && !formulaQuery.includes('(')
      ? formulaHints.find(h => h.key.startsWith(formulaQuery))
      : undefined

  const getRaw = (id: string) => cells[id] ?? ''

  const evalFormula = (expr: string): number => {
    let s = expr.toUpperCase()

    // Functions: SUM/AVG/MIN/MAX over ranges or comma lists
    s = s.replace(/(SUM|AVG|MIN|MAX)\(([^)]+)\)/g, (_, fn, inner) => {
      const parts = inner.split(',').flatMap((p: string) => {
        const trimmed = p.trim()
        if (trimmed.includes(':')) return parseRange(trimmed)
        return [trimmed]
      })
      const values: number[] = parts.map((ref: string) => toNumber(getValue(ref)))
      if (values.length === 0) return '0'
      if (fn === 'SUM') return String(values.reduce((a, b) => a + b, 0))
      if (fn === 'AVG') return String(values.reduce((a, b) => a + b, 0) / values.length)
      if (fn === 'MIN') return String(Math.min(...values))
      if (fn === 'MAX') return String(Math.max(...values))
      return '0'
    })

    // Replace cell refs with numbers
    s = s.replace(/([A-Z]+[0-9]+)/g, (m) => String(toNumber(getValue(m))))

    // Allow only safe characters
    if (!/^[0-9+\-*/().\s]+$/.test(s)) return NaN
    try {
      // eslint-disable-next-line no-new-func
      return Function(`"use strict";return (${s})`)()
    } catch {
      return NaN
    }
  }

  const getValue = (id: string): number | string => {
    const raw = getRaw(id)
    if (raw.startsWith('=')) {
      const v = evalFormula(raw.slice(1))
      return Number.isFinite(v) ? v : '#ERR'
    }
    return raw
  }

  const displayValue = (id: string) => {
    const v = getValue(id)
    if (typeof v === 'number') {
      return Number.isFinite(v) ? v.toString() : '#ERR'
    }
    return v
  }

  const startEdit = (id: string, initial?: string) => {
    setEditing(id)
    setEditValue(initial ?? getRaw(id))
  }

  const commitEdit = () => {
    if (!editing) return
    setCells(prev => ({ ...prev, [editing]: editValue }))
    setEditing(null)
    gridRef.current?.focus()
  }

  const setFormulaSelection = (a: string, b: string) => {
    const range = (() => {
      const pa = parseCell(a)
      const pb = parseCell(b)
      if (!pa || !pb) return a
      const start = cellId(Math.min(pa.col, pb.col), Math.min(pa.row, pb.row))
      const end = cellId(Math.max(pa.col, pb.col), Math.max(pa.row, pb.row))
      return start === end ? start : `${start}:${end}`
    })()

    setEditValue(prev => {
      if (!prev.startsWith('=')) return prev
      const p = prev.trimEnd()
      const refOrRange = /([A-Z]+\d+)(:[A-Z]+\d+)?$/
      if (refOrRange.test(p)) {
        return p.replace(refOrRange, range)
      }
      if (/[\(,=+\-*/]$/.test(p)) return `${p}${range}`
      return `${p},${range}`
    })
  }

  const scrollIntoViewIfNeeded = (id: string) => {
    const el = cellRefs.current.get(id)
    if (!el) return
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }

  const rangeCells = useMemo(() => parseRange(`${rangeStart}:${rangeEnd}`), [rangeStart, rangeEnd])
  const rangeBounds = useMemo(() => {
    const a = parseCell(rangeStart)
    const b = parseCell(rangeEnd)
    if (!a || !b) return null
    return {
      cMin: Math.min(a.col, b.col),
      cMax: Math.max(a.col, b.col),
      rMin: Math.min(a.row, b.row),
      rMax: Math.max(a.row, b.row),
    }
  }, [rangeStart, rangeEnd])

  const copySelection = async () => {
    if (rangeCells.length === 0) return
    const m1 = rangeStart.match(/^([A-Z]+)(\d+)$/)
    const m2 = rangeEnd.match(/^([A-Z]+)(\d+)$/)
    if (!m1 || !m2) return
    const c1 = m1[1].charCodeAt(0) - 65
    const r1 = Number(m1[2]) - 1
    const c2 = m2[1].charCodeAt(0) - 65
    const r2 = Number(m2[2]) - 1
    const cMin = Math.min(c1, c2)
    const cMax = Math.max(c1, c2)
    const rMin = Math.min(r1, r2)
    const rMax = Math.max(r1, r2)

    const rows: string[] = []
    for (let r = rMin; r <= rMax; r++) {
      const cols: string[] = []
      for (let c = cMin; c <= cMax; c++) {
        cols.push(getRaw(cellId(c, r)))
      }
      rows.push(cols.join('\t'))
    }
    const text = rows.join('\n')
    await navigator.clipboard.writeText(text)
  }

  const pasteAtActive = async () => {
    const text = await navigator.clipboard.readText()
    if (!text) return
    const rows = text.split(/\r?\n/).map(r => r.split('\t'))
    const m = activeCell.match(/^([A-Z]+)(\d+)$/)
    if (!m) return
    const startCol = m[1].charCodeAt(0) - 65
    const startRow = Number(m[2]) - 1
    const updates: Record<string, string> = { ...cells }
    rows.forEach((row, ri) => {
      row.forEach((val, ci) => {
        const c = startCol + ci
        const r = startRow + ri
        if (c >= COLS || r >= ROWS) return
        updates[cellId(c, r)] = val
      })
    })
    setCells(updates)
  }

  const inRange = (id: string) => {
    const p = parseCell(id)
    if (!p || !rangeBounds) return false
    return p.col >= rangeBounds.cMin && p.col <= rangeBounds.cMax && p.row >= rangeBounds.rMin && p.row <= rangeBounds.rMax
  }

  const moveActive = (dc: number, dr: number, expand: boolean) => {
    const next = offsetCell(activeCell, dc, dr, COLS, ROWS)
    setActiveCell(next)
    scrollIntoViewIfNeeded(next)
    if (expand) {
      setRangeEnd(next)
    } else {
      setRangeStart(next)
      setRangeEnd(next)
    }
  }

  const moveTo = (next: string, expand: boolean) => {
    setActiveCell(next)
    scrollIntoViewIfNeeded(next)
    if (expand) {
      setRangeEnd(next)
    } else {
      setRangeStart(next)
      setRangeEnd(next)
    }
  }

  const hasValue = (id: string) => (getRaw(id) ?? '') !== ''

  const ctrlMove = (dx: number, dy: number, expand: boolean) => {
    const pos = parseCell(activeCell)
    if (!pos) return
    const { col, row } = pos

    if (dx !== 0) {
      const step = dx > 0 ? 1 : -1
      let c = col + step
      if (c < 0 || c >= COLS) return
      const firstHas = hasValue(cellId(c, row))
      if (firstHas) {
        let last = c
        while (last + step >= 0 && last + step < COLS && hasValue(cellId(last + step, row))) {
          last += step
        }
        moveTo(cellId(last, row), expand)
      } else {
        while (c >= 0 && c < COLS && !hasValue(cellId(c, row))) c += step
        if (c >= 0 && c < COLS) moveTo(cellId(c, row), expand)
        else moveTo(cellId(dx > 0 ? COLS - 1 : 0, row), expand)
      }
      return
    }

    if (dy !== 0) {
      const step = dy > 0 ? 1 : -1
      let r = row + step
      if (r < 0 || r >= ROWS) return
      const firstHas = hasValue(cellId(col, r))
      if (firstHas) {
        let last = r
        while (last + step >= 0 && last + step < ROWS && hasValue(cellId(col, last + step))) {
          last += step
        }
        moveTo(cellId(col, last), expand)
      } else {
        while (r >= 0 && r < ROWS && !hasValue(cellId(col, r))) r += step
        if (r >= 0 && r < ROWS) moveTo(cellId(col, r), expand)
        else moveTo(cellId(col, dy > 0 ? ROWS - 1 : 0), expand)
      }
    }
  }

  const commitAndMove = (dc: number, dr: number) => {
    commitEdit()
    moveActive(dc, dr, false)
  }

  const grid = useMemo(() => {
    return Array.from({ length: ROWS }, (_, r) =>
      Array.from({ length: COLS }, (_, c) => cellId(c, r))
    )
  }, [])

  const getCellStyle = (id: string): React.CSSProperties | undefined => {
    if (!rangeBounds) return undefined
    const p = parseCell(id)
    if (!p) return undefined
    const inSel =
      p.col >= rangeBounds.cMin && p.col <= rangeBounds.cMax &&
      p.row >= rangeBounds.rMin && p.row <= rangeBounds.rMax
    if (!inSel) return undefined
    const top = p.row === rangeBounds.rMin
    const bottom = p.row === rangeBounds.rMax
    const left = p.col === rangeBounds.cMin
    const right = p.col === rangeBounds.cMax
    const shadows: string[] = []
    if (top) shadows.push('inset 0 1px 0 #ff6600')
    if (bottom) shadows.push('inset 0 -1px 0 #ff6600')
    if (left) shadows.push('inset 1px 0 0 #ff6600')
    if (right) shadows.push('inset -1px 0 0 #ff6600')
    return { boxShadow: shadows.join(', ') }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (editing) {
      if (e.key === 'Tab') {
        e.preventDefault()
        if (matchedHint) {
          setEditValue(`=${matchedHint.key}(`)
        } else if (!isFormula) {
          commitAndMove(e.shiftKey ? -1 : 1, 0)
        }
      } else if (e.key === 'Enter') {
        e.preventDefault()
        commitAndMove(0, e.shiftKey ? -1 : 1)
      } else if (e.key === 'Escape') {
        setEditing(null)
        gridRef.current?.focus()
      } else if (isFormula && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        e.preventDefault()
        const expand = e.shiftKey
        const next =
          e.key === 'ArrowLeft' ? offsetCell(activeCell, -1, 0, COLS, ROWS)
          : e.key === 'ArrowRight' ? offsetCell(activeCell, 1, 0, COLS, ROWS)
          : e.key === 'ArrowUp' ? offsetCell(activeCell, 0, -1, COLS, ROWS)
          : offsetCell(activeCell, 0, 1, COLS, ROWS)

        if (expand) {
          moveTo(next, true)
          setFormulaSelection(rangeStart, next)
        } else {
          moveTo(next, false)
          setFormulaSelection(next, next)
        }
      }
      return
    }

    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') {
      e.preventDefault()
      copySelection()
      return
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v') {
      e.preventDefault()
      pasteAtActive()
      return
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      if (rangeCells.length > 0) {
        const updates: Record<string, string> = { ...cells }
        rangeCells.forEach(id => { updates[id] = '' })
        setCells(updates)
      } else {
        setCells(prev => ({ ...prev, [activeCell]: '' }))
      }
      return
    }

    const jump = e.metaKey || e.ctrlKey

    const ensureShiftAnchor = () => {
      if (rangeStart !== activeCell && rangeStart === rangeEnd) {
        setRangeStart(activeCell)
        setRangeEnd(activeCell)
      }
    }

    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      if (e.shiftKey) ensureShiftAnchor()
      jump ? ctrlMove(-1, 0, e.shiftKey) : moveActive(-1, 0, e.shiftKey)
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      if (e.shiftKey) ensureShiftAnchor()
      jump ? ctrlMove(1, 0, e.shiftKey) : moveActive(1, 0, e.shiftKey)
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (e.shiftKey) ensureShiftAnchor()
      jump ? ctrlMove(0, -1, e.shiftKey) : moveActive(0, -1, e.shiftKey)
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (e.shiftKey) ensureShiftAnchor()
      jump ? ctrlMove(0, 1, e.shiftKey) : moveActive(0, 1, e.shiftKey)
    }
    if (e.key === 'Tab') { e.preventDefault(); moveActive(e.shiftKey ? -1 : 1, 0, e.shiftKey) }
    if (e.key === 'Enter') { e.preventDefault(); moveActive(0, e.shiftKey ? -1 : 1, e.shiftKey) }
    if (e.key.length === 1) {
      e.preventDefault()
      startEdit(activeCell, e.key)
      return
    }
    if (e.key === 'F2') {
      startEdit(activeCell)
    }
  }

  return (
    <div className="h-full overflow-hidden bg-surface flex flex-col">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border">
        <span className="panel-header text-orange font-bold text-xs tracking-widest">SPREADSHEET</span>
        <span className="text-secondary text-xs">F8</span>
      </div>

      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-surface2 text-xs font-mono">
        <span className="text-secondary">fx</span>
        <input
          className="flex-1 bg-bg border border-border px-2 py-1 text-primary"
          value={editing ? editValue : ''}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitEdit()
            if (e.key === 'Escape') setEditing(null)
            if (e.key === 'Tab' && matchedHint) {
              e.preventDefault()
              setEditValue(`=${matchedHint.key}(`)
            }
          }}
          placeholder={editing ? '' : 'Select a cell to edit'}
          disabled={!editing}
        />
      </div>
      {editing && matchedHint && (
        <div className="px-3 py-2 border-b border-border bg-surface2 text-xs font-mono">
          <div className="text-secondary">Function</div>
          <div className="text-primary">{matchedHint.key}(<span className="text-secondary">…</span>)</div>
          <div className="text-secondary">{matchedHint.desc}</div>
          <div className="text-secondary">Press Tab to autocomplete.</div>
        </div>
      )}

      <div
        className="flex-1 overflow-auto focus:outline-none"
        tabIndex={0}
        data-sheet-grid="true"
        ref={gridRef}
        onKeyDown={handleKeyDown}
        onMouseUp={() => {
          if (!isFilling) return
          setIsFilling(false)
          const anchorValue = getRaw(fillAnchor)
          const updates: Record<string, string> = { ...cells }
          rangeCells.forEach(id => {
            updates[id] = anchorValue
          })
          setCells(updates)
        }}
      >
        <div className="min-w-max">
          <div className="flex sticky top-0 bg-surface2 border-b border-border">
            <div className="w-10 shrink-0 border-r border-border bg-surface2" />
            {Array.from({ length: COLS }, (_, c) => (
              <div key={c} className="w-24 shrink-0 px-2 py-1 border-r border-border text-xs font-mono text-secondary">
                {colLabel(c)}
              </div>
            ))}
          </div>
          {grid.map((row, r) => (
            <div key={r} className="flex border-b border-border/60">
              <div className="w-10 shrink-0 px-2 py-1 border-r border-border bg-surface2 text-xs font-mono text-secondary">
                {r + 1}
              </div>
              {row.map((id) => (
                <div
                  key={id}
                  ref={(el) => {
                    if (el) cellRefs.current.set(id, el)
                  }}
                  className={`group relative w-24 shrink-0 px-2 py-1 border-r border-border text-xs font-mono cursor-cell
                    ${editing === id ? 'bg-bg' : 'bg-surface'}
                    ${activeCell === id ? 'ring-1 ring-orange ring-inset' : ''}
                    ${inRange(id) ? 'bg-surface2' : ''}
                  `}
                  style={getCellStyle(id)}
                  onDoubleClick={() => startEdit(id)}
                  onClick={(e) => {
                    setActiveCell(id)
                    if (e.shiftKey) {
                      setRangeEnd(id)
                    } else {
                      setRangeStart(id)
                      setRangeEnd(id)
                    }
                    if (editing && isFormula) {
                      setFormulaSelection(id, id)
                    }
                    ;(e.currentTarget as HTMLElement).closest<HTMLElement>('[data-sheet-grid="true"]')?.focus()
                  }}
                  onMouseDown={(e) => {
                    if (e.shiftKey) {
                      setRangeEnd(id)
                    } else {
                      setRangeStart(id)
                      setRangeEnd(id)
                      setActiveCell(id)
                    }
                  }}
                  onMouseEnter={() => {
                    if (isFilling) setRangeEnd(id)
                  }}
                  title={getRaw(id).startsWith('=') ? getRaw(id) : ''}
                >
                  {editing === id ? (
                    <input
                      className="w-full bg-transparent outline-none text-primary"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={commitEdit}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          commitEdit()
                          moveActive(0, 1, false)
                        }
                        if (e.key === 'Tab') {
                          e.preventDefault()
                          if (!isFormula) {
                            commitEdit()
                            moveActive(e.shiftKey ? -1 : 1, 0, false)
                          } else if (matchedHint) {
                            setEditValue(`=${matchedHint.key}(`)
                          }
                        }
                        if (e.key === 'Escape') {
                          e.preventDefault()
                          setEditing(null)
                          gridRef.current?.focus()
                        }
                      }}
                      autoFocus
                    />
                  ) : (
                    <span className="text-primary">
                      {displayValue(id)}
                      {activeCell === id && !editing && (
                        <span
                          className="absolute -right-0.5 -bottom-0.5 w-2 h-2 bg-orange border border-bg opacity-0 group-hover:opacity-100"
                          onMouseDown={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            setIsFilling(true)
                            setFillAnchor(id)
                            setRangeStart(id)
                            setRangeEnd(id)
                          }}
                        />
                      )}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
