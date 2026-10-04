import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabase'

export default function Reports({ profile }) {
  const user = profile.user
  const access = user.access_score ?? 30
  const isManager = ['admin','manager'].includes(user.role)
  const isSupervisor = user.role === 'supervisor'
  const isAmbassador = user.role === 'ambassador'
  const isAttendant = user.role === 'attendant'

  // Which report types are visible
  const REPORT_TYPES = [
    { id: 'attendance',   label: 'Attendance',         icon: 'fa-clock',              roles: ['admin','manager','supervisor','ambassador','attendant'] },
    { id: 'drops',        label: 'Money Drops',        icon: 'fa-money-bill-wave',    roles: ['admin','manager','supervisor','attendant'] },
    { id: 'balance',      label: 'Shift Balances',     icon: 'fa-cash-register',      roles: ['admin','manager','supervisor'] },
    { id: 'card_sales',   label: 'Fuel Card Sales',    icon: 'fa-credit-card',        roles: ['admin','manager','supervisor','ambassador','attendant'] },
    { id: 'card_topups',  label: 'Card Top-ups',       icon: 'fa-arrow-up',           roles: ['admin','manager','supervisor','ambassador'] },
    { id: 'card_staff',   label: 'Card Work by Staff', icon: 'fa-user-tie',           roles: ['admin','manager','supervisor','ambassador'] },
    { id: 'shortages',    label: 'Staff Shortages',    icon: 'fa-balance-scale',      roles: ['admin','manager','supervisor'] },
    { id: 'credits',      label: 'Customer Credits',   icon: 'fa-file-invoice-dollar',roles: ['admin','manager','supervisor'] },
    { id: 'customers',    label: 'Customer List',      icon: 'fa-users',              roles: ['admin','manager','supervisor','ambassador'] },
    { id: 'staff_list',   label: 'Staff List',         icon: 'fa-user-shield',        roles: ['admin','manager','supervisor'] },
    { id: 'shifts',       label: 'Shift History',      icon: 'fa-calendar-alt',       roles: ['admin','manager','supervisor','ambassador','attendant'] },
  ]

  const visibleTypes = REPORT_TYPES.filter(t => t.roles.includes(user.role))

  const [active, setActive] = useState(visibleTypes[0]?.id || 'attendance')
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState([])
  const [columns, setColumns] = useState([])
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [range, setRange] = useState({
    from: new Date(Date.now() - 6*86400000).toISOString().slice(0,10),
    to: new Date().toISOString().slice(0,10),
  })
  const [summary, setSummary] = useState([])

  async function loadReport(type) {
    setLoading(true); setError(''); setRows([]); setColumns([]); setSummary([])

    try {
      const fromISO = range.from + 'T00:00:00'
      const toISO = range.to + 'T23:59:59'
      const stationId = user.station_id

      let data = []
      let cols = []
      let summ = []

      if (type === 'attendance') {
        let q = supabase
          .from('attendance')
          .select('*, user:users!attendance_user_id_fkey(name, role)')
          .gte('clock_in_at', fromISO)
          .lte('clock_in_at', toISO)
          .order('clock_in_at', { ascending: false })
          .limit(500)
        // Attendant and Ambassador: only own
        if (!isManager && !isSupervisor) q = q.eq('user_id', user.id)

        const { data: d, error: e } = await q
        if (e) throw e
        data = (d || []).map(r => ({
          Date: String(r.clock_in_at).slice(0, 10),
          Name: r.user?.name || '—',
          Role: r.user?.role || '—',
          'Clock in': fmtTime(r.clock_in_at),
          'Clock out': r.clock_out_at ? fmtTime(r.clock_out_at) : 'still in',
          Status: r.status,
          GPS: r.in_gps || '—',
          Photo: r.in_photo_url ? 'yes' : 'no',
          Note: r.note || '',
        }))
        cols = ['Date','Name','Role','Clock in','Clock out','Status','GPS','Photo','Note']
        summ = [
          { label: 'Total records', value: data.length },
          { label: 'Approved', value: data.filter(r => r.Status === 'approved').length },
          { label: 'Pending', value: data.filter(r => r.Status === 'pending').length },
        ]
      }

      else if (type === 'drops') {
        // Find shifts of station in range
        const { data: shifts } = await supabase
          .from('shifts')
          .select('id, shift_date, shift_type')
          .eq('station_id', stationId)
          .gte('shift_date', range.from)
          .lte('shift_date', range.to)
        const shiftIds = (shifts || []).map(s => s.id)

        let q = supabase
          .from('money_drops')
          .select('*, attendant:users!money_drops_attendant_id_fkey(name), recorder:users!money_drops_recorded_by_fkey(name)')
          .in('shift_id', shiftIds)
          .order('created_at', { ascending: false })
          .limit(2000)
        if (isAttendant) q = q.eq('attendant_id', user.id)

        const { data: d, error: e } = await q
        if (e) throw e
        data = (d || []).map(r => ({
          Date: String(r.created_at).slice(0, 10),
          Time: fmtTime(r.created_at),
          Code: r.code,
          Attendant: r.attendant?.name || '—',
          'Drop #': r.drop_number,
          Amount: Number(r.amount || 0),
          Final: r.is_final ? 'yes' : 'no',
          Status: r.status,
          'Recorded by': r.recorder?.name || '—',
        }))
        cols = ['Date','Time','Code','Attendant','Drop #','Amount','Final','Status','Recorded by']
        const active = data.filter(r => r.Status !== 'undone')
        summ = [
          { label: 'Drops', value: active.length },
          { label: 'Total UGX', value: active.reduce((s, r) => s + r.Amount, 0).toLocaleString() },
          { label: 'Final drops', value: active.filter(r => r.Final === 'yes').length },
        ]
      }

      else if (type === 'balance') {
        const { data: shifts } = await supabase
          .from('shifts')
          .select('id, shift_date, shift_type')
          .eq('station_id', stationId)
          .gte('shift_date', range.from)
          .lte('shift_date', range.to)
        const shiftIds = (shifts || []).map(s => s.id)

        const { data: d, error: e } = await supabase
          .from('shift_balances')
          .select('*, attendant:users!shift_balances_attendant_id_fkey(name)')
          .in('shift_id', shiftIds)
        if (e) throw e
        data = (d || []).map(r => ({
          Date: shifts.find(s => s.id === r.shift_id)?.shift_date || '',
          Shift: shifts.find(s => s.id === r.shift_id)?.shift_type || '',
          Attendant: r.attendant?.name || '—',
          Expected: Number(r.expected_sales || 0),
          Dropped: Number(r.cash_dropped || 0),
          'In hand': Number(r.cash_in_hand || 0),
          Variance: Number(r.variance || 0),
          Balanced: r.balanced ? 'yes' : 'no',
        }))
        cols = ['Date','Shift','Attendant','Expected','Dropped','In hand','Variance','Balanced']
        summ = [
          { label: 'Attendants', value: data.length },
          { label: 'Balanced', value: data.filter(r => r.Balanced === 'yes').length },
          { label: 'Total variance', value: data.reduce((s, r) => s + r.Variance, 0).toLocaleString() },
        ]
      }

      else if (type === 'card_sales') {
        const { data: d, error: e } = await supabase
          .from('card_sales')
          .select('*')
          .eq('station_id', stationId)
          .gte('txn_at', fromISO)
          .lte('txn_at', toISO)
          .order('txn_at', { ascending: false })
          .limit(3000)
        if (e) throw e
        data = (d || []).map(r => ({
          Date: String(r.txn_at || '').slice(0, 10),
          Time: fmtTime(r.txn_at),
          Customer: r.customer_name || '',
          Card: r.card_number || '',
          Product: r.product || '',
          Qty: Number(r.quantity || 0),
          Amount: Number(r.amount || 0),
          Payment: r.payment_method || '',
          Type: r.transaction_type || '',
          Staff: r.staff_name || '',
        }))
        cols = ['Date','Time','Customer','Card','Product','Qty','Amount','Payment','Type','Staff']
        const cards = new Set(data.filter(r => r.Card).map(r => r.Card))
        summ = [
          { label: 'Transactions', value: data.length },
          { label: 'Cards worked', value: cards.size },
          { label: 'Card sales UGX', value: data.filter(r => String(r.Payment).toLowerCase() === 'card').reduce((s,r) => s + r.Amount, 0).toLocaleString() },
        ]
      }

      else if (type === 'card_topups') {
        const { data: d, error: e } = await supabase
          .from('card_topups')
          .select('*')
          .eq('station_id', stationId)
          .gte('txn_at', fromISO)
          .lte('txn_at', toISO)
          .order('txn_at', { ascending: false })
          .limit(3000)
        if (e) throw e
        data = (d || []).map(r => ({
          Date: String(r.txn_at || '').slice(0, 10),
          Time: fmtTime(r.txn_at),
          Customer: r.customer_name || '',
          Card: r.card_number || '',
          Amount: Number(r.amount || 0),
          'New balance': Number(r.new_balance || 0),
          'Points +': Number(r.new_points || 0) - Number(r.prev_points || 0),
          Staff: r.staff_name || '',
        }))
        cols = ['Date','Time','Customer','Card','Amount','New balance','Points +','Staff']
        const big = data.filter(r => r.Amount >= 100000).length
        summ = [
          { label: 'Top-ups', value: data.length },
          { label: '≥ 100k', value: big },
          { label: 'Total UGX', value: data.reduce((s, r) => s + r.Amount, 0).toLocaleString() },
        ]
      }

      else if (type === 'card_staff') {
        const { data: d } = await supabase
          .from('card_sales')
          .select('*')
          .eq('station_id', stationId)
          .gte('txn_at', fromISO)
          .lte('txn_at', toISO)
        const grouped = {}
        ;(d || []).forEach(r => {
          const name = r.staff_name || '—'
          if (!grouped[name]) grouped[name] = { Name: name, Cards: new Set(), Sales: 0, SalesCount: 0, Liters: 0, AppUsers: 0 }
          if (r.card_number) grouped[name].Cards.add(r.card_number)
          if (String(r.payment_method || '').toLowerCase() === 'card') {
            grouped[name].Sales += Number(r.amount || 0)
            grouped[name].SalesCount++
          }
          if (['PMS','AGO'].includes(String(r.product || '').toUpperCase())) {
            grouped[name].Liters += Number(r.quantity || 0)
          }
          if (String(r.transaction_type || '').toLowerCase().includes('app user')) {
            grouped[name].AppUsers++
          }
        })
        data = Object.values(grouped).map(g => ({
          Name: g.Name,
          Cards: g.Cards.size,
          'Card sales': g.Sales,
          'Sales count': g.SalesCount,
          Liters: g.Liters,
          'App users': g.AppUsers,
        }))
        cols = ['Name','Cards','Card sales','Sales count','Liters','App users']
        summ = [
          { label: 'Staff', value: data.length },
          { label: 'Total cards', value: data.reduce((s, r) => s + r.Cards, 0) },
          { label: 'Total liters', value: data.reduce((s, r) => s + r.Liters, 0).toLocaleString() },
        ]
      }

      else if (type === 'shortages') {
        const { data: d, error: e } = await supabase
          .from('v_staff_shortages')
          .select('*')
          .eq('station_id', stationId)
          .order('balance', { ascending: false })
        if (e) throw e
        data = (d || []).map(r => ({
          Name: r.name,
          Role: r.role,
          'Total owed': Number(r.total_owed || 0),
          Paid: Number(r.total_paid || 0),
          Balance: Number(r.balance || 0),
          Entries: r.entries,
        }))
        cols = ['Name','Role','Total owed','Paid','Balance','Entries']
        summ = [
          { label: 'Staff', value: data.length },
          { label: 'Still owing', value: data.filter(r => r.Balance > 0).length },
          { label: 'Total owed UGX', value: data.reduce((s, r) => s + r.Balance, 0).toLocaleString() },
        ]
      }

      else if (type === 'credits') {
        const { data: d, error: e } = await supabase
          .from('v_customer_credits')
          .select('*')
          .eq('station_id', stationId)
          .order('balance', { ascending: false })
        if (e) throw e
        data = (d || []).map(r => ({
          Customer: r.name,
          Phone: r.phone || '',
          Company: r.company || '',
          Card: r.card_number || '',
          Credit: Number(r.total_credit || 0),
          Paid: Number(r.total_paid || 0),
          Balance: Number(r.balance || 0),
        }))
        cols = ['Customer','Phone','Company','Card','Credit','Paid','Balance']
        summ = [
          { label: 'Customers', value: data.length },
          { label: 'With credit', value: data.filter(r => r.Balance > 0).length },
          { label: 'Total UGX', value: data.reduce((s, r) => s + r.Balance, 0).toLocaleString() },
        ]
      }

      else if (type === 'customers') {
        const { data: d, error: e } = await supabase
          .from('customers')
          .select('*')
          .eq('station_id', stationId)
          .order('name', { ascending: true })
        if (e) throw e
        data = (d || []).map(r => ({
          Name: r.name,
          Phone: r.phone || '',
          Company: r.company || '',
          Type: r.customer_type || '',
          Card: r.card_number || '',
          'Credit limit': Number(r.credit_limit || 0),
          Portal: r.portal_enabled ? 'yes' : 'no',
        }))
        cols = ['Name','Phone','Company','Type','Card','Credit limit','Portal']
        summ = [{ label: 'Customers', value: data.length }]
      }

      else if (type === 'staff_list') {
        const { data: d, error: e } = await supabase
          .from('users')
          .select('id, name, email, phone, role, access_score, is_active, initials')
          .eq('station_id', stationId)
          .order('name', { ascending: true })
        if (e) throw e
        data = (d || []).map(r => ({
          Name: r.name,
          Email: r.email || '',
          Phone: r.phone || '',
          Role: r.role,
          Access: `${r.access_score}%`,
          Active: r.is_active ? 'yes' : 'no',
        }))
        cols = ['Name','Email','Phone','Role','Access','Active']
        summ = [
          { label: 'Total', value: data.length },
          { label: 'Active', value: data.filter(r => r.Active === 'yes').length },
        ]
      }

      else if (type === 'shifts') {
        const { data: d, error: e } = await supabase
          .from('shifts')
          .select('*')
          .eq('station_id', stationId)
          .gte('shift_date', range.from)
          .lte('shift_date', range.to)
          .order('shift_date', { ascending: false })
        if (e) throw e
        data = (d || []).map(r => ({
          Date: r.shift_date,
          Shift: r.shift_type,
          Status: r.status,
          Opened: r.opened_at ? String(r.opened_at).slice(0,16).replace('T',' ') : '',
          Closed: r.closed_at ? String(r.closed_at).slice(0,16).replace('T',' ') : '',
        }))
        cols = ['Date','Shift','Status','Opened','Closed']
        summ = [
          { label: 'Shifts', value: data.length },
          { label: 'Open', value: data.filter(r => r.Status === 'open').length },
          { label: 'Closed', value: data.filter(r => r.Status === 'closed').length },
        ]
      }

      setRows(data)
      setColumns(cols)
      setSummary(summ)
    } catch (e) {
      console.error('Report error:', e)
      setError(e.message || 'Could not load report')
    }

    setLoading(false)
  }

  useEffect(() => { loadReport(active) }, [active, range.from, range.to])

  const filtered = useMemo(() => {
    if (!search) return rows
    const q = search.toLowerCase()
    return rows.filter(r => Object.values(r).some(v => String(v ?? '').toLowerCase().includes(q)))
  }, [rows, search])

  function fmtTime(iso) {
    if (!iso) return ''
    const d = new Date(iso)
    return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0')
  }

  function downloadCSV() {
    if (filtered.length === 0) return
    const head = columns.join(',') + '\n'
    const body = filtered.map(r => columns.map(c => csvSafe(r[c])).join(',')).join('\n')
    saveFile(`${active}-${range.from}_to_${range.to}.csv`, head + body, 'text/csv')
  }

  function downloadWord() {
    if (filtered.length === 0) return
    const html = `
      <html xmlns:o='urn:schemas-microsoft-com:office:office'
            xmlns:w='urn:schemas-microsoft-com:office:word'>
      <head><meta charset="utf-8"><title>${active}</title></head>
      <body>
        <h1>TEXOL Report: ${active}</h1>
        <p>Range: ${range.from} → ${range.to}</p>
        <p>Generated: ${new Date().toLocaleString()}</p>
        <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-family:Arial;font-size:12px;">
          <tr>${columns.map(c => `<th style="background:#0b1a2e;color:#f0c94b;">${c}</th>`).join('')}</tr>
          ${filtered.map(r => `<tr>${columns.map(c => `<td>${escapeHtml(r[c])}</td>`).join('')}</tr>`).join('')}
        </table>
      </body></html>
    `
    saveFile(`${active}-${range.from}_to_${range.to}.doc`, html, 'application/msword')
  }

  function csvSafe(v) {
    const s = String(v ?? '')
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"'
    }
    return s
  }

  function escapeHtml(v) {
    return String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]))
  }

  function saveFile(name, content, type) {
    const blob = new Blob([content], { type })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="reports-screen">
      <div className="reports-head">
        <div>
          <h3>Reports</h3>
          <div className="sub">Download any report as CSV or Word</div>
        </div>
        <div className="reports-actions">
          <button className="btn-ghost" onClick={downloadCSV} disabled={filtered.length === 0}>
            <i className="fas fa-file-csv" /> CSV
          </button>
          <button className="btn-primary" onClick={downloadWord} disabled={filtered.length === 0}>
            <i className="fas fa-file-word" /> Word
          </button>
        </div>
      </div>

      <div className="reports-body">
        <aside className="reports-sidebar">
          {visibleTypes.map(t => (
            <button
              key={t.id}
              className={`report-tab ${active === t.id ? 'active' : ''}`}
              onClick={() => setActive(t.id)}
            >
              <i className={`fas ${t.icon}`} /> {t.label}
            </button>
          ))}
        </aside>

        <main className="reports-main">
          <div className="staff-filters">
            <label style={{ alignSelf: 'center', fontSize: 13, color: '#6b85a0', fontWeight: 600 }}>From</label>
            <input type="date" value={range.from} onChange={e => setRange(r => ({ ...r, from: e.target.value }))} />
            <label style={{ alignSelf: 'center', fontSize: 13, color: '#6b85a0', fontWeight: 600 }}>To</label>
            <input type="date" value={range.to} onChange={e => setRange(r => ({ ...r, to: e.target.value }))} />
            <input
              placeholder="Search rows…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ minWidth: 200 }}
            />
            <button className="btn-ghost btn-sm" onClick={() => setSearch('')}>Clear</button>
          </div>

          {summary.length > 0 && (
            <div className="report-summary">
              {summary.map((s, i) => (
                <div key={i} className="stat-card">
                  <div className="stat-title">{s.label}</div>
                  <div className="stat-value">{s.value}</div>
                </div>
              ))}
            </div>
          )}

          {error && <div className="auth-err" style={{ margin: '0 32px 20px' }}>{error}</div>}

          {loading ? (
            <div className="drops-empty">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="drops-empty">
              <i className="fas fa-file-alt" />
              <h4>No data</h4>
              <p>Adjust the date range or filters.</p>
            </div>
          ) : (
            <div className="drops-table-wrap">
              <table className="drops-table">
                <thead>
                  <tr>{columns.map(c => <th key={c}>{c}</th>)}</tr>
                </thead>
                <tbody>
                  {filtered.slice(0, 500).map((r, i) => (
                    <tr key={i}>
                      {columns.map(c => (
                        <td key={c}>{formatCell(r[c], c)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {filtered.length > 500 && (
                <div style={{ padding: 14, textAlign: 'center', color: '#6b85a0', fontSize: 13 }}>
                  Showing first 500 of {filtered.length} rows. Download to see all.
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

function formatCell(v, col) {
  if (v == null || v === '') return '—'
  if (typeof v === 'number') {
    if (col.toLowerCase().includes('ugx') || ['Amount','Sales','Balance','Credit','Paid','Variance','Expected','Dropped','In hand','Card sales','Total owed','Credit limit'].includes(col)) {
      return Number(v).toLocaleString()
    }
    return v.toLocaleString()
  }
  return String(v)
}