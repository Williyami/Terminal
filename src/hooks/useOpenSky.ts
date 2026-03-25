import { useEffect, useState, useCallback } from 'react'

export interface OpenSkyState {
  icao24: string
  callsign: string | null
  originCountry: string
  timePosition: number | null
  lastContact: number
  longitude: number | null
  latitude: number | null
  baroAltitude: number | null
  onGround: boolean
  velocity: number | null
  trueTrack: number | null
  verticalRate: number | null
}

interface BBox {
  latMin: number
  latMax: number
  lonMin: number
  lonMax: number
}

function mapState(row: unknown[]): OpenSkyState | null {
  if (!Array.isArray(row) || row.length < 17) return null
  return {
    icao24: String(row[0] ?? ''),
    callsign: (row[1] ?? null) ? String(row[1]).trim() : null,
    originCountry: String(row[2] ?? ''),
    timePosition: row[3] == null ? null : Number(row[3]),
    lastContact: Number(row[4] ?? 0),
    longitude: row[5] == null ? null : Number(row[5]),
    latitude: row[6] == null ? null : Number(row[6]),
    baroAltitude: row[7] == null ? null : Number(row[7]),
    onGround: Boolean(row[8]),
    velocity: row[9] == null ? null : Number(row[9]),
    trueTrack: row[10] == null ? null : Number(row[10]),
    verticalRate: row[11] == null ? null : Number(row[11]),
  }
}

async function fetchOpenSky(bbox: BBox): Promise<OpenSkyState[]> {
  const params = new URLSearchParams({
    lamin: bbox.latMin.toString(),
    lamax: bbox.latMax.toString(),
    lomin: bbox.lonMin.toString(),
    lomax: bbox.lonMax.toString(),
  })
  const res = await fetch(`/opensky/api/states/all?${params.toString()}`)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    const snippet = text ? `: ${text.slice(0, 160)}` : ''
    throw new Error(`OpenSky ${res.status}${snippet}`)
  }
  const json = await res.json()
  const states = Array.isArray(json?.states) ? json.states : []
  return states.map(mapState).filter(Boolean) as OpenSkyState[]
}

export function useOpenSky(bbox: BBox, intervalMs = 10000) {
  const [states, setStates] = useState<OpenSkyState[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await fetchOpenSky(bbox)
      setStates(data)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'fetch error')
    } finally {
      setLoading(false)
    }
  }, [bbox])

  useEffect(() => {
    load()
    const id = setInterval(load, intervalMs)
    return () => clearInterval(id)
  }, [load, intervalMs])

  return { states, loading, error }
}
