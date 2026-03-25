export function EchelonLogo({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
      className="echelon-logo"
      aria-label="Echelon"
    >
      {/* No background rect — transparent so invert works cleanly */}
      <circle cx="50" cy="50" r="45" fill="none" stroke="currentColor" strokeWidth="3" opacity="0.3" />
      <rect x="25" y="30" width="50" height="6" fill="currentColor" />
      <rect x="35" y="47" width="40" height="6" fill="currentColor" />
      <rect x="45" y="64" width="30" height="6" fill="currentColor" />
      <rect x="25" y="30" width="4" height="40" fill="currentColor" />
    </svg>
  )
}
