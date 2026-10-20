import { useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../supabase'

export default function FuelCards({ profile }) {
  const user = profile?.user
  const powers = profile?.powers || {}
  const role = user?.role || 'attendant'
  
  const isCompanyPhone = role === 'company_phone'
  const isManager = ['admin', 'manager', 'supervisor'].includes(role)
  
  // Only managers and ambassadors can upload
  const canUpload = !isCompanyPhone && (isManager || role === 'ambassador' || powers.upload_fuelcards)
  const canDownload = !isCompanyPhone && (isManager || powers.export_performance)

  const [tab, setTab] = useState('overview')
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState('')
  
  // Modals
  const [openUpload, setOpenUpload] = useState(null)
  const [openReconcile, setOpenReconcile] = useState(false)

  // Safe date initialization
  const today = new Date().toISOString().slice(0, 10)
  const [range, setRange] = useState({ from: today, to: today })

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
      const fromISO = range.from + 'T00:00:00'
      const toISO = range.to + 'T23:59:59'

      // 1. Fetch Sales
      const { data: s } = await supabase
        .from('card_sales')
        .select('*')
        .eq('station_id', user.station_id)
        .gte('txn_at', fromISO)
        .lte('txn_at', toISO)
        .order('txn_at', { ascending: false })
      setSalesRows(s || [])

      // 2. Fetch Top-ups
      const { data: t } = await supabase
        .from('card_topups')
        .select('*')
        .eq('station_id', user.station_id)
        .gte('txn_at', fromISO)
        .lte('txn_at', toISO)
        .order('txn_at', { ascending: false })
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
        .gte('created_at', fromISO)
        .lte('created_at', toISO)
        .order('created_at', { ascending: false })

      let finalAppUsers = au || []

      if (finalAppUsers.length === 0) {
        const { data: fromSales } = await supabase
          .from('card_sales')
          .select('txn_id, card_number, customer_name, staff_name, original_amount')
          .eq('station_id', user.station_id)
          .gte('txn_at', fromISO)
          .lte('txn_at', toISO)
        
        if (fromSales && fromSales.length > 0) {
          finalAppUsers = fromSales
            .filter(r => String(r.staff_name || '').replace(/\s+/g, '').toLowerCase().includes('appuser'))
            .map(s => ({
              id: s.txn_id,
              txn_id: s.txn_id,
              card_number: s.card_number,
              customer_name: s.customer_name,
              amount: s.original_amount,
              claimed_by: null,
              is_fallback: true
            }))
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

  useEffect(() => { 
    loadAll() 
  }, [user?.station_id, range.from, range.to])

  const stats = useMemo(() => {
    let totalLiters = 0
    let totalSalesAmt = 0
    let totalTopupAmt = 0
    let bigTopups = 0

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
      const amt = Number(r?.top_up_amount || r?.amount || 0) 
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
      map[name].topupAmt += Number(r?.top_up_amount || r?.amount || 0)
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
              <button 
                className="btn-ghost" 
                style={{ color: '#2563eb', borderColor: '#2563eb' }} 
                onClick={() => setOpenReconcile(true)}
              >
                <i className="fas fa-balance-scale" /> Reconcile
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
        <button className="btn-ghost btn-sm" onClick={() => setRange({ from: today, to: today })}>Today</button>
      </div>

      <div className="dashboard-grid">
        <Stat label="Total Liters Sold" value={`${stats.totalLiters.toLocaleString()} L`} sub="From sales quantity" />
        <Stat label="Total Sales Amount" value={`UGX ${stats.totalSalesAmt.toLocaleString()}`} sub="Original amount (Col L)" />
        <Stat label="Total Top-ups" value={`UGX ${stats.totalTopupAmt.toLocaleString()}`} sub="Top-up amount (Col F)" />
        <Stat label="Top-ups ≥100k" value={`${stats.bigTopups}`} sub="Qualifying top-ups" />
      </div>

      <div className="tabs" style={{ paddingTop: 0, overflowX: 'auto', whiteSpace: 'nowrap' }}>
        <button className={`tab ${tab === 'overview' ? 'active' : ''}`} onClick={() => setTab('overview')}>Daily</button>
        <button className={`tab ${tab === 'staff' ? 'active' : ''}`} onClick={() => setTab('staff')}>By Staff</button>
        <button className={`tab ${tab === 'app-users' ? 'active' : ''}`} onClick={() => setTab('app-users')}>App Users (Claim)</button>
        {!isCompanyPhone && (
          <button className={`tab ${tab === 'uploads' ? 'active' : ''}`} onClick={() => setTab('uploads')}>Uploads</button>
        )}
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
                <th>Difference</th>
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

      {openReconcile && (
        <ReconcileModal
          profile={profile}
          onClose={() => setOpenReconcile(false)}
          onSaved={async () => { setOpenReconcile(false); await loadAll() }}
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
      u.txn_id, u.customer_name, u.card_number, u.amount,
      u.claimed_by ? staffCodes[u.claimed_by]?.name || 'Claimed' : 'Unclaimed'
    ])
    const csv = "Txn ID,Customer,Card,Amount,Status\n" + rows.map(r => r.join(',')).join('\n')
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
              <th>Amount</th>
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
                  <td><strong>UGX {Number(u.amount || 0).toLocaleString()}</strong></td>
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
              <tr><td colSpan="6" style={{ textAlign: 'center', padding: 20 }}>No App Users found</td></tr>
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
        customer_name: appUser.customer_name,
        amount: appUser.amount
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
        <div className="modal-sub">{appUser.customer_name} · UGX {Number(appUser.amount || 0).toLocaleString()}</div>
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
      let text = await f.text()
      text = text.replace(/^\uFEFF/, '') 
      text = text.replace(/"/g, '') 

      const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0)
      
      if (lines.length < 2) { setErr('File is empty or has no data rows'); return }

      const dataRows = lines.slice(1).map(line => line.split(','))

      const parsed = dataRows.map(r => {
        if (fileType === 'sales') {
          return {
            txn_id: String(r[0] || '').trim(),                     
            txn_at: parseDate(r[1]),                        
            customer_name: String(r[3] || '').trim(),              
            card_number: String(r[4] || '').trim(),                
            product_code: String(r[5] || '').trim(),               
            product: String(r[6] || '').trim(),                    
            quantity: num(r[7]),                            
            original_price: num(r[8]),                      
            discounted_price: num(r[9]),                    
            discount: num(r[10]),                           
            original_amount: num(r[11]),                    
            discounted_amount: num(r[12]),                  
            payment_method: String(r[13] || '').trim(),            
            points: num(r[14]),                             
            transaction_type: String(r[15] || '').trim(),          
            staff_name: String(r[16] || '').trim(),                
            narrative: String(r[17] || '').trim(),                 
          }
        } else {
          return {
            txn_id: String(r[0] || '').trim(),                     
            txn_at: parseDate(r[1]),                        
            customer_name: String(r[3] || '').trim(),              
            card_number: String(r[4] || '').trim(),                
            top_up_amount: num(r[5]),                       
            prev_balance: num(r[6]),                        
            new_balance: num(r[7]),                         
            prev_points: num(r[8]),                         
            new_points: num(r[9]),                          
            transaction_type: String(r[10] || '').trim(),          
            staff_name: String(r[11] || '').trim(),                
            narrative: String(r[12] || '').trim(),                 
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
    
    const matchYMD = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/)
    if (matchYMD) {
      const [, y, mo, d, h, mi, sec] = matchYMD
      const dt = new Date(Date.UTC(
        Number(y), Number(mo) - 1, Number(d), 
        Number(h || 0), Number(mi || 0), Number(sec || 0)
      ))
      if (!isNaN(dt.getTime())) return dt.toISOString()
    }

    const matchMDY = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/)
    if (matchMDY) {
      let [, p1, p2, y, h, mi, sec] = matchMDY
      p1 = Number(p1); p2 = Number(p2); y = Number(y)
      if (y < 100) y += 2000
      const mo = p1 > 12 ? p2 : p1
      const d = p1 > 12 ? p1 : p2
      const dt = new Date(Date.UTC(
        y, mo - 1, d, 
        Number(h || 0), Number(mi || 0), Number(sec || 0)
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
        
        if (bErr && bErr.message.includes("top_up_amount")) {
           const fallbackBatch = batch.map(r => {
             const copy = { ...r }
             copy.amount = copy.top_up_amount
             delete copy.top_up_amount
             return copy
           })
           const { error: bErr2 } = await supabase.from(table).insert(fallbackBatch)
           if (bErr2) throw bErr2
        } else if (bErr) {
           throw bErr
        }
      }

      if (fileType === 'sales') {
        const appUserRows = rows
          .filter(r => String(r.staff_name).replace(/\s+/g, '').toLowerCase().includes('appuser'))
          .map(r => ({
            station_id: user.station_id,
            txn_id: r.txn_id,
            card_number: r.card_number,
            customer_name: r.customer_name,
            amount: r.original_amount
          }))
        
        if (appUserRows.length > 0) {
          await supabase.from('app_users').upsert(appUserRows, { onConflict: 'txn_id' })
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

/* ============================================================
   RECONCILE MODAL (Upsert version - instant)
   ============================================================ */
function ReconcileModal({ profile, onClose, onSaved }) {
  const user = profile.user
  const [fileType, setFileType] = useState('sales')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [result, setResult] = useState(null)
  const [preview, setPreview] = useState(null)
  const [file, setFile] = useState(null)

  async function handleFile(f) {
    if (!f) return
    setErr(''); setFile(f); setResult(null)
    try {
      let text = await f.text()
      text = text.replace(/^\uFEFF/, '') 
      text = text.replace(/"/g, '') 

      const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0)
      
      if (lines.length < 2) { setErr('File is empty or has no data rows'); return }

      const dataRows = lines.slice(1).map(line => line.split(','))

      const parsed = dataRows.map(r => {
        if (fileType === 'sales') {
          return {
            txn_id: String(r[0] || '').trim(), txn_at: parseDate(r[1]),
            customer_name: String(r[3] || '').trim(), card_number: String(r[4] || '').trim(),
            product_code: String(r[5] || '').trim(), product: String(r[6] || '').trim(),
            quantity: num(r[7]), original_price: num(r[8]), discounted_price: num(r[9]),
            discount: num(r[10]), original_amount: num(r[11]), discounted_amount: num(r[12]),
            payment_method: String(r[13] || '').trim(), points: num(r[14]),
            transaction_type: String(r[15] || '').trim(), staff_name: String(r[16] || '').trim(),
            narrative: String(r[17] || '').trim(),
          }
        } else {
          return {
            txn_id: String(r[0] || '').trim(), txn_at: parseDate(r[1]),
            customer_name: String(r[3] || '').trim(), card_number: String(r[4] || '').trim(),
            top_up_amount: num(r[5]), prev_balance: num(r[6]), new_balance: num(r[7]),
            prev_points: num(r[8]), new_points: num(r[9]),
            transaction_type: String(r[10] || '').trim(), staff_name: String(r[11] || '').trim(),
            narrative: String(r[12] || '').trim(),
          }
        }
      }).filter(r => r.txn_at && r.txn_id)

      if (parsed.length === 0) { setErr('No valid rows found in file.'); return }
      setPreview(parsed)
    } catch (e) {
      console.error(e)
      setErr('Could not parse file: ' + e.message)
    }
  }

  async function runReconcile() {
    if (!preview || preview.length === 0) return
    setBusy(true); setErr(''); setResult(null)
    
    try {
      const table = fileType === 'sales' ? 'card_sales' : 'card_topups'
      
      const upsertData = preview.map(r => ({
        ...r,
        station_id: user.station_id,
        updated_at: new Date().toISOString()
      }))

      const { error: upsertErr } = await supabase
        .from(table)
        .upsert(upsertData, { onConflict: 'txn_id' })

      if (upsertErr) throw upsertErr

      setResult({ total: preview.length })
      setPreview(null)
    } catch (e) {
      console.error(e)
      setErr(e.message || 'Reconciliation failed')
    }
    setBusy(false)
  }

  function num(v) {
    if (v == null || v === '') return 0
    const n = Number(String(v).replace(/,/g, '').trim())
    return isNaN(n) ? 0 : n
  }

  function parseDate(v) {
    if (v == null || v === '') return null
    const s = String(v).trim()
    const matchYMD = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/)
    if (matchYMD) {
      const [, y, mo, d, h, mi, sec] = matchYMD
      const dt = new Date(Date.UTC(Number(y), Number(mo)-1, Number(d), Number(h||0), Number(mi||0), Number(sec||0)))
      if (!isNaN(dt.getTime())) return dt.toISOString()
    }
    const matchMDY = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/)
    if (matchMDY) {
      let [, p1, p2, y, h, mi, sec] = matchMDY
      p1 = Number(p1); p2 = Number(p2); y = Number(y); if(y<100) y+=2000
      const mo = p1 > 12 ? p2 : p1; const d = p1 > 12 ? p1 : p2
      const dt = new Date(Date.UTC(y, mo-1, d, Number(h||0), Number(mi||0), Number(sec||0)))
      if (!isNaN(dt.getTime())) return dt.toISOString()
    }
    const iso = new Date(s)
    if (!isNaN(iso.getTime())) return iso.toISOString()
    return null
  }

  return (
    <div className="modal-bg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal modal-wide">
        <h3>Reconcile Fuel Cards</h3>
        <div className="modal-sub">
          Upload a file to update existing records and insert missing ones.
        </div>

        <label>Data Type</label>
        <select value={fileType} onChange={e => { setFileType(e.target.value); setPreview(null); setResult(null) }} disabled={busy || !!result}>
          <option value="sales">Sales Report</option>
          <option value="topups">Top-up Report</option>
        </select>

        <label>File</label>
        <input type="file" accept=".csv,.xlsx,.xls" onChange={e => handleFile(e.target.files?.[0])} disabled={busy || !!result} />

        {preview && !result && (
          <div className="field-hint" style={{ marginTop: 12, background: '#eff6ff', color: '#1e40af' }}>
            <i className="fas fa-info-circle" /> Ready to process {preview.length} rows.
          </div>
        )}

        {result && (
          <div style={{ marginTop: 20 }}>
            <div className="section-title">Reconciliation Result</div>
            <div className="result-row">
              <span className="lbl">Successfully processed</span>
              <span className="val" style={{ color: '#10b981' }}>{result.total} rows</span>
            </div>
          </div>
        )}

        {err && <div className="auth-err">{err}</div>}

        <div className="modal-actions">
          <button className="btn-ghost-full" onClick={result ? onSaved : onClose}>
            {result ? 'Done' : 'Cancel'}
          </button>
          {!result && (
            <button className="btn-primary-full" onClick={runReconcile} disabled={busy || !preview}>
              {busy ? 'Reconciling…' : 'Run Reconciliation'}
            </button>
          )}
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