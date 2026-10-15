// src/lib/reconcile.js
import { supabase } from '../supabase'

/** Parse "Transaction ID,Amount,Time" CSV → array of rows */
export function parseStatementCsv(text) {
  const lines = text
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0)

  if (lines.length === 0) return []

  // Header detection: if first line has letters, skip it
  const first = lines[0].toLowerCase()
  const startIdx = first.includes('transaction') || first.includes('amount') || first.includes('time') ? 1 : 0

  const rows = []
  for (let i = startIdx; i < lines.length; i++) {
    const parts = lines[i].split(',')
    if (parts.length < 3) continue
    const txn_id = parts[0].trim()
    const amount = Number(String(parts[1]).replace(/[^\d.-]/g, ''))
    const timeRaw = parts[2].trim()

    if (!txn_id || !amount || !timeRaw) continue

    // Parse "2026-10-15 15:22:33" as Uganda time → ISO UTC
    // Uganda = UTC+3 → subtract 3 hours
    const m = timeRaw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/)
    if (!m) continue
    const [, Y, Mo, D, h, mi, s = '00'] = m
    const utcMs = Date.UTC(
      Number(Y), Number(Mo) - 1, Number(D),
      Number(h) - 3, Number(mi), Number(s)
    )
    const received_at = new Date(utcMs).toISOString()

    rows.push({ txn_id, amount, received_at })
  }
  return rows
}

/**
 * Reconcile a parsed statement against the transactions table.
 * - Rows with existing txn_id → skipped (marked reconciled)
 * - Rows without → inserted with status='pending_claim', source='reconcile'
 * Returns a summary.
 */
export async function reconcileStatement({
  stationId,
  provider,              // 'mtn' | 'airtel'
  userId,
  rows,                  // parsed rows
  fileName,              // optional
}) {
  if (!stationId) throw new Error('stationId required')
  if (!['mtn', 'airtel'].includes(provider)) throw new Error('provider must be mtn or airtel')
  if (!rows?.length) throw new Error('no rows to reconcile')

  // 1. Fetch all existing txn_ids for this station+provider
  const txnIds = rows.map(r => String(r.txn_id))
  const existing = new Set()

  // Supabase has a .in() limit — chunk in 500s
  for (let i = 0; i < txnIds.length; i += 500) {
    const chunk = txnIds.slice(i, i + 500)
    const { data, error } = await supabase
      .from('transactions')
      .select('txn_id')
      .eq('station_id', stationId)
      .eq('provider', provider)
      .in('txn_id', chunk)
    if (error) throw error
    ;(data || []).forEach(t => existing.add(String(t.txn_id)))
  }

  const newRows = rows.filter(r => !existing.has(String(r.txn_id)))

  // 2. Insert new rows
  const now = new Date().toISOString()
  let inserted = 0
  let insertError = null

  if (newRows.length > 0) {
    // Supabase bulk insert — build the payload
    const payload = newRows.map(r => ({
      txn_id: String(r.txn_id),
      amount: Number(r.amount),
      station_id: stationId,
      provider,
      received_at: r.received_at,
      status: 'pending_claim',
      source: 'reconcile',
      reconciled_at: now,
      reconciled_by: userId,
    }))

    // Insert in chunks of 500
    for (let i = 0; i < payload.length; i += 500) {
      const slice = payload.slice(i, i + 500)
      const { error } = await supabase.from('transactions').insert(slice)
      if (error) { insertError = error; break }
      inserted += slice.length
    }
  }

  // 3. Mark existing rows as reconciled (update source + reconciled_at)
  if (existing.size > 0) {
    const existingIds = Array.from(existing)
    for (let i = 0; i < existingIds.length; i += 500) {
      const chunk = existingIds.slice(i, i + 500)
      await supabase
        .from('transactions')
        .update({
          reconciled_at: now,
          reconciled_by: userId,
          // keep source as-is if it was 'sms', but mark reconciled
        })
        .eq('station_id', stationId)
        .eq('provider', provider)
        .in('txn_id', chunk)
    }
  }

  // 4. Portal-only: rows in portal (this provider + this date window) not in the statement
  //    We use the statement's time range as the window.
  let portalOnlyCount = 0
  if (rows.length > 0) {
    const times = rows.map(r => r.received_at).sort()
    const minT = times[0]
    const maxT = times[times.length - 1]
    const { data: portalRows } = await supabase
      .from('transactions')
      .select('txn_id')
      .eq('station_id', stationId)
      .eq('provider', provider)
      .gte('received_at', minT)
      .lte('received_at', maxT)
    const stmtSet = new Set(txnIds)
    portalOnlyCount = (portalRows || []).filter(t => !stmtSet.has(String(t.txn_id))).length
  }

  // 5. Log the run
  const summary = {
    total_rows: rows.length,
    matched_count: existing.size,
    inserted_count: inserted,
    portal_only_count: portalOnlyCount,
  }

  await supabase.from('reconciliation_runs').insert({
    station_id: stationId,
    provider,
    performed_by: userId,
    file_name: fileName || null,
    total_rows: summary.total_rows,
    matched_count: summary.matched_count,
    inserted_count: summary.inserted_count,
    portal_only_count: summary.portal_only_count,
  })

  return { ...summary, insertError: insertError?.message || null }
}