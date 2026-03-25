export function colLabel(i: number) {
  return String.fromCharCode(65 + i)
}

export function cellId(col: number, row: number) {
  return `${colLabel(col)}${row + 1}`
}

export function parseCell(id: string) {
  const m = id.match(/^([A-Z]+)(\d+)$/)
  if (!m) return null
  const col = m[1].charCodeAt(0) - 65
  const row = Number(m[2]) - 1
  return { col, row }
}

export function offsetCell(id: string, dc: number, dr: number, maxCols: number, maxRows: number) {
  const parsed = parseCell(id)
  if (!parsed) return id
  const col = Math.max(0, Math.min(maxCols - 1, parsed.col + dc))
  const row = Math.max(0, Math.min(maxRows - 1, parsed.row + dr))
  return cellId(col, row)
}
