import { useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../supabase'

export default function FuelCards({ profile }) {
  const user = profile?.user
  const role = user?.role || 'attendant'
  const canUpload = ['admin','manager','supervisor','ambassador'].includes(role)

  const [tab, setTab] = useState('overview')
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState('')
  const [openUpload, setOpenUpload] = useState(null)

  const [range, setRange] = useState({
    from: new Date().toISOString().slice(0, 10),
    to: new Date().toISOString().slice(0, 10),
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

      const { data: s, error: sErr } = await supabase
        .from('card_sales')
        .select('*')
        .eq('station_id', user.station_id)
        .gte('txn_at', fromISO)
        .lte('txn_at', toISO)
      if (sErr) throw sErr
      setSalesRows(s || [])

      const { data: t, error: tErr } = await supabase
        .from('card_topups')
        .select('*')
        .eq('station_id', user.station_id)
        .gte('txn_at', fromISO)
        .lte('txn_at', toISO)
      if (tErr) throw tErr
      setTopupRows(t || [])

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

  // ---- Aggregate everything from the rows themselves
  const totals = useMemo(() => {
    let cards = 0
    let pmsL = 0
    let agoL = 0
    let salesAmount = 0
    let cardSalesCount = 0
    let appUsers = 0

    const cardSet = new Set()
    salesRows.forEach(r => {
      if (r.card_number) cardSet.add(r.card_number)
      const prod = String(r.product || '').toUpperCase()
      const qty = Number(r.quantity || 0)
      if (prod === 'PMS') pmsL += qty
      if (prod === 'AGO') agoL += qty
      if (String(r.payment_method || '').toLowerCase() === 'card') {
        salesAmount += Number(r.amount || 0)
        cardSalesCount++
      }
      if (String(r.transaction_type || '').toLowerCase().includes('app user')) appUsers++
    })

    let topupAmount = 0
    let bigTopups = 0
    topupRows.forEach(r => {
      const amt = Number(r.amount || 0)
      topupAmount += amt
      if (amt >= 100000) bigTopups++
    })

    return {
      cards: cardSet.size,
      pmsL, agoL,
      totalL: pmsL + agoL,
      salesAmount,
      cardSalesCount,
      appUsers,
      topupAmount,
      topupCount: topupRows.length,
      bigTopups,
    }
  }, [salesRows, topupRows])

  // ---- Per-staff
  const staffMap = useMemo(() => {
    const map = {}
    salesRows.forEach(r => {
      const name = r.staff_name || '—'
      if (!map[name]) map[name] = { name, cards: new Set(), salesAmount: 0, salesCount: 0, liters: 0, appUsers: 0, topups: 0, topupCount: 0, bigTopups: 0 }
      if (r.card_number) map[name].cards.add(r.card_number)
      const prod = String(r.product || '').toUpperCase()
      if (prod === 'PMS' || prod === 'AGO') map[name].liters += Number(r.quantity || 0)
      if (String(r.payment_method || '').toLowerCase() === 'card') {
        map[name].salesAmount += Number(r.amount || 0)
        map[name].salesCount++
      }
      if (String(r.transaction_type || '').toLowerCase().includes('app user')) map[name].appUsers++
    })
    topupRows.forEach(r => {
      const name = r.staff_name || '—'
      if (!map[name]) map[name] = { name, cards: new Set(), salesAmount: 0, salesCount: 0, liters: 0, appUsers: 0, topups: 0, topupCount: 0, bigTopups: 0 }
      map[name].topups += Number(r.amount || 0)
      map[name].topupCount++
      if (Number(r.amount || 0) >= 100000) map[name].bigTopups++
    })
    return Object.values(map).map(s => ({
      ...s,
      cards: s.cards.size,
    })).sort((a,b) => b.salesAmount - a.salesAmount)
  }, [salesRows, topupRows])

  // ---- Per-day
  const perDay = useMemo(() => {
    const map = {}
    salesRows.forEach(r => {
      if (!r.txn_at) return
      const day = String(r.txn_at).slice(0, 10)
      if (!map[day]) map[day] = { day, cards: new Set(), pms: 0, ago: 0, salesAmount: 0, appUsers: 0, topups: 0, bigTopups: 0 }
      if (r.card_number) map[day].cards.add(r.card_number)
      const prod = String(r.product || '').toUpperCase()
      if (prod === 'PMS') map[day].pms += Number(r.quantity || 0)
      if (prod === 'AGO') map[day].ago += Number(r.quantity || 0)
      if (String(r.payment_method || '').toLowerCase() === 'card') map[day].salesAmount += Number(r.amount || 0)
      if (String(r.transaction_type || '').toLowerCase().includes('app user')) map[day].appUsers++
    })
    topupRows.forEach(r => {
      if (!r.txn_at) return
      const day = String(r.txn_at).slice(0, 10)
      if (!map[day]) map[day] = { day, cards: new Set(), pms: 0, ago: 0, salesAmount: 0, appUsers: 0, topups: 0, bigTopups: 0 }
      map[day].topups += Number(r.amount || 0)
      if (Number(r.amount || 0) >= 100000) map[day].bigTopups++
    })
    return Object.values(map).map(d => ({ ...d, cards: d.cards.size })).sort((a,b) => b.day.localeCompare(a.day))
  }, [salesRows, topupRows])

  if (!user) {
    return <div className="drops-empty"><i className="fas fa-user-slash" /><h4>Not signed in</h4></div>
  }

  return (
    <div className="fuelcards-screen">
      <div className="fuelcards-head">
        <div>
          <h3>Fuel Cards</h3>
          <div className="sub">Card sales & top-ups from uploaded files</div>
        </div>
        <div className="fuelcards-actions">
          {canUpload && (
            <>
              <button className="btn-ghost" onClick={() => setOpenUpload('sales')}>
                <i className="fas fa-upload" /> Upload sales
              </button>
              <button className="btn-primary" onClick={() => setOpenUpload('topups')}>
                <i className="fas fa-upload" /> Upload top-ups
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
        <button className="btn-ghost btn-sm" onClick={() => {
          const t = new Date().toISOString().slice(0,10)
          setRange({ from: t, to: t })
        }}>Today</button>
        <button className="btn-ghost btn-sm" onClick={() => {
          const d = new Date()
          const from = new Date(d.getTime() - 6*86400000).toISOString().slice(0,10)
          setRange({ from, to: new Date().toISOString().slice(0,10) })
        }}>Last 7 days</button>
      </div>

      <div className="dashboard-grid">
        <Stat label="Cards worked" value={`${totals.cards}`} sub="Distinct card numbers" />
        <Stat label="Fuel liters" value={`${totals.totalL.toLocaleString()} L`} sub={`PMS ${totals.pmsL.toLocaleString()} · AGO ${totals.agoL.toLocaleString()}`} />
        <Stat label="Card sales" value={`UGX ${totals.salesAmount.toLocaleString()}`} sub={`${totals.cardSalesCount} sales · ${totals.appUsers} app users`} />
        <Stat label="Top-ups ≥100k" value={`${totals.bigTopups}`} sub={`UGX ${totals.topupAmount.toLocaleString()} total`} />
      </div>

      <div className="tabs" style={{ paddingTop: 0 }}>
        <button className={`tab ${tab === 'overview' ? 'active' : ''}`} onClick={() => setTab('overview')}>
          <i className="fas fa-chart-bar" /> Daily
        </button>
        <button className={`tab ${tab === 'staff' ? 'active' : ''}`} onClick={() => setTab('staff')}>
          <i className="fas fa-user-tie" /> By staff
        </button>
        <button className={`tab ${tab === 'uploads' ? 'active' : ''}`} onClick={() => setTab('uploads')}>
          <i className="fas fa-file-upload" /> Uploads
        </button>
      </div>

      {errorMsg && (
        <div className="auth-err" style={{ margin: '0 32px 20px' }}>
          <i className="fas fa-exclamation-triangle" /> {errorMsg}
        </div>
      )}

      {loading ? (
        <div className="drops-empty">Loading…</div>
      ) : tab === 'overview' ? (
        perDay.length === 0 ? (
          <div className="drops-empty">
            <i className="fas fa-credit-card" />
            <h4>No data in this range</h4>
            <p>Upload a sales or top-up file to populate.</p>
          </div>
        ) : (
          <div className="drops-table-wrap">
            <table className="drops-table">
              <thead>
                <tr>
                  <th>Day</th>
                  <th>Cards</th>
                  <th>Liters</th>
                  <th>Card sales</th>
                  <th>App users</th>
                  <th>Top-ups ≥100k</th>
                </tr>
              </thead>
              <tbody>
                {perDay.map(r => (
                  <tr key={r.day}>
                    <td><strong>{r.day}</strong></td>
                    <td>{r.cards}</td>
                    <td>{r.pms.toLocaleString()} / {r.ago.toLocaleString()} L</td>
                    <td>UGX {r.salesAmount.toLocaleString()}</td>
                    <td>{r.appUsers}</td>
                    <td>{r.bigTopups} · UGX {r.topups.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : tab === 'staff' ? (
        staffMap.length === 0 ? (
          <div className="drops-empty"><i className="fas fa-users" /><h4>No staff activity</h4></div>
        ) : (
          <div className="drops-table-wrap">
            <table className="drops-table">
              <thead>
                <tr>
                  <th>Staff</th>
                  <th>Cards</th>
                  <th>Card sales</th>
                  <th>Liters</th>
                  <th>App users</th>
                  <th>Top-ups</th>
                </tr>
              </thead>
              <tbody>
                {staffMap.map(s => (
                  <tr key={s.name}>
                    <td><strong>{s.name}</strong></td>
                    <td><span className="pill gold">{s.cards}</span></td>
                    <td>UGX {s.salesAmount.toLocaleString()}</td>
                    <td>{s.liters.toLocaleString()} L</td>
                    <td>{s.appUsers}</td>
                    <td>UGX {s.topups.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
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
                    <td>{new Date(u.uploaded_at).toLocaleString('en-GB', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })}</td>
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
   UPLOAD MODAL — no external views, uses tables directly
   ============================================================ */
function UploadModal({ profile, fileType, onClose, onSaved }) {
  const user = profile.user
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [preview, setPreview] = useState(null)
  const [file, setFile] = useState(null)
  const [replaceExisting, setReplaceExisting] = useState(true)

  async function handleFile(f) {
    if (!f) return
    setErr(''); setFile(f)
    try {
      const buf = await f.arrayBuffer()
      const wb = XLSX.read(buf)
      const sheet = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })
      if (rows.length < 2) { setErr('File has no data rows'); return }
      const dataRows = rows.slice(1).filter(r => r.some(c => c !== '' && c != null))

      const parsed = dataRows.map(r => {
        if (fileType === 'sales') {
          return {
            txn_id: String(r[0] || ''),
            txn_at: parseDate(r[1]),
            customer_name: String(r[3] || ''),
            card_number: String(r[4] || ''),
            product_code: String(r[5] || ''),
            product: String(r[6] || ''),
            quantity: num(r[7]),
            unit_price: num(r[8]),
            discount: num(r[10]),
            amount: num(r[11]),
            payment_method: String(r[13] || ''),
            points: num(r[14]),
            transaction_type: String(r[15] || ''),
            staff_name: String(r[16] || ''),
            narrative: String(r[17] || ''),
          }
        } else {
          return {
            txn_id: String(r[0] || ''),
            txn_at: parseDate(r[1]),
            customer_name: String(r[3] || ''),
            card_number: String(r[4] || ''),
            amount: num(r[5]),
            prev_balance: num(r[6]),
            new_balance: num(r[7]),
            prev_points: num(r[8]),
            new_points: num(r[9]),
            transaction_type: String(r[10] || ''),
            staff_name: String(r[11] || ''),
            narrative: String(r[12] || ''),
          }
        }
      }).filter(r => r.txn_at)

      if (parsed.length === 0) {
        setErr('No valid rows — check the date column format')
        return
      }
      setPreview({ rows: parsed, totalRaw: dataRows.length, sample: parsed.slice(0, 5) })
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

      if (replaceExisting && dateFrom && dateTo) {
        const { data: old } = await supabase
          .from('card_uploads')
          .select('id')
          .eq('station_id', user.station_id)
          .eq('file_type', fileType)
          .eq('date_from', dateFrom)
          .eq('date_to', dateTo)
          .neq('id', up.id)
        if (old?.length) {
          await supabase.from('card_uploads').delete().in('id', old.map(o => o.id))
        }
      }

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
        <div className="modal-sub">CSV or Excel</div>

        <label>File</label>
        <input type="file" accept=".csv,.xlsx,.xls" onChange={e => handleFile(e.target.files?.[0])} />

        <label className="check-row" style={{ marginTop: 12 }}>
          <input type="checkbox" checked={replaceExisting} onChange={e => setReplaceExisting(e.target.checked)} />
          <span>Replace any existing file for the same date range</span>
        </label>

        {preview && (
          <>
            <div className="section-title" style={{ padding: '20px 0 10px' }}>
              Preview · {preview.rows.length} of {preview.totalRaw} rows
            </div>
            <div className="import-preview">
              {preview.sample.map((r, i) => (
                <div key={i} className="preview-head" style={{ gridTemplateColumns: 'repeat(7, 1fr)' }}>
                  <div className="cell">{r.txn_id}</div>
                  <div className="cell">{String(r.txn_at).slice(0,10)}</div>
                  <div className="cell">{r.customer_name}</div>
                  <div className="cell">{r.card_number}</div>
                  <div className="cell">{r.product || ''}</div>
                  <div className="cell">{r.quantity || r.amount}</div>
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