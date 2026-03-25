export interface AvanzaTransaction {
  date: string
  account: string
  type: TransactionType
  typRaw: string
  name: string
  qty: number
  price: number
  amount: number      // total SEK including commission (already net)
  currency: string
  commission: number
  fxRate: number
  instrumentCurrency: string
  isin: string
  result: number
}

export type TransactionType =
  | 'buy'
  | 'sell'
  | 'deposit'
  | 'withdrawal'
  | 'dividend'
  | 'interest'
  | 'tax'
  | 'transfer'
  | 'split'       // stock splits, ISIN conversions (Byte, Split värdepapper, etc.)
  | 'other'

const TYPE_MAP: [string, TransactionType][] = [
  ['köp', 'buy'],
  ['sälj', 'sell'],
  // Corporate actions must come BEFORE 'uttag'/'insättning' to prevent
  // 'Split uttag värdepapper' matching 'uttag' → withdrawal
  ['byte', 'split'],
  ['split', 'split'],
  ['insättning', 'deposit'],
  ['uttag', 'withdrawal'],
  ['utdelning', 'dividend'],
  ['utlåningsränta', 'interest'],
  ['ränta', 'interest'],
  ['utländsk källskatt', 'tax'],
  ['källskatt', 'tax'],
  ['intern överföring', 'transfer'],
  ['återbetalning fondavgift', 'other'],
  ['fondavgift', 'other'],
  ['avgift', 'other'],
]

function parseSweNum(s: string): number {
  if (!s || s.trim() === '' || s.trim() === '-') return 0
  // Swedish locale: period = thousands separator, comma = decimal separator
  return parseFloat(s.trim().replace(/\./g, '').replace(',', '.')) || 0
}

function mapType(raw: string): TransactionType {
  const key = raw.trim().toLowerCase()
  for (const [k, v] of TYPE_MAP) {
    if (key === k || key.startsWith(k) || key.includes(k)) return v
  }
  return 'other'
}

export function parseAvanzaCsv(text: string): AvanzaTransaction[] {
  // Strip UTF-8 BOM if present
  const cleaned = text.startsWith('\uFEFF') ? text.slice(1) : text

  const lines = cleaned.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return []

  const header = lines[0]
  const sep = header.includes(';') ? ';' : ','
  const cols = header.split(sep).map(c => c.trim().replace(/^"|"$/g, '').toLowerCase())

  const idx = (...names: string[]) => {
    for (const n of names) {
      const i = cols.findIndex(c => c.includes(n))
      if (i !== -1) return i
    }
    return -1
  }

  const iDate   = idx('datum')
  const iAcct   = idx('konto')
  const iType   = idx('typ av transaktion', 'typ')
  const iName   = idx('värdepapper', 'beskrivning')
  const iQty    = idx('antal')
  const iPrice  = idx('kurs')
  const iAmt    = idx('belopp')
  const iCur    = idx('transaktionsvaluta')
  const iComm   = idx('courtage')
  const iFx     = idx('valutakurs')
  const iInstCur = idx('instrumentvaluta')
  const iIsin   = idx('isin')
  const iResult = idx('resultat')

  const txns: AvanzaTransaction[] = []

  for (let i = 1; i < lines.length; i++) {
    const row = lines[i].split(sep).map(c => c.trim().replace(/^"|"$/g, ''))
    if (row.length < 3) continue

    const typRaw = iType !== -1 ? row[iType] : ''
    if (!typRaw) continue

    txns.push({
      date:               iDate   !== -1 ? row[iDate]   : '',
      account:            iAcct   !== -1 ? row[iAcct]   : '',
      type:               mapType(typRaw),
      typRaw,
      name:               iName   !== -1 ? row[iName]   : '',
      qty:                iQty    !== -1 ? parseSweNum(row[iQty])   : 0,
      price:              iPrice  !== -1 ? parseSweNum(row[iPrice]) : 0,
      amount:             iAmt    !== -1 ? parseSweNum(row[iAmt])   : 0,
      currency:           iCur    !== -1 ? row[iCur]    : '',
      commission:         iComm   !== -1 ? parseSweNum(row[iComm]) : 0,
      fxRate:             iFx     !== -1 ? parseSweNum(row[iFx])   : 1,
      instrumentCurrency: iInstCur !== -1 ? row[iInstCur] : '',
      isin:               iIsin   !== -1 ? row[iIsin]   : '',
      result:             iResult !== -1 ? parseSweNum(row[iResult]) : 0,
    })
  }

  return txns
}

