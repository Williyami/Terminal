import { useEffect, useMemo, useRef, useState } from 'react'
import { useOpenSky } from '../hooks/useOpenSky'
import { useAISStream } from '../hooks/useAISStream'
import { MapContainer, TileLayer, CircleMarker, Polyline, useMap, useMapEvents } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import worldLand from 'world-atlas/land-110m.json'
import { feature } from 'topojson-client'
import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import { point as turfPoint } from '@turf/helpers'

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-center justify-between text-xs font-mono border-b border-border/60 py-1">
    <span className="text-secondary">{label}</span>
    <span className="text-primary">{value}</span>
  </div>
)

export function TrackingPage() {
  const [tab, setTab] = useState<'FLIGHTS' | 'TANKERS'>('FLIGHTS')
  const [bbox, setBbox] = useState({
    latMin: 20,
    latMax: 60,
    lonMin: -130,
    lonMax: 30,
  })
  const [shipsEnabled, setShipsEnabled] = useState(false)
  const [tankersOnly, setTankersOnly] = useState(true)
  const [hideLand, setHideLand] = useState(true)
  const [selectedMmsi, setSelectedMmsi] = useState<string | null>(null)
  const [shipDetails, setShipDetails] = useState<Record<string, Record<string, unknown>>>({})
  const [govMilOnly, setGovMilOnly] = useState(true)
  const [countryFilter, setCountryFilter] = useState('United States, United Kingdom, France, Germany')
  const [prefixFilter, setPrefixFilter] = useState('AF1, SAM, RCH, RAF, GAF, FRA, GNY, BAF, DAF, NAF, NATO, UN')

  const { states, loading: flightsLoading, error: flightsError } = useOpenSky(bbox, 10000)
  const { messages: ships, latest: shipLatest, trails: shipTrailsMap, staticInfo, staticReady, error: shipsError, connected: shipsConnected } =
    useAISStream(bbox, shipsEnabled, 60)

  const countryList = useMemo(
    () => countryFilter.split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
    [countryFilter]
  )
  const prefixList = useMemo(
    () => prefixFilter.split(',').map(s => s.trim().toUpperCase()).filter(Boolean),
    [prefixFilter]
  )

  const flightRows = useMemo(
    () => states
      .filter(s => s.latitude != null && s.longitude != null)
      .filter(s => {
        if (!govMilOnly) return true
        const call = (s.callsign ?? '').toUpperCase()
        const countryOk = countryList.length === 0 || countryList.includes(s.originCountry.toLowerCase())
        const prefixOk = prefixList.length === 0 || prefixList.some(p => call.startsWith(p))
        return countryOk && prefixOk
      })
      .slice(0, 80),
    [states, govMilOnly, countryList, prefixList]
  )

  const shipTrails = useMemo(() => {
    return Object.entries(shipTrailsMap).map(([mmsi, points]) => ({
      mmsi,
      points: points.map(p => [p.lat, p.lon] as [number, number]),
    }))
  }, [shipTrailsMap])

  const isTanker = (type?: string | number) => {
    if (type == null) return false
    const n = Number(type)
    if (Number.isNaN(n)) return false
    return n >= 80 && n <= 89
  }

  const tankerSet = useMemo(() => {
    if (!tankersOnly) return null
    if (!staticReady) return null
    const vals = Object.values(staticInfo)
    if (vals.length === 0) return null
    const set = new Set(vals.filter(s => isTanker(s.shipType)).map(s => s.mmsi))
    return set.size > 0 ? set : null
  }, [staticInfo, tankersOnly, staticReady])

  const landFeature = useMemo(() => {
    try {
      const topo = worldLand as any
      const feat = feature(topo, topo.objects.land) as any
      if (feat?.type === 'FeatureCollection') {
        return feat.features?.[0] ?? null
      }
      return feat ?? null
    } catch {
      return null
    }
  }, [])

  const filteredShipLatest = useMemo(() => {
    if (!tankersOnly || !tankerSet) return shipLatest
    return shipLatest.filter(s => tankerSet.has(s.mmsi))
  }, [shipLatest, tankerSet, tankersOnly])

  const visibleShipLatest = useMemo(() => {
    if (!hideLand || !landFeature) return filteredShipLatest
    return filteredShipLatest.filter(s => {
      try {
        const pt = turfPoint([s.lon, s.lat])
        return !booleanPointInPolygon(pt, landFeature as any)
      } catch {
        return true
      }
    })
  }, [filteredShipLatest, hideLand, landFeature])

  const filteredShipTrails = useMemo(() => {
    if (!tankersOnly || !tankerSet) return shipTrails
    return shipTrails.filter(t => tankerSet.has(t.mmsi))
  }, [shipTrails, tankerSet, tankersOnly])

  const visibleShipTrails = useMemo(() => {
    if (!hideLand || !landFeature) return filteredShipTrails
    return filteredShipTrails.filter(t => {
      const last = t.points[t.points.length - 1]
      if (!last) return false
      try {
        const pt = turfPoint([last[1], last[0]])
        return !booleanPointInPolygon(pt, landFeature as any)
      } catch {
        return true
      }
    })
  }, [filteredShipTrails, hideLand, landFeature])

  const selectedShip = useMemo(() => {
    if (!selectedMmsi) return null
    const latest = shipLatest.find(s => s.mmsi === selectedMmsi)
    const staticData = staticInfo[selectedMmsi]
    const extra = shipDetails[selectedMmsi]
    const trail = shipTrailsMap[selectedMmsi] ?? []
    return { mmsi: selectedMmsi, latest, staticData, extra, trail }
  }, [selectedMmsi, shipLatest, staticInfo, shipDetails, shipTrailsMap])

  const fetchShipDetails = async (mmsi: string) => {
    if (shipDetails[mmsi]) return
    try {
      const res = await fetch(`/aishub?mmsi=${encodeURIComponent(mmsi)}`)
      if (!res.ok) return
      const data = await res.json()
      if (data?.error) return
      setShipDetails(prev => ({ ...prev, [mmsi]: data }))
    } catch {
      // ignore
    }
  }

  const bounds = useMemo(() => {
    return [
      [bbox.latMin, bbox.lonMin],
      [bbox.latMax, bbox.lonMax],
    ] as [[number, number], [number, number]]
  }, [bbox])

  const mapViewRef = useRef<{ center: [number, number]; zoom: number } | null>(null)
  const userMovedRef = useRef(false)

  function MapStateHandler() {
    const map = useMapEvents({
      moveend: () => {
        const c = map.getCenter()
        mapViewRef.current = { center: [c.lat, c.lng], zoom: map.getZoom() }
        userMovedRef.current = true
      },
      zoomend: () => {
        const c = map.getCenter()
        mapViewRef.current = { center: [c.lat, c.lng], zoom: map.getZoom() }
        userMovedRef.current = true
      },
    })
    return null
  }

  function RestoreSavedView() {
    const map = useMap()
    useEffect(() => {
      if (mapViewRef.current) {
        map.setView(mapViewRef.current.center, mapViewRef.current.zoom, { animate: false })
        userMovedRef.current = true
      }
      // Runs once on mount — remounting the map should not fight the user's pan
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
    return null
  }

  function FitBoundsOnce() {
    const map = useMap()
    const lastKeyRef = useRef('')
    const key = `${bounds[0][0]},${bounds[0][1]},${bounds[1][0]},${bounds[1][1]}`
    useEffect(() => {
      if (lastKeyRef.current !== key) {
        if (!userMovedRef.current) {
          map.fitBounds(bounds, { padding: [20, 20] })
        }
        lastKeyRef.current = key
      }
    }, [map, key])
    return null
  }

  return (
    <div className="h-full overflow-y-auto bg-surface">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border">
        <span className="panel-header text-orange font-bold text-xs tracking-widest">TRACKING</span>
        <span className="text-secondary text-xs">F7</span>
      </div>

      <div className="p-4 space-y-4">
        <div className="flex items-center gap-2">
          {(['FLIGHTS', 'TANKERS'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1 text-xs font-mono tracking-wider font-semibold border
                ${tab === t ? 'text-orange border-orange' : 'text-secondary border-border hover:text-primary'}
              `}
            >
              {t}
            </button>
          ))}
        </div>

        <section className="border border-border bg-surface2 p-3">
          <div className="text-secondary text-xs font-mono mb-2 tracking-wider">REGION (BOUNDING BOX)</div>
          <div className="flex items-center gap-2 mb-2">
            {([
              { label: 'GLOBAL', box: { latMin: -60, latMax: 70, lonMin: -180, lonMax: 180 } },
              { label: 'AMER', box: { latMin: -55, latMax: 70, lonMin: -170, lonMax: -20 } },
              { label: 'EU', box: { latMin: 30, latMax: 70, lonMin: -20, lonMax: 40 } },
              { label: 'MENA', box: { latMin: 10, latMax: 45, lonMin: 30, lonMax: 80 } },
              { label: 'ASIA', box: { latMin: 0, latMax: 55, lonMin: 80, lonMax: 150 } },
            ] as const).map(p => (
              <button
                key={p.label}
                className="text-xs font-mono text-secondary border border-border px-2 py-1 hover:text-primary"
                onClick={() => setBbox(p.box)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs font-mono">
            <label className="flex items-center gap-2">
              <span className="text-secondary w-16">Lat Min</span>
              <input
                className="flex-1 bg-bg border border-border px-2 py-1 text-primary"
                type="number"
                value={bbox.latMin}
                onChange={(e) => setBbox(b => ({ ...b, latMin: Number(e.target.value) }))}
              />
            </label>
            <label className="flex items-center gap-2">
              <span className="text-secondary w-16">Lat Max</span>
              <input
                className="flex-1 bg-bg border border-border px-2 py-1 text-primary"
                type="number"
                value={bbox.latMax}
                onChange={(e) => setBbox(b => ({ ...b, latMax: Number(e.target.value) }))}
              />
            </label>
            <label className="flex items-center gap-2">
              <span className="text-secondary w-16">Lon Min</span>
              <input
                className="flex-1 bg-bg border border-border px-2 py-1 text-primary"
                type="number"
                value={bbox.lonMin}
                onChange={(e) => setBbox(b => ({ ...b, lonMin: Number(e.target.value) }))}
              />
            </label>
            <label className="flex items-center gap-2">
              <span className="text-secondary w-16">Lon Max</span>
              <input
                className="flex-1 bg-bg border border-border px-2 py-1 text-primary"
                type="number"
                value={bbox.lonMax}
                onChange={(e) => setBbox(b => ({ ...b, lonMax: Number(e.target.value) }))}
              />
            </label>
          </div>
        </section>

        {tab === 'FLIGHTS' && (
          <>
            <section className="border border-border bg-surface2 p-3">
              <div className="text-secondary text-xs font-mono mb-2 tracking-wider">FLIGHT FILTERS (GOV / MIL)</div>
              <div className="flex items-center gap-3 text-xs font-mono mb-2">
                <label className="text-secondary flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={govMilOnly}
                    onChange={(e) => setGovMilOnly(e.target.checked)}
                  />
                  Only gov/mil (heuristic)
                </label>
                <span className="text-secondary">
                  Uses callsign prefixes + origin country from OpenSky.
                </span>
              </div>
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-2 text-xs font-mono">
                <label className="flex items-center gap-2">
                  <span className="text-secondary w-20">Countries</span>
                  <input
                    className="flex-1 bg-bg border border-border px-2 py-1 text-primary"
                    value={countryFilter}
                    onChange={(e) => setCountryFilter(e.target.value)}
                    placeholder="United States, United Kingdom"
                  />
                </label>
                <label className="flex items-center gap-2">
                  <span className="text-secondary w-20">Prefixes</span>
                  <input
                    className="flex-1 bg-bg border border-border px-2 py-1 text-primary"
                    value={prefixFilter}
                    onChange={(e) => setPrefixFilter(e.target.value)}
                    placeholder="AF1, SAM, RCH"
                  />
                </label>
              </div>
              <div className="text-secondary text-[10px] font-mono mt-2">
                Note: There is no official “government/military” flag in OpenSky; this filter is best‑effort.
              </div>
            </section>

            <section className="border border-border bg-surface2 p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-secondary text-xs font-mono tracking-wider">FLIGHTS (OPENSKY)</span>
                <span className="text-secondary text-xs font-mono">
                  {flightsLoading ? 'LOADING' : flightsError ? 'ERROR' : `${flightRows.length} ACTIVE`}
                </span>
              </div>
              {flightsError && <div className="text-red text-xs font-mono mb-2">{flightsError}</div>}
              <div className="space-y-1">
                {flightRows.slice(0, 8).map(f => (
                  <Stat
                    key={f.icao24}
                    label={`${f.callsign ?? f.icao24}`.trim() || f.icao24}
                    value={`${f.latitude?.toFixed(2)}, ${f.longitude?.toFixed(2)}  ${f.velocity ? Math.round(f.velocity) + ' m/s' : ''}`}
                  />
                ))}
              </div>
              {flightRows.length > 8 && (
                <div className="text-secondary text-[10px] font-mono mt-2">Showing 8 of {flightRows.length}</div>
              )}
            </section>
          </>
        )}

        {tab === 'TANKERS' && (
          <>
            <section className="border border-border bg-surface2 p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-secondary text-xs font-mono tracking-wider">SHIPS (AISSTREAM)</span>
                <div className="flex items-center gap-2 text-xs font-mono">
                  <label className="text-secondary flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={shipsEnabled}
                      onChange={(e) => setShipsEnabled(e.target.checked)}
                    />
                    Stream
                  </label>
                  <span className="text-secondary">
                    {shipsEnabled ? (shipsConnected ? 'LIVE' : 'CONNECTING') : 'OFF'}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-3 text-xs font-mono mb-2">
                <label className="text-secondary flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={tankersOnly}
                    onChange={(e) => setTankersOnly(e.target.checked)}
                  />
                  Tankers only (AIS type 80–89)
                </label>
                {tankersOnly && !tankerSet && (
                  <span className="text-secondary text-[10px] font-mono">
                    Waiting for AIS static type data — showing all ships until types arrive.
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 text-xs font-mono mb-2">
                <label className="text-secondary flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={hideLand}
                    onChange={(e) => setHideLand(e.target.checked)}
                  />
                  Hide ships on land
                </label>
              </div>
              {shipsError && <div className="text-red text-xs font-mono mb-2">{shipsError}</div>}
              {!shipsEnabled && (
                <div className="text-secondary text-xs font-mono">
                  Toggle streaming on. Requires `AISSTREAM_API_KEY` set in the dev server environment.
                </div>
              )}
              {shipsEnabled && ships.length === 0 && (
                <div className="text-secondary text-xs font-mono">
                  No AIS messages yet. Try a tighter bounding box over busy sea lanes.
                </div>
              )}
              <div className="space-y-1 mt-2">
                {ships.slice(0, 8).map((s, i) => (
                  <Stat
                    key={`${s.mmsi}-${i}`}
                    label={`${s.shipName ?? s.mmsi}`.trim()}
                    value={`${s.lat?.toFixed(2)}, ${s.lon?.toFixed(2)}  ${s.sog ? Math.round(s.sog) + ' kn' : ''}`}
                  />
                ))}
              </div>
            </section>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
              <section className="border border-border bg-surface2 p-3 xl:col-span-2">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-secondary text-xs font-mono tracking-wider">SHIP MAP (ZOOMABLE)</span>
                  <span className="text-secondary text-xs font-mono">
                  {shipsEnabled ? (shipsConnected ? `${visibleShipLatest.length} LIVE` : 'CONNECTING') : 'OFF'}
                  </span>
                </div>
                {!shipsEnabled && (
                  <div className="text-secondary text-xs font-mono">
                    Enable streaming above to see live ships on the map.
                  </div>
                )}
                {shipsEnabled && (
                  <div className="h-[620px] border border-border">
                  <MapContainer
                    style={{ height: '100%', width: '100%' }}
                    scrollWheelZoom
                  >
                    <RestoreSavedView />
                    <FitBoundsOnce />
                    <MapStateHandler />
                      <TileLayer
                        attribution="&copy; OpenStreetMap contributors"
                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                      />
                      {visibleShipTrails.map(t => (
                        <Polyline key={t.mmsi} positions={t.points} pathOptions={{ color: '#ff6600', weight: 2, opacity: 0.6 }} />
                      ))}
                      {visibleShipLatest.map(s => (
                        <CircleMarker
                          key={s.mmsi}
                          center={[s.lat, s.lon]}
                          radius={selectedMmsi === s.mmsi ? 6 : 4}
                          pathOptions={{ color: selectedMmsi === s.mmsi ? '#ffcc00' : '#00e676', weight: 1, fillOpacity: 0.8 }}
                          eventHandlers={{
                            click: () => {
                              setSelectedMmsi(s.mmsi)
                              fetchShipDetails(s.mmsi)
                            },
                          }}
                        />
                      ))}
                    </MapContainer>
                  </div>
                )}
              </section>

              <section className="border border-border bg-surface2 p-3">
                <div className="text-secondary text-xs font-mono mb-2 tracking-wider">SHIP WIDGET</div>
                {!selectedShip && (
                  <div className="text-secondary text-xs font-mono">
                    Click a ship on the map to view details and history.
                  </div>
                )}
                {selectedShip && (
                  <div className="space-y-2">
                    <div className="text-primary text-sm font-mono font-semibold">
                      {selectedShip.staticData?.shipName ?? selectedShip.latest?.shipName ?? selectedShip.mmsi}
                    </div>
                    <div className="text-secondary text-xs font-mono">MMSI: {selectedShip.mmsi}</div>
                    <div className="space-y-1">
                      <Stat label="From (last pos)" value={selectedShip.latest ? `${selectedShip.latest.lat.toFixed(2)}, ${selectedShip.latest.lon.toFixed(2)}` : '—'} />
                      <Stat label="Destination" value={String(selectedShip.staticData?.destination ?? selectedShip.extra?.DEST ?? '—')} />
                      <Stat label="ETA" value={String(selectedShip.staticData?.eta ?? selectedShip.extra?.ETA ?? '—')} />
                      <Stat label="Callsign" value={String(selectedShip.staticData?.callSign ?? selectedShip.extra?.CALLSIGN ?? '—')} />
                      <Stat label="Type" value={String(selectedShip.staticData?.shipType ?? selectedShip.extra?.TYPE ?? '—')} />
                      <Stat label="Speed" value={selectedShip.latest?.sog ? `${Math.round(selectedShip.latest.sog)} kn` : '—'} />
                      <Stat label="Course" value={selectedShip.latest?.cog ? `${Math.round(selectedShip.latest.cog)}°` : '—'} />
                      <Stat label="Last Seen" value={selectedShip.latest?.lastSeen ? new Date(selectedShip.latest.lastSeen).toLocaleTimeString('en-US', { hour12: false }) : '—'} />
                    </div>
                    <div className="mt-2">
                      <div className="text-secondary text-xs font-mono mb-1">HISTORY (latest 10)</div>
                      <div className="max-h-40 overflow-y-auto space-y-1">
                        {(selectedShip.trail ?? []).slice(-10).reverse().map((p, i) => (
                          <div key={i} className="text-secondary text-xs font-mono">
                            {p.time ?? '—'} · {p.lat.toFixed(2)}, {p.lon.toFixed(2)}
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="text-secondary text-[10px] font-mono">
                      Note: “From” is inferred by AIS metadata availability. Destination/ETA come from AIS static data or AISHub if configured.
                    </div>
                  </div>
                )}
              </section>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
