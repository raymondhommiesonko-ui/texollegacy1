import { useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../supabase'
import { todayEAT } from '../lib/time'

export default function FuelCards({ profile }) {
  const user = profile?.user
  const powers = profile?.powers || {}
  const role = user?.role || 'attendant'
  
  const isManager = ['admin', 'manager', 'supervisor'].includes(role)
  const canUpload = isManager || role === 'ambassador' || powers.upload_fuelcards
  const canDownload = isManager || powers.export_performance

  const [tab, setTab] = useState('overview')
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState('')
  const [openUpload, setOpenUpload] = useState(null)

  // Safe date initialization
  const [range, setRange] = useState({
    from: todayEAT ? todayEAT() : new Date().toISOString().slice(0,10),
    to: todayEAT ? todayEAT() : new Date().toISOString().slice(0,10),
  })

  const [salesRows, setSalesRows] = useState([])
  const [topupRows, setTopupRows] = useState([])
  const [appUsers, setAppUsers] = useState([])
  const [staffCodes, setStaffCodes] = useState({})
  const [uploads, setUploads] = useState([])

  async function loadAll() {
    setLoading(true)
    setErrorMsg('')

    if (!user?.station_id) {
      setErrorMsg('No station assigned.')
      setLoading(false)
      return
    }

    try {
      // 1. Fetch Sales (Safely)
      const { data: s, error: sErr } = await supabase
        .from('card_sales')
        .select('*')
        .eq('station_id', user.station_id)
        .order('txn_at', { ascending: false })
      
      if (sErr) console.error("Sales Error:", sErr)
      setSalesRows(s || [])

      // 2. Fetch Top-ups (Safely)
      const { data: t, error: tErr } = await supabase
        .from('card_topups')
        .select('*')
        .eq('station_id', user.station_id)
        .order('txn_at', { ascending: false })
      
      if (tErr) console.error("Topups Error:", tErr)
      setTopupRows(t || [])

      // 3. Fetch Uploads
      const { data: u } = await supabase
        .from('card_uploads')
        .select('*')
        .eq('station_id', user.station_id)
        .order('uploaded_at', { ascending: false })
        .limit(20)
      setUploads(u || [])

      // 4. Fetch App Users
      const { data: au } = await supabase
        .from('app_users')
        .select('*')
        .eq('station_id', user.station_id)
        .order('created_at', { ascending: false })

      let finalAppUsers = au || []

      // Fallback for App Users
      if (finalAppUsers.length === 0) {
        const { data: fromSales } = await supabase
          .from('card_sales')
          .select('txn_id, card_number, customer_name, staff_name')
          .eq('station_id', user.station_id)
        
        if (fromSales && fromSales.length > 0) {
          const extracted = fromSales
            .filter(r => String(r.staff_name || '').replace(/\s+/g, '').toLowerCase().includes('appuser'))
            .map(s => ({
              id: s.txn_id,
              txn_id: s.txn_id,
              card_number: s.card_number,
              customer_name: s.customer_name,
              claimed_by: null,
              is_fallback: true
            }))
          finalAppUsers = extracted
        }
      }
      setAppUsers(finalAppUsers)

      // 5. Fetch Staff Codes
      const { data: codes } = await supabase
        .from('staff_codes')
        .select('user_id, code, color')
        .eq('station_id', user.station_id)
      
      const { data: staff } = await supabase
        .from('users')
        .select('id, name')
        .eq('station_id', user.station_id)
      
      const userMap = {}
      ;(staff || []).forEach(u => { if (u?.id) userMap[u.id] = u.name || 'Staff' })
      
      const codeMap = {}
      ;(codes || []).forEach(c => {
        if (c?.user_id) {
          codeMap[c.user_id] = {
            name: userMap[c.user_id] || 'Staff',
            code: c.code || '—',
            color: c.color || '#64748B'
          }
        }
      })
      setStaffCodes(codeMap)

    } catch (e) {
      console.error("Crash caught:", e)
      setErrorMsg(e.message || 'Could not load data')
    }
    setLoading(false)
  }

  useEffect(() => { loadAll() }, [user?.station_id])

  const stats = useMemo(() => {
    let totalLiters = 0
    let totalSalesAmt = 0
    let totalTopupAmt = 0
    let bigTopups = 0

    // Filter by range manually for safety
    const inRange = (d) => d && d >= range.from && d <= range.to

    salesRows.forEach(r => {
      const day = String(r?.txn_at || '').slice(0, 10)
      if (!inRange(day)) return
      
      totalLiters += Number(r?.quantity || 0)
      totalSalesAmt += Number(r?.original_amount || 0) 
    })

    topupRows.forEach(r => {
      const day = String(r?.txn_at || '').slice(0, 10)
      if (!inRange(day)) return

      const amt = Number(r?.top_up_amount || 0) 
      totalTopupAmt += amt
      if (amt >= 100000) bigTopups++
    })

    return { totalLiters, totalSalesAmt, totalTopupAmt, bigTopups }
  }, [salesRows, topupRows, range])

  const staffPerformance = useMemo(() => {
    const map = {}
    const isAppUser = (name) => String(name || '').replace(/\s+/g, '').toLowerCase().includes('appuser')
    const inRange = (d) => d && d >= range.from && d <= range.to

    salesRows.forEach(r => {
      const day = String(r?.txn_at || '').slice(0, 10)
      if (!inRange(day)) return

      const rawName = String(r?.staff_name || '').trim()
      if (isAppUser(rawName)) return 

      const name = rawName || 'Unknown'
      if (!map[name]) map[name] = { name, salesAmt: 0, liters: 0, topupAmt: 0, cards: new Set() }
      
      map[name].salesAmt += Number(r?.original_amount || 0)
      map[name].liters += Number(r?.quantity || 0)
      if (r?.card_number) map[name].cards.add(r.card_number)
    })

    topupRows.forEach(r => {
      const day = String(r?.txn_at || '').slice(0, 10)
      if (!inRange(day)) return

      const rawName = String(r?.staff_name || '').trim()
      if (isAppUser(rawName)) return 

      const name = rawName || 'Unknown'
      if (!map[name]) map[name] = { name, salesAmt: 0, liters: 0, topupAmt: 0, cards: new Set() }
      map[name].topupAmt += Number(r?.top_up_amount || 0)
    })

    return Object.values(map).map(s => ({
      ...s,
      cardsCount: s.cards.size,
      difference: s.salesAmt - s.topupAmt
    })).sort((a,b) => b.salesAmt - a.salesAmt)
  }, [salesRows, topupRows, range])

  if (!user) return <div className="drops-empty">Loading…</div>

  return (
    <div className="fuelcards-screen">
      <div className="fuelcards-head">
        <div>
          <h3>Fuel Cards</h3>
          <div className="sub">Sales, Top-ups, and App User claims</div>
        </div>
        <div className="fuelcards-actions">
          {canUpload && (
            <>
              <button className="btn-ghost" onClick={() => setOpenUpload('sales')}>
                <i className="fas fa-upload" /> Sales
              </button>
              <button className="btn-primary" onClick={() => setOpenUpload('topups')}>
                <i className="fas fa-upload" /> Top-ups
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
        <Stat label="Total Liters Sold" value={`${stats.totalLiters.toLocaleString()} L`} sub="From sales quantity" />
        <Stat label="Total Sales Amount" value={`UGX ${stats.totalSalesAmt.toLocaleString()}`} sub="Original amount (Col L)" />
        <Stat label="Total Top-ups" value={`UGX ${stats.totalTopupAmt.toLocaleString()}`} sub="Top-up amount (Col F)" />
        <Stat label="Top-ups ≥100k" value={`${stats.bigTopups}`} sub="Qualifying top-ups" />
      </div>

      <div className="tabs" style={{ paddingTop: 0, overflowX: 'auto', whiteSpace: 'nowrap' }}>
        <button className={`tab ${tab === 'overview' ? 'active' : ''}`} onClick={() => setTab('overview')}>
          <i className="fas fa-chart-bar" /> Daily
        </button>
        <button className={`tab ${tab === 'staff' ? 'active' : ''}`} onClick={() => setTab('staff')}>
          <i className="fas fa-user-tie" /> By Staff
        </button>
        <button className={`tab ${tab === 'app-users' ? 'active' : ''}`} onClick={() => setTab('app-users')}>
          <i className="fas fa-mobile-alt" /> App Users (Claim)
        </button>
        <button className={`tab ${tab === 'uploads' ? 'active' : ''}`} onClick={() => setTab('uploads')}>
          <i className="fas fa-file-upload" /> Uploads
        </button>
      </div>

      {errorMsg && <div className="auth-err" style={{ margin: '0 32px 20px' }}>{errorMsg}</div>}

      {loading ? (
        <div className="drops-empty">Loading…</div>
      ) : tab === 'overview' ? (
        <div className="drops-empty">
          <i className="fas fa-chart-pie" />
          <h4>Daily breakdown</h4>
          <p>Summary cards above reflect the selected date range.</p>
        </div>
      ) : tab === 'staff' ? (
        <div className="drops-table-wrap">
          <table className="drops-table">
            <thead>
              <tr>
                <th>Staff</th>
                <th>Sales Amount</th>
                <th>Liters</th>
                <th>Top-ups</th>
                <th>Difference (Sales - Topups)</th>
                <th>Cards Worked</th>
              </tr>
            </thead>
            <tbody>
              {staffPerformance.map(s => (
                <tr key={s.name}>
                  <td><strong>{s.name}</strong></td>
                  <td>UGX {s.salesAmt.toLocaleString()}</td>
                  <td>{s.liters.toLocaleString()} L</td>
                  <td>UGX {s.topupAmt.toLocaleString()}</td>
                  <td style={{ color: s.difference < 0 ? '#dc2626' : '#10b981', fontWeight: 700 }}>
                    UGX {s.difference.toLocaleString()}
                  </td>
                  <td>{s.cardsCount}</td>
                </tr>
              ))}
              {staffPerformance.length === 0 && (
                <tr><td colSpan="6" style={{ textAlign: 'center', padding: 20 }}>No staff activity in this range</td></tr>
              )}
            </tbody>
          </table>
        </div>
      ) : tab === 'app-users' ? (
        <AppUsersTable 
          appUsers={appUsers} 
          staffCodes={staffCodes} 
          profile={profile} 
          onClaimed={loadAll} 
          canDownload={canDownload}
        />
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
              {uploads.length === 0 && (
                <tr><td colSpan="5" style={{ textAlign: 'center', padding: 20 }}>No uploads yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
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
   APP USERS TABLE
   ============================================================ */
function AppUsersTable({ appUsers, staffCodes, profile, onClaimed, canDownload }) {
  const [openClaim, setOpenClaim] = useState(null)

  function download() {
    const rows = appUsers.map(u => [
      u.txn_id, u.customer_name, u.card_number, 
      u.claimed_by ? staffCodes[u.claimed_by]?.name || 'Claimed' : 'Unclaimed'
    ])
    const csv = "Txn ID,Customer,Card,Status\n" + rows.map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'app-users.csv'; a.click()
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '0 32px 10px' }}>
        {canDownload && (
          <button className="btn-ghost" onClick={download}><i className="fas fa-download" /> Download CSV</button>
        )}
      </div>
      <div className="drops-table-wrap">
        <table className="drops-table">
          <thead>
            <tr>
              <th>Txn ID</th>
              <th>Customer</th>
              <th>Card Number</th>
              <th>Claimed By</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {appUsers.map(u => {
              const isClaimed = !!u.claimed_by
              const codeObj = isClaimed ? staffCodes[u.claimed_by] : null
              
              return (
                <tr key={u.txn_id}>
                  <td><span className="code-pill">{u.txn_id}</span></td>
                  <td>{u.customer_name}</td>
                  <td>{u.card_number}</td>
                  <td>
                    {isClaimed ? (
                      <span style={{ color: codeObj?.color || '#000', fontWeight: 700 }}>
                        {codeObj?.name || 'Staff'} ({codeObj?.code || '—'})
                      </span>
                    ) : (
                      <span className="pill amber">Unclaimed</span>
                    )}
                  </td>
                  <td>
                    {!isClaimed && (
                      <button className="btn-tiny success" onClick={() => setOpenClaim(u)}>
                        <i className="fas fa-hand-paper" /> Claim
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
            {appUsers.length === 0 && (
              <tr><td colSpan="5" style={{ textAlign: 'center', padding: 20 }}>No App Users found</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {openClaim && (
        <ClaimAppUserModal 
          appUser={openClaim} 
          profile={profile}
          onClose={() => setOpenClaim(null)} 
          onSaved={async () => { setOpenClaim(null); await onClaimed() }} 
        />
      )}
    </>
  )
}

function ClaimAppUserModal({ appUser, profile, onClose, onSaved }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function claim() {
    if (!code.trim()) { setErr('Enter your 2-digit code'); return }
    setBusy(true); setErr('')
    
    const { data: sc } = await supabase
      .from('staff_codes')
      .select('user_id')
      .eq('station_id', profile.user.station_id)
      .eq('code', code.trim())
      .single()

    if (!sc) { setErr('Invalid code'); setBusy(false); return }

    if (appUser.is_fallback) {
      await supabase.from('app_users').insert({
        station_id: profile.user.station_id,
        txn_id: appUser.txn_id,
        card_number: appUser.card_number,
        customer_name: appUser.customer_name
      }).select()
    }

    const { error } = await supabase.from('app_users').update({
      claimed_by: sc.user_id,
      claimed_at: new Date().toISOString(),
      staff_code: code.trim()
    }).eq('txn_id', appUser.txn_id).is('claimed_by', null)

    setBusy(false)
    if (error) { setErr(error.message); return }
    onSaved()
  }

  return (
    <div className="modal-bg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <h3>Claim App User</h3>
        <div className="modal-sub">{appUser.customer_name} · {appUser.card_number}</div>
        <label>Your Code</label>
        <input 
          type="text" 
          maxLength={2} 
          value={code} 
          onChange={e => setCode(e.target.value.replace(/\D/g,'').slice(0,2))} 
          autoFocus 
        />
        {err && <div className="auth-err">{err}</div>}
        <div className="modal-actions">
          <button className="btn-ghost-full" onClick={onClose}>Cancel</button>
          <button className="btn-primary-full" onClick={claim} disabled={busy || code.length !== 2}>
            {busy ? 'Claiming…' : 'Claim'}
          </button>
        </div>
      </div>
    </div>
  )
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
  const [replaceExisting, setReplaceExisting] = useState(true)

  async function handleFile(f) {
    if (!f) return
    setErr(''); setFile(f)
    try {
      const buf = await f.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      const sheet = wb.Sheets[wb.SheetNames[0]]
      
      let rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })
      rows = rows.filter(r => r.length > 0 && r.some(c => c !== '' && c != null))

      if (rows.length < 2) { setErr('File has no data rows'); return }
      
      const dataRows = rows.slice(1)

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
            original_price: num(r[8]),                      
            discounted_price: num(r[9]),                    
            discount: num(r[10]),                           
            original_amount: num(r[11]),                    
            discounted_amount: num(r[12]),                  
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
            top_up_amount: num(r[5]),                       
            prev_balance: num(r[6]),                        
            new_balance: num(r[7]),                         
            prev_points: num(r[8]),                         
            new_points: num(r[9]),                          
            transaction_type: String(r[10] || ''),          
            staff_name: String(r[11] || ''),                
            narrative: String(r[12] || ''),                 
          }
        }
      }).filter(r => r.txn_at && r.txn_id)

      if (parsed.length === 0) {
        setErr('No valid rows — could not parse dates or IDs. Check columns.')
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
    const s = String(v).trim()
    
    const matchYMD = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/)
    if (matchYMD) {
      const [, y, mo, d, h, mi, sec] = matchYMD
      const dt = new Date(Date.UTC(
        Number(y), Number(mo) - 1, Number(d), 
        Number(h), Number(mi), Number(sec || 0)
      ))
      if (!isNaN(dt.getTime())) return dt.toISOString()
    }

    const matchMDY = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/)
    if (matchMDY) {
      let [, p1, p2, y, h, mi, sec] = matchMDY
      p1 = Number(p1); p2 = Number(p2)
      const mo = p1 > 12 ? p2 : p1
      const d = p1 > 12 ? p1 : p2
      
      const dt = new Date(Date.UTC(
        Number(y), mo - 1, d, 
        Number(h), Number(mi), Number(sec || 0)
      ))
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

      if (fileType === 'sales') {
        const appUserRows = rows
          .filter(r => String(r.staff_name).replace(/\s+/g, '').toLowerCase().includes('appuser'))
          .map(r => ({
            station_id: user.station_id,
            txn_id: r.txn_id,
            card_number: r.card_number,
            customer_name: r.customer_name
          }))
        
        if (appUserRows.length > 0) {
          await supabase.from('app_users').upsert(appUserRows, { onConflict: 'txn_id', ignoreDuplicates: true })
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
                <div key={i} className="preview-head" style={{ gridTemplateColumns: 'repeat(7, 1fr)', fontSize: 11 }}>
                  <div className="cell">{r.txn_id}</div>
                  <div className="cell">{String(r.txn_at).slice(0,10)}</div>
                  <div className="cell">{r.customer_name}</div>
                  <div className="cell">{r.card_number}</div>
                  <div className="cell">{r.product || ''}</div>
                  <div className="cell">{r.quantity || r.top_up_amount}</div>
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