import { ResponsiveContainer, Treemap, Tooltip } from 'recharts'
import { useSp500Treemap } from '../hooks/useSp500Treemap'

function colorForChange(chg: number) {
  if (chg > 1.5) return '#00cc44'
  if (chg > 0.2) return '#3ddc6f'
  if (chg < -1.5) return '#ff3333'
  if (chg < -0.2) return '#ff6666'
  return chg >= 0 ? '#2fcf69' : '#ff7777'
}

function Cell(props: any) {
  const { x, y, width, height, name, changePct } = props
  const fill = colorForChange(Number(changePct ?? 0))
  const showLabel = width > 32 && height > 14
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} stroke="#0f0f0f" fill={fill} />
      {showLabel && (
        <>
          <text x={x + 4} y={y + 12} fill="#e5e7eb" fontSize={9} fontFamily="JetBrains Mono">
            {name}
          </text>
          <text x={x + 4} y={y + 22} fill="#9ca3af" fontSize={8} fontFamily="JetBrains Mono">
            {Number(changePct ?? 0).toFixed(2)}%
          </text>
        </>
      )}
    </g>
  )
}

function TreemapTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const p = payload[0]?.payload
  if (!p) return null
  return (
    <div className="bg-surface2 border border-border px-2 py-1 text-xs font-mono">
      <div className="text-primary">{p.name}</div>
      {p.fullName && <div className="text-secondary">{p.fullName}</div>}
      <div className="text-secondary">Change: {Number(p.changePct ?? 0).toFixed(2)}%</div>
    </div>
  )
}

export function Sp500Treemap() {
  const { treemapData, loading, error } = useSp500Treemap()

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-bg">
        <span className="text-secondary text-xs font-mono animate-pulse">[LOADING TREEMAP...]</span>
      </div>
    )
  }
  if (error) {
    return (
      <div className="h-full flex items-center justify-center bg-bg">
        <span className="text-red text-xs font-mono">[ERR: {error}]</span>
      </div>
    )
  }

  return (
    <div className="h-full bg-bg border-b border-border flex flex-col">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-surface">
        <span className="panel-header text-primary font-bold text-xs tracking-wide">S&P 500 MAP</span>
        <span className="text-secondary text-xs font-mono">
          {treemapData.children.length} STOCKS · MARKET CAP WEIGHTED
        </span>
      </div>
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <Treemap
            data={treemapData.children}
            dataKey="value"
            ratio={4 / 3}
            stroke="#0f0f0f"
            content={<Cell />}
          >
            <Tooltip content={<TreemapTooltip />} />
          </Treemap>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
