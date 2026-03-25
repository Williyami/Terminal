import { useEffect, useMemo, useState } from 'react'

interface CityClock {
  label: string
  timeZone: string
  time: string
  isOpen: boolean
}

const CITIES: Array<{ label: string; timeZone: string; open: { start: string; end: string; weekdays: number[] } }> = [
  { label: 'NYC', timeZone: 'America/New_York', open: { start: '09:30', end: '16:00', weekdays: [1, 2, 3, 4, 5] } },
  { label: 'LON', timeZone: 'Europe/London', open: { start: '08:00', end: '16:30', weekdays: [1, 2, 3, 4, 5] } },
  { label: 'PAR', timeZone: 'Europe/Paris', open: { start: '09:00', end: '17:30', weekdays: [1, 2, 3, 4, 5] } },
  { label: 'DXB', timeZone: 'Asia/Dubai', open: { start: '10:00', end: '14:00', weekdays: [0, 1, 2, 3, 4] } },
  { label: 'HKG', timeZone: 'Asia/Hong_Kong', open: { start: '09:30', end: '16:00', weekdays: [1, 2, 3, 4, 5] } },
  { label: 'TYO', timeZone: 'Asia/Tokyo', open: { start: '09:00', end: '15:00', weekdays: [1, 2, 3, 4, 5] } },
]

function fmt(timeZone: string) {
  return new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  }).format(new Date())
}

function isOpen(timeZone: string, open: { start: string; end: string; weekdays: number[] }) {
  const now = new Date()
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short',
  }).formatToParts(now)

  const hour = Number(parts.find(p => p.type === 'hour')?.value ?? '0')
  const minute = Number(parts.find(p => p.type === 'minute')?.value ?? '0')
  const weekdayStr = parts.find(p => p.type === 'weekday')?.value ?? 'Mon'
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  const weekday = weekdayMap[weekdayStr] ?? 1

  if (!open.weekdays.includes(weekday)) return false

  const [sh, sm] = open.start.split(':').map(Number)
  const [eh, em] = open.end.split(':').map(Number)
  const mins = hour * 60 + minute
  const start = sh * 60 + sm
  const end = eh * 60 + em
  return mins >= start && mins <= end
}

export function useWorldClock(intervalMs = 60000): CityClock[] {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])

  return useMemo(() => {
    return CITIES.map(c => ({
      label: c.label,
      timeZone: c.timeZone,
      time: fmt(c.timeZone),
      isOpen: isOpen(c.timeZone, c.open),
    }))
  }, [tick])
}
