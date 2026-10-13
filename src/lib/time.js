// src/lib/time.js
// Uganda is UTC+3 year-round (no DST).

export const TZ = 'Africa/Kampala'

/** Today as "YYYY-MM-DD" in Uganda time */
export function todayEAT() {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ })
}

/** "14:23:07" in Uganda time */
export function timeEAT(date) {
  return new Date(date).toLocaleTimeString('en-GB', {
    timeZone: TZ,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

/** "14:23" in Uganda time */
export function hmEAT(date) {
  return new Date(date).toLocaleTimeString('en-GB', {
    timeZone: TZ,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** "13 Oct 2026, 14:23" in Uganda time */
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

/** "13 Oct" in Uganda time */
export function dateShortEAT(date) {
  return new Date(date).toLocaleDateString('en-GB', {
    timeZone: TZ,
    day: '2-digit',
    month: 'short',
  })
}

/**
 * Convert Uganda wall-clock (date + time) to a real ISO string.
 * Example: eatToISO("2026-10-13", "09:00") → "2026-10-13T06:00:00.000Z"
 */
export function eatToISO(dateStr, timeStr = '00:00') {
  const [y, m, d] = dateStr.split('-').map(Number)
  const [hh, mm] = timeStr.split(':').map(Number)
  // Uganda = UTC+3, so subtract 3 hours to get UTC
  const utcMs = Date.UTC(y, m - 1, d, hh - 3, mm, 0)
  return new Date(utcMs).toISOString()
}