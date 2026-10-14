// src/lib/time.js
// Uganda is UTC+3 year-round (no DST).

export const TZ = 'Africa/Kampala'

export function todayEAT() {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ })
}

export function timeEAT(date) {
  return new Date(date).toLocaleTimeString('en-GB', {
    timeZone: TZ,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function hmEAT(date) {
  return new Date(date).toLocaleTimeString('en-GB', {
    timeZone: TZ,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function dateTimeEAT(date) {
  return new Date(date).toLocaleString('en-GB', {
    timeZone: TZ,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

export function dateShortEAT(date) {
  return new Date(date).toLocaleDateString('en-GB', {
    timeZone: TZ,
    day: '2-digit',
    month: 'short',
  })
}

export function eatToISO(dateStr, timeStr = '00:00') {
  const [y, m, d] = dateStr.split('-').map(Number)
  const [hh, mm] = timeStr.split(':').map(Number)
  const utcMs = Date.UTC(y, m - 1, d, hh - 3, mm, 0)
  return new Date(utcMs).toISOString()
}

export function addDaysEAT(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + n)
  const yy = dt.getUTCFullYear()
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(dt.getUTCDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}