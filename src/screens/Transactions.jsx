import { useEffect, useMemo, useState } from 'react'
import ExcelJS from 'exceljs'
import { supabase } from '../supabase'

export default function Transactions({ profile }) {
  const user = profile.user
  const isManager = ['admin','manager'].includes(user.role)
  const isSupervisor = user.role === 'supervisor'
  const isAttendant = user.role === 'attendant'
  const isAmbassador = user.role === 'ambassador'
  const [onShift, setOnShift] = useState(true)

  const powers = profile.powers || {}
  const canViewAll = isManager || isSupervisor || powers.view_transactions

  const [rows, setRows] = useState([])
  const [staffCodes, setStaffCodes] = useState({})     // user_id -> { code, color, name }
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState({
    from: new Date().toISOString().slice(0,10),
    to: new Date().toISOString().slice(0,10),
    timeFrom: '',
    timeTo: '',
    provider: 'all',
    attendant: 'all',
    status: 'all',
    search: '',
  })

  // Load staff codes map
  async function loadStaffCodes() {
    const { data } = await supabase
      .from('staff_codes')
      .select('user_id, code, color, users(name, role, station_id)')
      .eq('station_id', user.station_id)
    const map = {}
    ;(data || []).forEach(sc => {
      map[sc.user_id] = { code: sc.code, color: sc.color, name: sc.users?.name || '—' }
    })
    setStaffCodes(map)
  }

  async function loadTransactions() {
    setLoading(true)
    try {
      const fromISO = filter.from + 'T00:00:00'
      const toISO = filter.to + 'T23:59:59'

      let q = supabase
        .from('transactions')
        .select('*')
        .eq('station_id', user.station_id)
        .gte('received_at', fromISO)
        .lte('received_at', toISO)
        .order('received_at', { ascending: false })
        .limit(2000)

      // Attendants/ambassadors: only own
      if (!canViewAll) {
        q = q.eq('claimed_by', user.id)
      }

      const { data, error } = await q
      if (error) throw error

      // Apply client-side filters (time, provider, attendant, status, search)
      let result = data || []
      if (filter.timeFrom) {
        result = result.filter(t => String(t.received_at).slice(11,16) >= filter.timeFrom)
      }
      if (filter.timeTo) {
        result = result.filter(t => String(t.received_at).slice(11,16) <= filter.timeTo)
      }
      if (filter.provider !== 'all') {
        result = result.filter(t => t.provider === filter.provider)
      }
      if (filter.attendant !== 'all') {
        result = result.filter(t => t.claimed_by === filter.attendant)
      }
      if (filter.status !== 'all') {
        result = result.filter(t => t.status === filter.status)
      }
      if (filter.search) {
        const s = filter.search.toLowerCase()
        result = result.filter(t =>
          String(t.txn_id).toLowerCase().includes(s) ||
          String(t.amount).includes(s) ||
          (t.customer_name || '').toLowerCase().includes(s)
        )
      }
      setRows(result)
    } catch (e) {
      console.error('Load transactions error:', e)
    }
    setLoading(false)
  }

  useEffect(() => { loadStaffCodes() }, [user.station_id])
  useEffect(() => { loadTransactions() }, [user.station_id, filter])

  // Stats
  const stats = useMemo(() => {
    const total = rows.reduce((s, r) => s + Number(r.amount || 0), 0)
    const claimed = rows.filter(r => r.status === 'claimed').length
    const unclaimed = rows.filter(r => r.status === 'unclaimed' || r.status === 'supervisor_notified').length
    return { total, claimed, unclaimed, count: rows.length }
  }, [rows])

  // Summary by attendant (for the right block in Excel)
  const byAttendant = useMemo(() => {
    const map = {}
    rows.forEach(r => {
      if (!r.claimed_by) return
      if (!map[r.claimed_by]) {
        const sc = staffCodes[r.claimed_by]
        map[r.claimed_by] = {
          user_id: r.claimed_by,
          name: sc?.name || '—',
          code: sc?.code || '—',
          color: sc?.color || '#64748B',
          total: 0,
          count: 0,
        }
      }
      map[r.claimed_by].total += Number(r.amount || 0)
      map[r.claimed_by].count++
    })
    return Object.values(map).sort((a,b) => b.total - a.total)
  }, [rows, staffCodes])

  // Best attendant
  const best = byAttendant[0] || null

  // ---- Excel export
  async function exportExcel(provider) {
    // Filter to that provider
    const list = rows.filter(r => r.provider === provider)
    if (list.length === 0) {
      alert('No ' + provider + ' transactions in this range')
      return
    }

    const wb = new ExcelJS.Workbook()
    wb.creator = 'TEXOL Legacy'
    wb.created = new Date()

    const sheet = wb.addWorksheet(
      provider === 'airtel' ? 'Airtel Money' : 'MTN MoMo',
      { views: [{ state: 'frozen', ySplit: 1 }] }
    )

    // Columns: A = Time, B = Txn ID, C = Amount, D = spacer, E = Name, F = Total
    sheet.columns = [
      { key: 'time',   width: 12 },
      { key: 'txn',    width: 20 },
      { key: 'amount', width: 14 },
      { key: 'sp',     width: 3 },
      { key: 'name',   width: 22 },
      { key: 'total',  width: 16 },
    ]

    // Header row
    const header = sheet.getRow(1)
    header.getCell('A').value = 'TIME'
    header.getCell('B').value = 'TXN ID'
    header.getCell('C').value = 'AMOUNT'
    header.getCell('E').value = 'NAME'
    header.getCell('F').value = 'TOTAL'
    for (let i = 1; i <= 6; i++) {
      const c = header.getCell(i)
      c.font = { bold: true, color: { argb: 'FFFFFFFF' } }
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B1A2E' } }
      c.alignment = { vertical: 'middle', horizontal: 'center' }
    }
    header.height = 22

    // Body rows: for each transaction, put time/txn/amount in A/B/C
    // Amount cell colored by claimed attendant
    list.slice().reverse().forEach((r, i) => {
      const rowNum = i + 2
      const row = sheet.getRow(rowNum)
      const time = new Date(r.received_at)
      const timeStr = String(time.getHours()).padStart(2,'0') + ':' +
                      String(time.getMinutes()).padStart(2,'0') + ':' +
                      String(time.getSeconds()).padStart(2,'0')
      row.getCell(1).value = timeStr
      row.getCell(2).value = String(r.txn_id)
      row.getCell(2).numFmt = '@'  // text format so Excel doesn't scientific-notate
      row.getCell(3).value = Number(r.amount || 0)
      row.getCell(3).numFmt = '#,##0'

      // Color the amount cell by attendant
      const sc = r.claimed_by ? staffCodes[r.claimed_by] : null
      const colorHex = sc?.color ? sc.color.replace('#','').toUpperCase() : null
      if (colorHex) {
        row.getCell(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + colorHex } }
      }

      row.getCell(3).alignment = { horizontal: 'right' }
    })

    // Summary block on the right starting at row 3
    byAttendant.forEach((a, idx) => {
      const rowNum = 3 + idx
      const row = sheet.getRow(rowNum)
      row.getCell(5).value = a.name
      row.getCell(5).font = { bold: true, color: { argb: 'FFFFFFFF' } }
      const colorHex = a.color.replace('#','').toUpperCase()
      row.getCell(5).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + colorHex } }
      row.getCell(6).value = a.total
      row.getCell(6).numFmt = '#,##0'
      row.getCell(6).font = { bold: true }
      row.getCell(6).alignment = { horizontal: 'right' }
    })

    // Grand total row for the left block
    const totalRow = list.length + 2
    sheet.getRow(totalRow).getCell(2).value = 'TOTAL'
    sheet.getRow(totalRow).getCell(2).font = { bold: true }
    sheet.getRow(totalRow).getCell(3).value = list.reduce((s,r) => s + Number(r.amount || 0), 0)
    sheet.getRow(totalRow).getCell(3).numFmt = '#,##0'
    sheet.getRow(totalRow).getCell(3).font = { bold: true }
    sheet.getRow(totalRow).getCell(3).border = { top: { style: 'thin' } }

    // Download
    const buf = await wb.xlsx.writeBuffer()
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `transactions-${provider}-${filter.from}_to_${filter.to}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
  }

  const attendants = Object.entries(staffCodes)
    .map(([id, v]) => ({ id, name: v.name, code: v.code, color: v.color }))
    .sort((a,b) => a.name.localeCompare(b.name))

  return (
    <div className="txns-screen">
      <div className="txns-head">
        <div>
          <h3>Transactions</h3>
          <div className="sub">
            {stats.count} txn · UGX {stats.total.toLocaleString()} · {stats.claimed} claimed · {stats.unclaimed} unclaimed
          </div>
        </div>
        <div className="txns-actions">
          {canExport && (
            <>
              <button className="btn-ghost" onClick={() => exportExcel('airtel')}>
                <i className="fas fa-file-excel" style={{ color: '#dc2626' }} /> Download Airtel
              </button>
              <button className="btn-primary" onClick={() => exportExcel('mtn')}>
                <i className="fas fa-file-excel" style={{ color: '#f59e0b' }} /> Download MTN
              </button>
            </>
          )}
        </div>
      </div>

      <div className="staff-filters">
        <label style={{ alignSelf: 'center', fontSize: 13, color: '#6b85a0', fontWeight: 600 }}>From</label>
        <input type="date" value={filter.from} onChange={e => setFilter(f => ({ ...f, from: e.target.value }))} />
        <label style={{ alignSelf: 'center', fontSize: 13, color: '#6b85a0', fontWeight: 600 }}>To</label>
        <input type="date" value={filter.to} onChange={e => setFilter(f => ({ ...f, to: e.target.value }))} />
        <label style={{ alignSelf: 'center', fontSize: 13, color: '#6b85a0', fontWeight: 600 }}>Time</label>
        <input type="time" value={filter.timeFrom} onChange={e => setFilter(f => ({ ...f, timeFrom: e.target.value }))} />
        <input type="time" value={filter.timeTo} onChange={e => setFilter(f => ({ ...f, timeTo: e.target.value }))} />
        <select value={filter.provider} onChange={e => setFilter(f => ({ ...f, provider: e.target.value }))}>
          <option value="all">All providers</option>
          <option value="airtel">Airtel Money</option>
          <option value="mtn">MTN MoMo</option>
        </select>
        {canViewAll && (
          <select value={filter.attendant} onChange={e => setFilter(f => ({ ...f, attendant: e.target.value }))}>
            <option value="all">All attendants</option>
            {attendants.map(a => (
              <option key={a.id} value={a.id}>{a.code} · {a.name}</option>
            ))}
          </select>
        )}
        <select value={filter.status} onChange={e => setFilter(f => ({ ...f, status: e.target.value }))}>
          <option value="all">All statuses</option>
          <option value="claimed">Claimed</option>
          <option value="unclaimed">Unclaimed</option>
          <option value="supervisor_notified">Supervisor notified</option>
        </select>
        <input
          placeholder="Search txn id or amount"
          value={filter.search}
          onChange={e => setFilter(f => ({ ...f, search: e.target.value }))}
        />
        <button className="btn-ghost btn-sm" onClick={() => setFilter({
          from: new Date().toISOString().slice(0,10),
          to: new Date().toISOString().slice(0,10),
          timeFrom: '', timeTo: '',
          provider: 'all', attendant: 'all', status: 'all', search: '',
        })}>Today</button>
      </div>

      {/* Best attendant card */}
      {best && (
        <div className="best-card">
          <div className="best-label">🏆 Best attendant</div>
          <div className="best-name" style={{ color: best.color }}>
            {best.name}
          </div>
          <div className="best-meta">
            {best.count} transactions · UGX {best.total.toLocaleString()}
          </div>
        </div>
      )}

      {loading ? (
        <div className="drops-empty">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="drops-empty">
          <i className="fas fa-receipt" />
          <h4>No transactions</h4>
          <p>Adjust filters or check that SMS forwarder is running.</p>
        </div>
      ) : (
        <div className="drops-table-wrap">
          <table className="drops-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Txn ID</th>
                <th>Amount</th>
                <th>Provider</th>
                <th>From</th>
                <th>Claimed by</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 500).map(r => {
                const sc = r.claimed_by ? staffCodes[r.claimed_by] : null
                const t = new Date(r.received_at)
                const timeStr = String(t.getHours()).padStart(2,'0') + ':' +
                                String(t.getMinutes()).padStart(2,'0') + ':' +
                                String(t.getSeconds()).padStart(2,'0')
                return (
                  <tr key={r.id}>
                    <td>{timeStr}</td>
                    <td><span className="code-pill" style={{fontSize:11}}>{r.txn_id}</span></td>
                    <td
                      style={sc?.color ? {
                        background: sc.color + '33',
                        borderLeft: `4px solid ${sc.color}`,
                        fontWeight: 700,
                      } : { fontWeight: 700 }}
                    >
                      UGX {Number(r.amount).toLocaleString()}
                    </td>
                    <td>
                      <span className={`pill ${r.provider === 'airtel' ? 'red' : 'amber'}`}>
                        {r.provider}
                      </span>
                    </td>
                    <td>{r.customer_name || r.customer_phone || '—'}</td>
                    <td>
                      {sc ? (
                        <>
                          <span
                            style={{
                              display: 'inline-block', width: 10, height: 10,
                              borderRadius: '50%', background: sc.color,
                              marginRight: 8, verticalAlign: 'middle',
                            }}
                          />
                          {sc.name} <span style={{ color: '#8ba0b9', fontSize: 12 }}>({sc.code})</span>
                        </>
                      ) : '—'}
                    </td>
                    <td>
                      <span className={`pill ${
                        r.status === 'claimed' ? 'green' :
                        r.status === 'unclaimed' ? 'amber' : 'red'
                      }`}>{r.status}</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {rows.length > 500 && (
            <div style={{ padding: 14, textAlign: 'center', color: '#6b85a0', fontSize: 13 }}>
              Showing first 500 of {rows.length}. Use filters to narrow down or export to see all.
            </div>
          )}
        </div>
      )}
    </div>
  )
}