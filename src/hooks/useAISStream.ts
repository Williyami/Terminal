import { useEffect, useRef, useState } from 'react'

interface BBox {
  latMin: number
  latMax: number
  lonMin: number
  lonMax: number
}

export interface AISMessage {
  mmsi: string
  shipName?: string
  lat?: number
  lon?: number
  cog?: number
  sog?: number
  timestamp?: string
  lastSeen?: number
}

interface TrailPoint { lat: number; lon: number; time?: string }
interface LatestShip { mmsi: string; shipName?: string; lat: number; lon: number; sog?: number; cog?: number; lastSeen: number }
export interface AISStatic {
  mmsi: string
  shipName?: string
  callSign?: string
  destination?: string
  eta?: string
  shipType?: string | number
}

export function useAISStream(bbox: BBox, enabled: boolean, limit = 50) {
  const [messages, setMessages] = useState<AISMessage[]>([])
  const [latest, setLatest] = useState<LatestShip[]>([])
  const [trails, setTrails] = useState<Record<string, TrailPoint[]>>({})
  const [staticInfo, setStaticInfo] = useState<Record<string, AISStatic>>({})
  const [staticReady, setStaticReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const esRef = useRef<EventSource | null>(null)
  const latestRef = useRef<Map<string, LatestShip>>(new Map())
  const trailsRef = useRef<Map<string, TrailPoint[]>>(new Map())
  const staticRef = useRef<Map<string, AISStatic>>(new Map())

  useEffect(() => {
    if (!enabled) {
      esRef.current?.close()
      esRef.current = null
      setConnected(false)
      return
    }

    const params = new URLSearchParams({
      latMin: bbox.latMin.toString(),
      latMax: bbox.latMax.toString(),
      lonMin: bbox.lonMin.toString(),
      lonMax: bbox.lonMax.toString(),
    })

    const es = new EventSource(`/ais/stream?${params.toString()}`)
    esRef.current = es

    es.onopen = () => {
      setConnected(true)
      setError(null)
    }

    es.onerror = () => {
      setConnected(false)
      setError('AIS stream error')
    }

    es.onmessage = (ev) => {
      try {
        const raw = JSON.parse(ev.data)
        const meta = raw?.MetaData ?? raw?.Metadata ?? {}
        const msg = raw?.Message?.PositionReport ?? raw?.Message?.StandardClassBPositionReport ?? raw?.Message?.ExtendedClassBPositionReport ?? {}
        const staticMsg = raw?.Message?.ShipStaticData ?? raw?.Message?.StaticDataReport ?? {}
        const lat = meta?.latitude ?? msg?.Latitude
        const lon = meta?.longitude ?? msg?.Longitude
        const mmsi = String(meta?.MMSI ?? msg?.MMSI ?? staticMsg?.MMSI ?? raw?.MMSI ?? '---')

        if (staticMsg && Object.keys(staticMsg).length > 0) {
          staticRef.current.set(mmsi, {
            mmsi,
            shipName: staticMsg?.Name ?? staticMsg?.ShipName ?? meta?.ShipName ?? meta?.shipName,
            callSign: staticMsg?.CallSign ?? staticMsg?.Callsign,
            destination: staticMsg?.Destination,
            eta: staticMsg?.Eta ?? staticMsg?.ETA,
            shipType: staticMsg?.ShipType ?? staticMsg?.Type,
          })
          setStaticInfo(Object.fromEntries(staticRef.current.entries()))
          setStaticReady(true)
        }

        if (lat == null || lon == null) return
        const next: AISMessage = {
          mmsi,
          shipName: meta?.ShipName ?? meta?.shipName,
          lat: Number(lat),
          lon: Number(lon),
          cog: msg?.Cog ?? msg?.COG ?? meta?.cog,
          sog: msg?.Sog ?? msg?.SOG ?? meta?.sog,
          timestamp: meta?.time_utc ?? meta?.timestamp ?? meta?.TimeUtc,
          lastSeen: Date.now(),
        }

        // Recent stream list
        setMessages(prev => [next, ...prev].slice(0, limit))

        // Latest per MMSI (persistent)
        latestRef.current.set(next.mmsi, {
          mmsi: next.mmsi,
          shipName: next.shipName,
          lat: Number(lat),
          lon: Number(lon),
          sog: next.sog,
          cog: next.cog,
          lastSeen: next.lastSeen ?? Date.now(),
        })

        // Trails per MMSI (keep last 30 points)
        const trail = trailsRef.current.get(next.mmsi) ?? []
        trail.push({ lat: next.lat ?? 0, lon: next.lon ?? 0, time: next.timestamp })
        if (trail.length > 30) trail.shift()
        trailsRef.current.set(next.mmsi, trail)

        // Soft cap to avoid runaway memory in extreme traffic
        if (latestRef.current.size > 5000) {
          const oldest = [...latestRef.current.values()].sort((a, b) => a.lastSeen - b.lastSeen).slice(0, 500)
          for (const o of oldest) {
            latestRef.current.delete(o.mmsi)
            trailsRef.current.delete(o.mmsi)
          }
        }

        setLatest(Array.from(latestRef.current.values()))
        setTrails(Object.fromEntries(trailsRef.current.entries()))
      } catch {
        // ignore malformed event
      }
    }

    return () => {
      es.close()
      esRef.current = null
      setConnected(false)
    }
  }, [bbox, enabled, limit])

  return { messages, latest, trails, staticInfo, staticReady, error, connected }
}
