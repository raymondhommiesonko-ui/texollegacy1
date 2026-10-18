import { useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../supabase'
import { timeEAT, todayEAT } from '../lib/time'

export default function FuelCards({ profile }) {
  const user = profile.user
  const role = user.role

  // Permissions
  const isManager = role === 'manager' || role === 'admin'
  const isSupervisor = role === 'supervisor'
  const isAmbassador = role === 'ambassador'
  const isAttendant = role === 'attendant'

  const canUpload = isManager || isSupervisor || isAmbassador
  const canDownload = isManager || isSupervisor // Attendants can't download
  const canClaim = true // Everyone can claim app users

  const [tab, setTab] = useState('overview')
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState('')
  const [openUpload, setOpenUpload] = useState(null)

  const [range, setRange] = useState({
    from: todayEAT(),
    to: todayEAT(),
  })

  const [salesRows, setSalesRows] = useState([])
  const [topupRows, setTopupRows] = useState([])
  const [uploads, setUploads] = useState([])

  async function loadAll() {
    setLoading(true)
    setErrorMsg('')

    if (!user?.station_id) {
      setErrorMsg('No station assigned to your account.')
      setLoading(false)
      return
    }

    try {
      const fromISO = range.from + 'T00:00:00'
      const toISO = range.to + 'T23:59:59'

      // Load Sales
      const { data: s, error: sErr } = await supabase
        .from('card_sales')
        .select('*')
        .eq('station_id', user.station_id)
        .gte('txn_at', fromISO)
        .lte('txn_at', toISO)
      if (sErr) throw sErr
      setSalesRows(s || [])

      // Load Topups
      const { data: t, error: tErr } = await supabase
        .from('card_topups')
        .select('*')
        .eq('station_id', user.station_id)
        .gte('txn_at', fromISO)
        .lte('txn_at', toISO)
      if (tErr) throw tErr
      setTopupRows(t || [])

      // Load Upload History
      const { data: u } = await supabase
        .from('card_uploads')
        .select('*')
        .eq('station_id', user.station_id)
        .order('uploaded_at', { ascending: false })
        .limit(30)
      setUploads(u || [])
    } catch (e) {
      console.error('Load error:', e)
      setErrorMsg(e.message || 'Could not load data')
    }

    setLoading(false)
  }

  useEffect(() => { loadAll() }, [user?.station_id, range.from, range.to])

  // ---- Totals Calculation ----
  const totals = useMemo(() => {
    let cardsSet = new Set()
    let totalLiters = 0
    let totalSalesAmount = 0
    let bigTopupsCount = 0
    let totalTopupsAmount = 0

    // Process Sales
    salesRows.forEach(r => {
      if (r.card_number) cardsSet.add(r.card_number)
      
      // Add Liters (if PMS or AGO)
      const prod = String(r.product || '').toUpperCase()
      if (prod === 'PMS' || prod === 'AGO') {
        totalLiters += Number(r.quantity || 0)
      }

      // Add Card Sales Amount
      if (String(r.payment_method || '').toLowerCase() === 'card') {
        totalSalesAmount += Number(r.amount || 0)
      }
    })

    // Process Topups
    topupRows.forEach(r => {
      const amt = Number(r.amount || 0)
      totalTopupsAmount += amt
      if (amt >= 100000) bigTopupsCount++
    })

    return {
      cardsWorked: cardsSet.size,
      totalLiters,
      totalSalesAmount,
      bigTopupsCount,
      totalTopupsAmount,
    }
  }, [salesRows, topupRows])

  // ---- Per-Staff Calculation ----
  const staffMap = useMemo(() => {
    const map = {}

    // Aggregate Sales
    salesRows.forEach(r => {
      const name = r.staff_name || 'Unknown'
      if (!map[name]) map[name] = { name, cards: new Set(), sales: 0, topups: 0, liters: 0, appUsers: 0 }
      
      if (r.card_number) map[name].cards.add(r.card_number)
      const prod = String(r.product || '').toUpperCase()
      if (prod === 'PMS' || prod === 'AGO') map[name].liters += Number(r.quantity || 0)
      
      if (String(r.payment_method || '').toLowerCase() === 'card') {
        map[name].sales += Number(r.amount || 0)
      }

      // Track App Users specifically
      if (String(r.transaction_type || '').toLowerCase().includes('app user')) {
        map[name].appUsers++
      }
    })

    // Aggregate Topups
    topupRows.forEach(r => {
      const name = r.staff_name || 'Unknown'
      if (!map[name]) map[name] = { name, cards: new Set(), sales: 0, topups: 0, liters: 0, appUsers: 0 }
      map[name].topups += Number(r.amount || 0)
    })

    return Object.values(map).map(s => ({
      ...s,
      cardsWorked: s.cards.size,
    })).sort((a, b) => b.sales - a.sales)
  }, [salesRows, topupRows])

  if (!user) return <div className="drops-empty"><i className="fas fa-user-slash" /><h4>Not signed in</h4></div>

  return (
    <div className="fuelcards-screen">
      <div className="fuelcards-head">
        <div>
          <h3>Fuel Cards</h3>
          <div className="sub">Upload reports, track liters, and claim App Users</div>
        </div>
        <div className="fuelcards-actions">
          {canUpload && (
            <>
              <button className="btn-ghost" onClick={() => setOpenUpload('sales')}>
                <i className="fas fa-upload" /> Upload Sales
              </button>
              <button className="btn-primary" onClick={() => setOpenUpload('topups')}>
                <i className="fas fa-upload" /> Upload Top-ups
              </button>
            </>
          )}
        </div>
      </div>

      <div className="staff-filters">
        <label style={{ alignSelf: 'center', fontSize: 13, color: '#6b85a0', fontWeight: 600 }}>From</label>
        <input type="date" value={range.from} onChange={e => setRange(r => ({ ...r, from: e.target.value }))} />
        <label style={{ alignSelf: 'center', fontSize: 13, color: '#6b85a0', fontWeight: 600 }}>To</label>
        <input type="date" value={range.to} onChange={e => setRange(r => ({ ...r, to: e.target.value }))} />
        <button className="btn-ghost btn-sm" onClick={() => setRange({ from: todayEAT(), to: todayEAT() })}>Today</button>
      </div>

      {/* TOTALS CARDS */}
      <div className="dashboard-grid">
        <Stat label="Cards Worked" value={totals.cardsWorked} sub="Distinct cards" />
        <Stat label="Total Liters Sold" value={`${totals.totalLiters.toLocaleString()} L`} sub="PMS + AGO" />
        <Stat label="Card Sales" value={`UGX ${totals.totalSalesAmount.toLocaleString()}`} sub="Total value" />
        <Stat label="Top-ups ≥100k" value={totals.bigTopupsCount} sub={`Total: UGX ${totals.totalTopupsAmount.toLocaleString()}`} />
      </div>

      <div className="tabs" style={{ paddingTop: 0 }}>
        <button className={`tab ${tab === 'overview' ? 'active' : ''}`} onClick={() => setTab('overview')}>
          <i className="fas fa-user-tie" /> By Staff
        </button>
        <button className={`tab ${tab === 'app-users' ? 'active' : ''}`} onClick={() => setTab('app-users')}>
          <i className="fas fa-mobile-alt" /> App Users
        </button>
        <button className={`tab ${tab === 'uploads' ? 'active' : ''}`} onClick={() => setTab('uploads')}>
          <i className="fas fa-file-upload" /> Uploads
        </button>
      </div>

      {errorMsg && <div className="auth-err" style={{ margin: '0 32px 20px' }}><i className="fas fa-exclamation-triangle" /> {errorMsg}</div>}

      {loading ? (
        <div className="drops-empty">Loading…</div>
      ) : tab === 'overview' ? (
        staffMap.length === 0 ? (
          <div className="drops-empty"><i className="fas fa-users" /><h4>No staff activity</h4></div>
        ) : (
          <div className="drops-table-wrap">
            <table className="drops-table">
              <thead>
                <tr>
                  <th>Staff</th>
                  <th>Cards Worked</th>
                  <th>Sales Amount</th>
                  <th>Top-ups Amount</th>
                  <th>Total Liters</th>
                  <th>App Users</th>
                </tr>
              </thead>
              <tbody>
                {staffMap.map(s => (
                  <tr key={s.name}>
                    <td><strong>{s.name}</strong></td>
                    <td><span className="pill gold">{s.cardsWorked}</span></td>
                    <td>UGX {s.sales.toLocaleString()}</td>
                    <td>UGX {s.topups.toLocaleString()}</td>
                    <td>{s.liters.toLocaleString()} L</td>
                    <td>{s.appUsers > 0 ? <span className="pill blue">{s.appUsers}</span> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : tab === 'app-users' ? (
        <AppUsersPanel profile={profile} salesRows={salesRows} canClaim={canClaim} canDownload={canDownload} />
      ) : (
        uploads.length === 0 ? (
          <div className="drops-empty"><i className="fas fa-file-upload" /><h4>No uploads yet</h4></div>
        ) : (
          <div className="drops-table-wrap">
            <table className="drops-table">
              <thead>
                <tr>
                  <th>Uploaded</th>
                  <th>Type</th>
                  <th>File</th>
                  <th>Rows</th>
                  <th>Range</th>
                </tr>
              </thead>
              <tbody>
                {uploads.map(u => (
                  <tr key={u.id}>
                    <td>{new Date(u.uploaded_at).toLocaleString('en-GB')}</td>
                    <td><span className={`pill ${u.file_type === 'sales' ? 'blue' : 'green'}`}>{u.file_type}</span></td>
                    <td>{u.file_name || '—'}</td>
                    <td>{u.row_count}</td>
                    <td>{u.date_from && u.date_to ? `${u.date_from} → ${u.date_to}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {openUpload && (
        <UploadModal
          profile={profile}
          fileType={openUpload}
          onClose={() => setOpenUpload(null)}
          onSaved={async () => { setOpenUpload(null); await loadAll() }}
        />
      )}
    </div>
  )
}

/* ============================================================
   APP USERS PANEL
   ============================================================ */
function AppUsersPanel({ profile, salesRows, canClaim, canDownload }) {
  const user = profile.user
  // Filter for rows where Transaction By = 'App User'
  const appUsers = salesRows.filter(r => 
    String(r.transaction_type || '').toLowerCase().includes('app user') || 
    String(r.staff_name || '').toLowerCase() === 'app user'
  )

  const unclaimed = appUsers.filter(r => r.status === 'unclaimed' || r.status === 'pending_claim')
  const claimed = appUsers.filter(r => r.status === 'claimed')

  // Since these are read from the `card_sales` table, they are already reconciled.
  // We just display them and allow claiming.

  return (
    <div>
      <div className="dashboard-grid" style={{ paddingTop: 0 }}>
        <Stat label="Total App Users" value={appUsers.length} sub="From sales report" />
        <Stat label="Claimed" value={claimed.length} sub="Reconciled" />
        <Stat label="Unclaimed" value={unclaimed.length} sub="Waiting to be claimed" />
      </div>

      <div className="drops-table-wrap">
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 32px 12px' }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>App User Transactions</h3>
          {canDownload && (
            <button className="btn-ghost btn-sm" onClick={() => exportAppUsersCSV(appUsers)}>
              <i className="fas fa-file-csv" /> Download List
            </button>
          )}
        </div>
        
        <table className="drops-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Txn ID</th>
              <th>Card No</th>
              <th>Customer</th>
              <th>Amount</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {appUsers.length === 0 ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: 20 }}>No app user transactions found.</td></tr>
            ) : appUsers.map(r => (
              <tr key={r.txn_id}>
                <td>{timeEAT(r.txn_at)}</td>
                <td><span className="code-pill">{r.txn_id}</span></td>
                <td><span className="code-pill" style={{ fontSize: 11 }}>{r.card_number}</span></td>
                <td>{r.customer_name}</td>
                <td style={{ fontWeight: 700 }}>UGX {Number(r.amount).toLocaleString()}</td>
                <td>
                  <span className={`pill ${r.status === 'claimed' ? 'green' : 'amber'}`}>{r.status || 'unclaimed'}</span>
                </td>
                <td>
                  {canClaim && (r.status === 'unclaimed' || r.status === 'pending_claim') && (
                    <button className="btn-tiny success" onClick={() => alert('Claim logic goes here')}>
                      <i className="fas fa-hand-paper" /> Claim
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function exportAppUsersCSV(rows) {
  const header = 'Date,Txn ID,Card Number,Customer,Amount,Status\n'
  const body = rows.map(r => `${r.txn_at},${r.txn_id},${r.card_number},${r.customer_name},${r.amount},${r.status}`).join('\n')
  const blob = new Blob([header + body], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `app-users-${todayEAT()}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

/* ============================================================
   UPLOAD MODAL — handles Google Sheets & Excel
   ============================================================ */
function UploadModal({ profile, fileType, onClose, onSaved }) {
  const user = profile.user
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [preview, setPreview] = useState(null)
  const [file, setFile] = useState(null)

  async function handleFile(f) {
    if (!f) return
    setErr(''); setFile(f)
    try {
      const buf = await f.arrayBuffer()
      const wb = XLSX.read(buf)
      const sheet = wb.Sheets[wb.SheetNames[0]]
      
      // Convert to JSON with headers
      const rawJson = XLSX.utils.sheet_to_json(sheet, { defval: '' })
      
      if (rawJson.length === 0) { setErr('File has no data rows'); return }

      const parsed = rawJson.map(r => {
        if (fileType === 'sales') {
          return {
            txn_id: String(r['Transaction Id'] || ''),
            txn_at: parseDate(r['Transaction Date']),
            customer_name: String(r['Customer'] || ''),
            card_number: String(r['Card Number'] || ''),
            product_code: String(r['Product Code'] || ''),
            product: String(r['Product'] || ''),
            quantity: num(r['Quantity']),
            unit_price: num(r['Original Unit Price']),
            discount: num(r['Discount']),
            amount: num(r['Original Amount']),
            payment_method: String(r['Payment Mode'] || ''),
            points: num(r['Points Earned']),
            transaction_type: String(r['Transaction Type'] || ''),
            staff_name: String(r['Transaction By'] || ''),
            narrative: String(r['Narrative'] || ''),
            status: 'unclaimed', // Default for app users if needed
          }
        } else {
          return {
            txn_id: String(r['Transaction Id'] || ''),
            txn_at: parseDate(r['Transaction Date']),
            customer_name: String(r['Customer'] || ''),
            card_number: String(r['Card Number'] || ''),
            amount: num(r['Top Up Amount']),
            prev_balance: num(r['Previous Balance']),
            new_balance: num(r['Current Balance']),
            prev_points: num(r['Previous Points']),
            new_points: num(r['Current Points']),
            transaction_type: String(r['Transaction Type'] || ''),
            staff_name: String(r['Transaction By'] || ''),
            narrative: String(r['Narrative'] || ''),
          }
        }
      }).filter(r => r.txn_at && r.txn_id)

      if (parsed.length === 0) {
        setErr('No valid rows found. Check column names and date formats.')
        return
      }
      setPreview({ rows: parsed, totalRaw: rawJson.length, sample: parsed.slice(0, 5) })
    } catch (e) {
      console.error(e)
      setErr('Could not parse file: ' + (e.message || 'unknown'))
    }
  }

  function num(v) {
    if (v == null || v === '') return 0
    const n = Number(String(v).replace(/,/g, '').trim())
    return isNaN(n) ? 0 : n
  }

  function parseDate(v) {
    if (v == null || v === '') return null
    // Handle Excel serial date numbers
    if (typeof v === 'number') {
      try {
        const d = XLSX.SSF.parse_date_code(v)
        if (d) return new Date(Date.UTC(d.y, d.m-1, d.d, d.H||0, d.M||0, Math.floor(d.S||0))).toISOString()
      } catch {}
      return null
    }
    // Handle string dates from Google Sheets / CSV
    const s = String(v).trim()
    if (!s) return null
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{1,2})/)
    if (m) {
      const [, y, mo, d, h, mi] = m
      const dt = new Date(`${y}-${mo}-${d}T${String(h).padStart(2,'0')}:${String(mi).padStart(2,'0')}:00Z`)
      if (!isNaN(dt.getTime())) return dt.toISOString()
    }
    const iso = new Date(s)
    if (!isNaN(iso.getTime())) return iso.toISOString()
    return null
  }

  async function save() {
    if (!preview || preview.rows.length === 0) { setErr('No valid rows'); return }
    setBusy(true); setErr('')
    try {
      const rows = preview.rows
      const dates = rows.map(r => r.txn_at).sort()
      const dateFrom = dates[0]?.slice(0, 10)
      const dateTo = dates[dates.length-1]?.slice(0, 10)

      // 1. Create Upload Log
      const { data: up, error: uErr } = await supabase
        .from('card_uploads')
        .insert({
          station_id: user.station_id,
          file_type: fileType,
          file_name: file?.name || 'unknown',
          uploaded_by: user.id,
          date_from: dateFrom,
          date_to: dateTo,
          row_count: rows.length,
        })
        .select('id')
        .single()
      if (uErr) throw uErr

      // 2. Insert Rows in Batches
      const table = fileType === 'sales' ? 'card_sales' : 'card_topups'
      for (let i = 0; i < rows.length; i += 200) {
        const batch = rows.slice(i, i + 200).map(r => ({ ...r, upload_id: up.id, station_id: user.station_id }))
        const { error: bErr } = await supabase.from(table).insert(batch)
        if (bErr) throw bErr
      }
      onSaved()
    } catch (e) {
      console.error(e)
      setErr(e.message || 'Save failed')
      setBusy(false)
    }
  }

  return (
    <div className="modal-bg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal modal-wide">
        <h3>{fileType === 'sales' ? 'Upload Sales Report' : 'Upload Top-up Entries'}</h3>
        <div className="modal-sub">Google Sheets CSV or Excel (.xlsx)</div>

        <label>Select File</label>
        <input type="file" accept=".csv, .xlsx, .xls" onChange={e => handleFile(e.target.files?.[0])} />

        {preview && (
          <>
            <div className="section-title" style={{ padding: '20px 0 10px' }}>
              Preview · {preview.rows.length} of {preview.totalRaw} rows
            </div>
            <div className="import-preview">
              {preview.sample.map((r, i) => (
                <div key={i} className="preview-head" style={{ gridTemplateColumns: 'repeat(6, 1fr)', fontSize: 12 }}>
                  <div className="cell">{r.txn_id}</div>
                  <div className="cell">{String(r.txn_at).slice(0,10)}</div>
                  <div className="cell">{r.customer_name}</div>
                  <div className="cell">{r.card_number}</div>
                  <div className="cell">{r.amount || r.quantity}</div>
                  <div className="cell">{r.staff_name}</div>
                </div>
              ))}
            </div>
          </>
        )}

        {err && <div className="auth-err">{err}</div>}

        <div className="modal-actions">
          <button className="btn-ghost-full" onClick={onClose}>Cancel</button>
          <button className="btn-primary-full" onClick={save} disabled={busy || !preview}>
            {busy ? 'Saving…' : preview ? `Save ${preview.rows.length} rows` : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, sub }) {
  return (
    <div className="stat-card">
      <div className="stat-title">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  )
}