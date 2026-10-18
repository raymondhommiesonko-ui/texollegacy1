import { useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../supabase'
import { timeEAT, todayEAT } from '../lib/time'

export default function FuelCards({ profile }) {
  const user = profile.user
  const role = user.role

  const isManager = role === 'manager' || role === 'admin'
  const isSupervisor = role === 'supervisor'
  const isAmbassador = role === 'ambassador'

  const canUpload = isManager || isSupervisor || isAmbassador
  const canDownload = isManager || isSupervisor

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
  const [appUserTxns, setAppUserTxns] = useState([])
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

      // 1. Sales Data
      const { data: s } = await supabase
        .from('card_sales')
        .select('*')
        .eq('station_id', user.station_id)
        .gte('txn_at', fromISO)
        .lte('txn_at', toISO)
      setSalesRows(s || [])

      // 2. Topups Data
      const { data: t } = await supabase
        .from('card_topups')
        .select('*')
        .eq('station_id', user.station_id)
        .gte('txn_at', fromISO)
        .lte('txn_at', toISO)
      setTopupRows(t || [])

      // 3. App Users Data (from transactions)
      const { data: txns } = await supabase
        .from('transactions')
        .select('*')
        .eq('station_id', user.station_id)
        .eq('provider', 'card')
        .gte('received_at', fromISO)
        .lte('received_at', toISO)
      setAppUserTxns(txns || [])

      // 4. Upload History
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

  // ---- CALCULATIONS ----
  const totals = useMemo(() => {
    let cardsSet = new Set()
    let totalLiters = 0
    let totalSalesAmount = 0
    let bigTopupsCount = 0
    let totalTopupsAmount = 0

    salesRows.forEach(r => {
      if (r.card_number) cardsSet.add(r.card_number)
      if (r.quantity) totalLiters += Number(r.quantity)
      if (r.amount) totalSalesAmount += Number(r.amount)
    })

    topupRows.forEach(r => {
      const amt = Number(r.amount || 0)
      totalTopupsAmount += amt
      if (amt >= 100000) bigTopupsCount++
    })

    const difference = totalSalesAmount - totalTopupsAmount

    return {
      cardsWorked: cardsSet.size,
      totalLiters,
      totalSalesAmount,
      bigTopupsCount,
      totalTopupsAmount,
      difference
    }
  }, [salesRows, topupRows])

  // ---- STAFF BREAKDOWN ----
  const staffMap = useMemo(() => {
    const map = {}

    // Aggregate Sales by Staff (Ignoring App Users for this breakdown)
    salesRows.forEach(r => {
      const isAppUser = String(r.transaction_type || '').toLowerCase().includes('app user') || 
                        String(r.staff_name || '').toLowerCase() === 'app user'
      
      if (isAppUser) return // Skip app users here, they are handled in the App Users tab

      const name = r.staff_name || 'Unknown'
      if (!map[name]) map[name] = { name, cards: new Set(), sales: 0, topups: 0, liters: 0 }
      
      if (r.card_number) map[name].cards.add(r.card_number)
      if (r.quantity) map[name].liters += Number(r.quantity)
      if (r.amount) map[name].sales += Number(r.amount)
    })

    // Aggregate Topups by Staff
    topupRows.forEach(r => {
      const name = r.staff_name || 'Unknown'
      if (!map[name]) map[name] = { name, cards: new Set(), sales: 0, topups: 0, liters: 0 }
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

      <div className="dashboard-grid">
        <Stat label="Cards Worked" value={totals.cardsWorked} sub="From sales report" />
        <Stat label="Total Liters" value={`${totals.totalLiters.toLocaleString()} L`} sub="PMS + AGO" />
        <Stat label="Top-ups ≥100k" value={totals.bigTopupsCount} sub={`Total: UGX ${totals.totalTopupsAmount.toLocaleString()}`} />
        <Stat 
          label="Difference" 
          value={`UGX ${totals.difference.toLocaleString()}`} 
          sub="Sales minus Top-ups" 
          valueColor={totals.difference < 0 ? 'var(--red)' : 'var(--green)'}
        />
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
                  <th>Sales (L)</th>
                  <th>Top-ups (F)</th>
                  <th>Total Liters (H)</th>
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : tab === 'app-users' ? (
        <AppUsersPanel appUserTxns={appUserTxns} canDownload={canDownload} onRefresh={loadAll} profile={profile} />
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
   APP USERS PANEL (Claimable)
   ============================================================ */
function AppUsersPanel({ profile, appUserTxns, canDownload, onRefresh }) {
  const [claiming, setClaiming] = useState(null)
  const user = profile.user
  
  const unclaimed = appUserTxns.filter(r => r.status === 'unclaimed')
  const claimed = appUserTxns.filter(r => r.status === 'claimed')

  async function claimTxn(txnId) {
    setClaiming(txnId)
    const { error } = await supabase
      .from('transactions')
      .update({ 
        status: 'claimed', 
        claimed_by: user.id,
        claimed_at: new Date().toISOString()
      })
      .eq('id', txnId)
    
    if (error) alert(error.message)
    else await onRefresh()
    setClaiming(null)
  }

  return (
    <div>
      <div className="dashboard-grid" style={{ paddingTop: 0 }}>
        <Stat label="Total App Users" value={appUserTxns.length} sub="From sales report" />
        <Stat label="Claimed" value={claimed.length} sub="Reconciled" />
        <Stat label="Unclaimed" value={unclaimed.length} sub="Waiting to be claimed" />
      </div>

      <div className="drops-table-wrap">
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 32px 12px' }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>App User Transactions</h3>
          {canDownload && (
            <button className="btn-ghost btn-sm" onClick={() => exportAppUsersCSV(appUserTxns)}>
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
              <th>Amount</th>
              <th>Status</th>
              <th>Claimed By</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {appUserTxns.length === 0 ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: 20 }}>No app user transactions found.</td></tr>
            ) : appUserTxns.map(r => (
              <tr key={r.id}>
                <td>{timeEAT(r.received_at)}</td>
                <td><span className="code-pill">{r.txn_id}</span></td>
                <td><span className="code-pill" style={{ fontSize: 11 }}>{r.card_number || '—'}</span></td>
                <td style={{ fontWeight: 700 }}>UGX {Number(r.amount).toLocaleString()}</td>
                <td>
                  <span className={`pill ${r.status === 'claimed' ? 'green' : 'amber'}`}>{r.status}</span>
                </td>
                <td>{r.status === 'claimed' ? (r.claimed_by === user.id ? 'You' : 'Other') : '—'}</td>
                <td>
                  {r.status === 'unclaimed' && (
                    <button 
                      className="btn-tiny success" 
                      onClick={() => claimTxn(r.id)}
                      disabled={claiming === r.id}
                    >
                      <i className="fas fa-hand-paper" /> {claiming === r.id ? 'Claiming…' : 'Claim'}
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
  const header = 'Date,Txn ID,Card Number,Amount,Status\n'
  const body = rows.map(r => `${r.received_at},${r.txn_id},${r.card_number},${r.amount},${r.status}`).join('\n')
  const blob = new Blob([header + body], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `app-users-${todayEAT()}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

/* ============================================================
   UPLOAD MODAL
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
    if (typeof v === 'number') {
      try {
        const d = XLSX.SSF.parse_date_code(v)
        if (d) return new Date(Date.UTC(d.y, d.m-1, d.d, d.H||0, d.M||0, Math.floor(d.S||0))).toISOString()
      } catch {}
      return null
    }
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

      const table = fileType === 'sales' ? 'card_sales' : 'card_topups'
      for (let i = 0; i < rows.length; i += 200) {
        const batch = rows.slice(i, i + 200).map(r => ({ ...r, upload_id: up.id, station_id: user.station_id }))
        const { error: bErr } = await supabase.from(table).insert(batch)
        if (bErr) throw bErr
      }

      // Push App Users to Transactions
      if (fileType === 'sales') {
        const appUsers = rows.filter(r => 
          String(r.transaction_type || '').toLowerCase().includes('app user') || 
          String(r.staff_name || '').toLowerCase() === 'app user'
        )
        
        if (appUsers.length > 0) {
          const txnBatch = appUsers.map(r => ({
            station_id: user.station_id,
            provider: 'card',
            txn_id: r.txn_id,
            amount: r.amount,
            card_number: r.card_number,
            received_at: r.txn_at,
            status: 'unclaimed',
            source: 'reconcile'
          }))
          await supabase.from('transactions').insert(txnBatch)
        }
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

function Stat({ label, value, sub, valueColor }) {
  return (
    <div className="stat-card">
      <div className="stat-title">{label}</div>
      <div className="stat-value" style={valueColor ? { color: valueColor } : undefined}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  )
}