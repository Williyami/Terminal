/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0a0a0a',
        surface: '#111111',
        surface2: '#1a1a1a',
        border: '#222222',
        orange: '#ff6600',
        'orange-dim': '#cc5200',
        primary: '#e8e8e8',
        secondary: '#888888',
        green: '#00cc44',
        red: '#ff3333',
        blue: '#4488ff',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Consolas', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
}

