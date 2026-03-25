import type { WorldMarket } from '../hooks/useWorldMarkets'
import { geoEquirectangular, geoGraticule10, geoPath } from 'd3-geo'
import { feature } from 'topojson-client'
import worldData from 'world-atlas/land-50m.json'

// ── Equirectangular projection ───────────────────────────────────────────────
// ViewBox: 0 0 500 240
const W = 500, H = 240

type TopologyLike = {
  objects: {
    land: object
  }
}

const world = worldData as unknown as TopologyLike
const land = feature(world as never, world.objects.land as never)
const projection = geoEquirectangular().fitSize([W, H], land as never)
const path = geoPath(projection)
const graticule = geoGraticule10()

// ── Color helpers ─────────────────────────────────────────────────────────────
function dotColor(pct: number | null, loaded: boolean): string {
  if (!loaded || pct === null) return '#444'
  if (pct >=  2)   return '#00e676'
  if (pct >=  0.5) return '#4caf50'
  if (pct >= -0.5) return '#888888'
  if (pct >= -2)   return '#ef5350'
  return '#ff1744'
}

function fmtPct(pct: number): string {
  return (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%'
}

// ── Component ─────────────────────────────────────────────────────────────────
interface Props {
  markets: WorldMarket[]
  compact?: boolean   // true = sidebar (no labels), false = full page
  loading?: boolean
}

export function WorldMap({ markets, compact = false, loading = false }: Props) {
  const r = compact ? 2.5 : 4

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: '100%', display: 'block' }}
      className="select-none"
    >
      {/* Ocean background */}
      <rect width={W} height={H} fill="#0d1117" />

      {/* Graticule (grid lines) */}
      <path d={path(graticule) ?? ''} stroke="#1a2230" strokeWidth="0.5" fill="none" />

      {/* Landmass */}
      <path d={path(land) ?? ''} fill="#1c2433" stroke="#2a3a50" strokeWidth="0.7" strokeLinejoin="round" />

      {/* Market dots + labels */}
      {markets.map(m => {
        const projected = projection([m.lon, m.lat])
        if (!projected) return null
        const [x, y] = projected
        const color = dotColor(m.changePct, !loading && m.value !== null)
        const isPos = m.changePct >= 0

        return (
          <g key={m.symbol}>
            {/* Glow ring for large moves */}
            {!loading && Math.abs(m.changePct) >= 1.5 && (
              <circle cx={x} cy={y} r={r + 3} fill="none" stroke={color} strokeWidth="0.8" opacity="0.4" />
            )}
            <circle cx={x} cy={y} r={r} fill={color} opacity={loading ? 0.4 : 0.9} />

            {!compact && m.value !== null && (
              <>
                {/* Label background */}
                <rect
                  x={x + r + 2} y={y - 8}
                  width={32} height={16}
                  fill="#0d1117" opacity="0.7" rx="1"
                />
                <text
                  x={x + r + 4} y={y - 1}
                  fontSize="7" fontFamily="monospace" fill="#cccccc"
                >{m.label}</text>
                <text
                  x={x + r + 4} y={y + 7}
                  fontSize="6.5" fontFamily="monospace"
                  fill={isPos ? '#4caf50' : '#ef5350'}
                >{fmtPct(m.changePct)}</text>
              </>
            )}

            {compact && (
              <title>{m.label}: {m.value != null ? fmtPct(m.changePct) : 'N/A'}</title>
            )}
          </g>
        )
      })}

      {/* Loading pulse overlay */}
      {loading && (
        <rect width={W} height={H} fill="transparent">
          <animate attributeName="opacity" values="0;0.05;0" dur="1.5s" repeatCount="indefinite" />
        </rect>
      )}
    </svg>
  )
}