export interface AggregatedPosition {
  isin: string
  name: string
  symbol: string
  qty: number
  avgCost: number   // SEK per share (total cost / qty)
  totalCost: number // SEK
  currency: string
  instrumentCurrency: string
  realizedPL: number
}

export interface ImportResult {
  positions: AggregatedPosition[]
  cashByCurrency: Record<string, number>
  totalDividends: number
  transactions: AvanzaTransaction[]
}

function nameToSymbol(name: string, isin: string): string {
  if (!name) return isin.slice(0, 6)
  if (name.length <= 6 && /^[A-Z0-9]+$/.test(name)) return name
  const clean = name
    .replace(/\s+(A|B|C|D|H|I|X|USD|SEK|EUR|GBP|NOK|DKK|CHF)\s*$/i, '')
    .trim()
  const words = clean.split(/\s+/)
  if (words[0].length <= 6 && /^[A-Za-z0-9.]+$/.test(words[0])) return words[0].toUpperCase()
  return words.map(w => w[0]).join('').toUpperCase().slice(0, 5)
}

interface PosState {
  name: string
  qty: number
  totalCost: number
  currency: string
  instrumentCurrency: string
  realizedPL: number
}

export function aggregateTransactions(txns: AvanzaTransaction[]): ImportResult {
  // Sort ascending by date.
  // Within the same date use explicit rank so same-day sequences resolve correctly:
  //   0 = buy        (must come first — e.g. buy old ISIN then split-out same day transfers cost)
  //   1 = split-out  (releases cost basis after buy has established it)
  //   2 = split-in   (receives cost basis from split-out)
  //   3 = sell
  //   4 = everything else
  // The Avanza CSV is newest-first within a day, so stable ascending sort would otherwise
  // put the sell before the buy for same-day round-trips.
  const sorted = [...txns].sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date)
    const rank = (t: AvanzaTransaction) => {
      if (t.type === 'buy') return 0          // buy first: same-day buy → split-out transfers cost correctly
      if (t.type === 'split') return t.qty < 0 ? 1 : 2  // split-out before split-in
      if (t.type === 'sell') return 3
      return 4
    }
    return rank(a) - rank(b)
  })

  const posMap = new Map<string, PosState>()
  const cashByCurrency: Record<string, number> = {}
  let totalDividends = 0

  // Pre-compute per-date total weight of positive-qty splits (for proportional cost basis)
  // Weight = qty * price if price available, else just qty
  const splitInWeightByDate = new Map<string, number>()
  for (const t of sorted) {
    if (t.type === 'split' && t.qty > 0) {
      const w = t.price > 0 ? Math.abs(t.qty) * t.price : Math.abs(t.qty)
      splitInWeightByDate.set(t.date, (splitInWeightByDate.get(t.date) ?? 0) + w)
    }
  }
  // Cost basis released by negative-qty splits, keyed by date (filled as we go)
  const splitPotByDate = new Map<string, number>()

  function getOrCreate(key: string, t: AvanzaTransaction): PosState {
    let pos = posMap.get(key)
    if (!pos) {
      pos = {
        name: t.name,
        qty: 0,
        totalCost: 0,
        currency: t.currency || 'SEK',
        instrumentCurrency: t.instrumentCurrency,
        realizedPL: 0,
      }
      posMap.set(key, pos)
    }
    if (t.name && !pos.name) pos.name = t.name
    return pos
  }

  for (const t of sorted) {
    const cur = t.currency || 'SEK'
    const key = t.isin || t.name

    switch (t.type) {
      case 'deposit':
        cashByCurrency[cur] = (cashByCurrency[cur] ?? 0) + Math.abs(t.amount)
        break

      case 'withdrawal':
        cashByCurrency[cur] = (cashByCurrency[cur] ?? 0) - Math.abs(t.amount)
        break

      case 'dividend':
        totalDividends += Math.abs(t.amount)
        cashByCurrency[cur] = (cashByCurrency[cur] ?? 0) + Math.abs(t.amount)
        break

      case 'tax':
        cashByCurrency[cur] = (cashByCurrency[cur] ?? 0) - Math.abs(t.amount)
        break

      case 'interest':
        // Can be positive (income) or negative (fee)
        cashByCurrency[cur] = (cashByCurrency[cur] ?? 0) + t.amount
        break

      case 'transfer':
      case 'other':
        break

      case 'split': {
        if (!key) break
        if (t.qty < 0) {
          // Old shares leaving — release cost basis to the date pot
          const releaseQty = Math.abs(t.qty)
          const pos = posMap.get(key)
          if (pos && pos.qty > 0) {
            const avgCostPerShare = pos.totalCost / pos.qty
            const releaseAmt = avgCostPerShare * Math.min(releaseQty, pos.qty)
            pos.qty = Math.max(0, pos.qty - releaseQty)
            pos.totalCost = Math.max(0, pos.totalCost - releaseAmt)
            splitPotByDate.set(t.date, (splitPotByDate.get(t.date) ?? 0) + releaseAmt)
          }
        } else if (t.qty > 0) {
          // New shares arriving — apply proportional cost basis from pot
          const pos = getOrCreate(key, t)
          const pot = splitPotByDate.get(t.date) ?? 0
          const totalWeight = splitInWeightByDate.get(t.date) ?? Math.abs(t.qty)
          const myWeight = t.price > 0 ? Math.abs(t.qty) * t.price : Math.abs(t.qty)
          const fraction = totalWeight > 0 ? myWeight / totalWeight : 1
          pos.qty += Math.abs(t.qty)
          pos.totalCost += pot * fraction
        }
        break
      }

      case 'buy': {
        if (!key) break
        const pos = getOrCreate(key, t)
        const buyQty = Math.abs(t.qty)
        // Belopp (amount) is already the total cash paid including commission — do NOT add commission again
        const cost = Math.abs(t.amount)
        pos.qty += buyQty
        pos.totalCost += cost
        cashByCurrency[cur] = (cashByCurrency[cur] ?? 0) - cost
        break
      }

      case 'sell': {
        if (!key) break
        const pos = getOrCreate(key, t)
        // Avanza qty is NEGATIVE for sells (e.g. -21)
        const sellQty = Math.abs(t.qty)
        const avgCostPerShare = pos.qty > 0 ? pos.totalCost / pos.qty : 0
        const realizedCost = avgCostPerShare * sellQty
        // Belopp (amount) is already net proceeds (price * qty * fx - commission)
        const proceeds = Math.abs(t.amount)
        pos.realizedPL += proceeds - realizedCost
        pos.qty = Math.max(0, pos.qty - sellQty)
        pos.totalCost = Math.max(0, pos.totalCost - realizedCost)
        cashByCurrency[cur] = (cashByCurrency[cur] ?? 0) + proceeds
        break
      }
    }
  }

  const positions: AggregatedPosition[] = []
  for (const [isin, pos] of posMap.entries()) {
    if (pos.qty < 0.001) continue
    const avgCost = pos.qty > 0 ? pos.totalCost / pos.qty : 0
    positions.push({
      isin,
      name: pos.name,
      symbol: nameToSymbol(pos.name, isin),
      qty: Math.round(pos.qty * 10000) / 10000,
      avgCost: Math.round(avgCost * 100) / 100,
      totalCost: Math.round(pos.totalCost * 100) / 100,
      currency: pos.currency,
      instrumentCurrency: pos.instrumentCurrency,
      realizedPL: Math.round(pos.realizedPL * 100) / 100,
    })
  }

  positions.sort((a, b) => b.totalCost - a.totalCost)

  return { positions, cashByCurrency, totalDividends, transactions: sorted }
}
