import { EchelonLogo } from './EchelonLogo'

type Panel = 'HOME' | 'OPTIONS' | 'MACRO' | 'FLOW' | 'NEWS' | 'PORTFOLIO' | 'TRACKING' | 'SPREADSHEET' | 'STOCKS'

const PANELS: Panel[] = ['HOME', 'OPTIONS', 'MACRO', 'FLOW', 'NEWS', 'PORTFOLIO', 'TRACKING', 'SPREADSHEET', 'STOCKS']

interface NavBarProps {
  active: Panel
  onSelect: (p: Panel) => void
}

export function NavBar({ active, onSelect }: NavBarProps) {
  return (
    <div className="flex items-center bg-surface border-b border-border px-3 gap-1" style={{ height: '36px', minHeight: '36px' }}>
      <div className="flex items-center gap-2 mr-4">
        <EchelonLogo size={18} />
        <span className="text-orange font-bold text-sm tracking-widest font-mono">ECHELON</span>
      </div>
      {PANELS.map((p, i) => (
        <button
          key={p}
          onClick={() => onSelect(p)}
          className={`px-3 py-1 text-xs font-mono tracking-wider font-semibold transition-colors
            ${active === p
              ? 'text-orange border-b-2 border-orange'
              : 'text-secondary hover:text-primary'
            }`}
          title={`F${i + 1}`}
        >
          {p}
        </button>
      ))}
      <div className="ml-auto text-xs text-secondary font-mono">
        <span className="text-secondary">F1–F9</span>
      </div>
    </div>
  )
}

export type { Panel }
