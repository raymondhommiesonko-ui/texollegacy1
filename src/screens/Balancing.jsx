import { useEffect, useMemo, useState, useCallback } from 'react'
import { supabase } from '../supabase'
import PumpBalanceModal from './PumpBalanceModal'

const PAIRS = [[1, 2], [3, 4], [5, 6]]

function pairOf(pumpNumber) {
  const n = Number(pumpNumber)
  for (const [a, b] of PAIRS) {
    if (n === a || n === b) return [a, b]
  }
  return null
}

function isPartnerOfPump(pumpA, pumpB) {
  const pa = pairOf(pumpA)
  if (!pa) return false
  return pa.includes(Number(pumpB))
}

const C = {
  bg: '#f8fafc',
  card: '#ffffff',
  border: '#e2e8f0',
  text: '#1e293b',
  muted: '#64748b',
  soft: '#eef2f7',
  band: '#e8eefb',
  accent: '#3b82f6',
  accentSoft: '#dbeafe',
  danger: '#dc2626',
  dangerBg: '#fee2e2',
  warn: '#92400e',
  warnBg: '#fef3c7',
  success: '#16a34a',
  successBg: '#dcfce7',
}

export default function Balancing({ profile }) {
  const user = profile.user
  const powers = profile.powers || {}

  const isManager = ['admin', 'manager'].includes(user.role)
  const isSupervisor = user.role === 'supervisor'
  const isAdminManagerSup = isManager || isSupervisor
  const isAttendant = user.role === 'attendant' || user.role === 'ambassador'
  
  // NEW: Only Admin can edit opening meters
  const isAdmin = user.role === 'admin'

  const canEditAll = isAdminManagerSup || powers.edit_balancing
  const canEditFinances = isAdminManagerSup
  const canApproveExpenses = isAdminManagerSup
  const canAddExpenses = isAttendant || isAdminManagerSup

  const today = new Date().toISOString().slice(0, 10)
  const [viewDate, setViewDate] = useState(today)
  const [viewShiftType, setViewShiftType] = useState('') // '' = any
  const [searched, setSearched] = useState(false)

  const [shift, setShift] = useState(null)
  const [shiftLocked, setShiftLocked] = useState(false) 

  const [pumps, setPumps] = useState([])
  const [entries, setEntries] = useState({})
  const [staff, setStaff] = useState([])
  const [expenses, setExpenses] = useState({})
  const [loading, setLoading] = useState(true)

  const [prices, setPrices] = useState({ PMS: 6789, AGO: 7039 })
  const [showPriceSettings, setShowPriceSettings] = useState(false)
  const [editPrices, setEditPrices] = useState({ PMS: 0, AGO: 0 })

  const [liveData, setLiveData] = useState({})
  const [openPumpModal, setOpenPumpModal] = useState(null)
  const [openAssign, setOpenAssign] = useState(null)

  const [showPms, setShowPms] = useState(false)
  const [showAgo, setShowAgo] = useState(false)

  const nameById = useMemo(() => {
    const m = {}
    staff.forEach(s => { m[s.id] = s.name })
    return m
  }, [staff])

  const userPumps = useMemo(() => {
    const m = {}
    Object.values(entries).forEach(e => {
      if (!e?.user_id) return
      if (!m[e.user_id]) m[e.user_id] = []
      m[e.user_id].push(Number(e.pump_number))
    })
    return m
  }, [entries])

  const loadShift = useCallback(async (dateStr, shiftType, opts = {}) => {
    const { silent = false } = opts
    if (!silent) setLoading(true)
    try {
      let q = supabase.from('shifts')
        .select('*')
        .eq('station_id', user.station_id)
        .eq('shift_date', dateStr)
        .order('opened_at', { ascending: false })
        .limit(1)
      if (shiftType) q = q.eq('shift_type', shiftType)
      const { data: shifts } = await q
      const cur = shifts?.[0] || null
      setShift(cur)
      const locked = !!cur && cur.status !== 'open'
      setShiftLocked(locked)

      const { data: pumpList } = await supabase.from('pumps')
        .select('*')
        .eq('station_id', user.station_id)
        .eq('is_active', true)
        .order('pump_number')
      const normalizedPumps = (pumpList || []).map(p => ({
        ...p,
        pump_number: Number(p.pump_number),
      }))
      setPumps(normalizedPumps)

      const { data: priceData } = await supabase.from('station_prices')
        .select('*')
        .eq('station_id', user.station_id)
      if (priceData && priceData.length > 0) {
        const pObj = { PMS: 6789, AGO: 7039 }
        priceData.forEach(p => { pObj[p.product_name.toUpperCase()] = Number(p.price) })
        setPrices(pObj)
        setEditPrices(pObj)
      } else {
        setEditPrices(prev => (prev.PMS || prev.AGO ? prev : prices))
      }

      const { data: us } = await supabase.from('users')
        .select('id, name, role')
        .eq('station_id', user.station_id)
        .eq('is_active', true)
        .in('role', ['attendant', 'ambassador', 'supervisor'])
        .order('name')
      setStaff(us || [])

      if (!cur) {
        setEntries({})
        setLiveData({})
        setExpenses({})
        if (!silent) setLoading(false)
        return
      }

      const { data: existing } = await supabase
        .from('balance_entries').select('*').eq('shift_id', cur.id)
      let visibleEntries = existing || []
      if (!canEditAll) visibleEntries = visibleEntries.filter(e => e.user_id === user.id)

      const byPump = {}
      visibleEntries.forEach(e => {
        if (e.pump_number != null) byPump[Number(e.pump_number)] = e
      })
      setEntries(byPump)

      const startTime = cur.opened_at
      const endTime = cur.closed_at || new Date().toISOString()

      const [txnsRes, appUsersRes, dropsRes] = await Promise.all([
        supabase.from('transactions').select('*')
          .eq('station_id', user.station_id).eq('status', 'claimed')
          .gte('received_at', startTime).lte('received_at', endTime),
        supabase.from('app_users').select('*')
          .eq('station_id', user.station_id)
          .gte('txn_at', startTime).lte('txn_at', endTime),
        supabase.from('money_drops').select('*')
          .eq('shift_id', cur.id).eq('status', 'active'),
      ])

      const live = {}
      const initLive = id => { if (!live[id]) live[id] = { momo: 0, app: 0, drops: 0 } }
      ;(txnsRes.data || []).forEach(t => {
        if (t.claimed_by) {
          initLive(t.claimed_by)
          if (['airtel', 'mtn'].includes(t.provider)) live[t.claimed_by].momo += Number(t.amount)
        }
      })
      ;(appUsersRes.data || []).forEach(a => {
        if (a.claimed_by) { initLive(a.claimed_by); live[a.claimed_by].app += Number(a.amount) }
      })
      ;(dropsRes.data || []).forEach(d => {
        if (d.attendant_id) { initLive(d.attendant_id); live[d.attendant_id].drops += Number(d.amount) }
      })
      setLiveData(live)

      const ids = visibleEntries.map(e => e.id)
      const expMap = {}
      if (ids.length > 0) {
        const { data: exp } = await supabase
          .from('balance_expenses').select('*').in('entry_id', ids)
        ;(exp || []).forEach(x => {
          const entry = visibleEntries.find(e => e.id === x.entry_id)
          if (entry) {
            const p = Number(entry.pump_number)
            if (!expMap[p]) expMap[p] = []
            expMap[p].push(x)
          }
        })
      }
      setExpenses(expMap)
    } catch (e) {
      console.error('Load error:', e)
    }
    if (!silent) setLoading(false)
  }, [user.station_id, canEditAll, user.id]) 

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('shifts')
        .select('*')
        .eq('station_id', user.station_id)
        .in('status', ['open', 'pending_close'])
        .order('opened_at', { ascending: false })
        .limit(1)
      if (data?.[0]) {
        setViewDate(data[0].shift_date)
        setViewShiftType(data[0].shift_type)
        loadShift(data[0].shift_date, data[0].shift_type)
      } else {
        setLoading(false)
      }
    })()
  }, [])

  useEffect(() => {
    if (!searched) return
    loadShift(viewDate, viewShiftType)
  }, [viewDate, viewShiftType, searched])

  async function doSearch() {
    setSearched(true)
    await loadShift(viewDate, viewShiftType)
  }

  async function getAutoOpenMeters(pumpNumber) {
    const { data, error } = await supabase
      .from('balance_entries')
      .select('pms_close, ago_close, shifts!inner(status)')
      .eq('station_id', user.station_id)
      .eq('pump_number', Number(pumpNumber))
      .eq('shifts.status', 'closed')
      .order('shift_id', { ascending: false })
      .limit(1)
    if (error) {
      console.warn('auto-open lookup failed', error)
      return { pms_open: 0, ago_open: 0 }
    }
    const row = data?.[0]
    return {
      pms_open: Number(row?.pms_close || 0),
      ago_open: Number(row?.ago_close || 0),
    }
  }

  async function assignPump(pumpNumber, userId) {
    if (!shift || shiftLocked) return
    try {
      const pumpNum = Number(pumpNumber)
      const userIdToSave = userId === '' || userId === undefined ? null : userId

      if (userIdToSave) {
        const theirPumps = (userPumps[userIdToSave] || []).filter(pn => pn !== pumpNum)
        if (theirPumps.length > 0) {
          const partner = isPartnerOfPump(pumpNum, theirPumps[0])
          if (!partner || theirPumps.length > 1) {
            alert(
              `This attendant is already assigned to pump ${theirPumps.join(', ')}.\n` +
              `An attendant can only be on a pair like 1+2, 3+4, or 5+6.\n` +
              `Pump ${pumpNum} is not in the same pair.`
            )
            return
          }
          const [a, b] = pairOf(pumpNum)
          const allowed = new Set([a, b])
          if (theirPumps.some(p => !allowed.has(Number(p)))) {
            alert(
              `An attendant can only be assigned to pumps ${a} and ${b}. ` +
              `They are already on ${theirPumps.join(', ')}.`
            )
            return
          }
        }
      }

      const { data: existingRows, error: findErr } = await supabase
        .from('balance_entries').select('id')
        .eq('shift_id', shift.id).eq('pump_number', pumpNum).limit(1)
      if (findErr) throw findErr
      const existing = existingRows && existingRows[0]

      if (existing && userIdToSave === null) {
        const { error } = await supabase
          .from('balance_entries').delete().eq('id', existing.id)
        if (error) throw error
        setEntries(prev => { const n = { ...prev }; delete n[pumpNum]; return n })
        setOpenAssign(null)
        await loadShift(viewDate, viewShiftType, { silent: true })
        return
      }

      let savedRow, writeErr
      if (existing) {
        const r = await supabase
          .from('balance_entries').update({ user_id: userIdToSave })
          .eq('id', existing.id).select('*').single()
        savedRow = r.data; writeErr = r.error
      } else {
        const auto = await getAutoOpenMeters(pumpNum)
        const r = await supabase.from('balance_entries').insert({
          shift_id: shift.id,
          station_id: user.station_id,
          pump_number: pumpNum,
          user_id: userIdToSave,
          pms_open: auto.pms_open,
          pms_close: auto.pms_open,
          ago_open: auto.ago_open,
          ago_close: auto.ago_open,
        }).select('*').single()
        savedRow = r.data; writeErr = r.error
      }
      if (writeErr) throw writeErr

      if (savedRow) setEntries(prev => ({ ...prev, [pumpNum]: savedRow }))
      setOpenAssign(null)
      await loadShift(viewDate, viewShiftType, { silent: true })
    } catch (err) {
      console.error('Assign error:', err)
      alert('Failed to assign: ' + err.message)
    }
  }

  async function savePrices() {
    try {
      const updates = Object.keys(editPrices).map(product => ({
        station_id: user.station_id,
        product_name: product,
        price: Number(editPrices[product]),
        updated_at: new Date().toISOString(),
      }))
      const { error } = await supabase
        .from('station_prices').upsert(updates, { onConflict: 'station_id,product_name' })
      if (error) throw error
      setShowPriceSettings(false)
      await loadShift(viewDate, viewShiftType, { silent: true })
    } catch (err) {
      alert('Failed to save prices. ' + err.message)
    }
  }

  function handleExpensesChanged(pumpNum, list) {
    setExpenses(prev => ({ ...prev, [Number(pumpNum)]: list }))
  }

  function calcPump(pumpNumber) {
    const e = entries[Number(pumpNumber)]
    if (!e) return {
      pmsLiters: 0, agoLiters: 0, totalSales: 0, netBalance: 0,
      momo: 0, drops: 0, app: 0, totalExp: 0, cash: 0, visa: 0, salesDiff: 0,
      pms_open: 0, pms_close: 0, ago_open: 0, ago_close: 0, pmsSales: 0, agoSales: 0,
    }

    const pmsL = Math.max(0, Number(e.pms_close || 0) - Number(e.pms_open || 0))
    const agoL = Math.max(0, Number(e.ago_close || 0) - Number(e.ago_open || 0))
    const pmsS = pmsL * prices.PMS
    const agoS = agoL * prices.AGO
    const totalSales = pmsS + agoS

    const live = liveData[e.user_id] || { momo: 0, app: 0, drops: 0 }
    const momo = Number(e.momo) || live.momo
    const drops = Number(e.drops) || live.drops
    const app = Number(e.app_users) || live.app
    const salesDiff = Number(e.sales_difference || 0)
    const cash = Number(e.cash || 0)
    const visa = Number(e.visa || 0)

    const expList = (expenses[Number(pumpNumber)] || []).filter(x => x.status === 'approved')
    const totalExp = expList.reduce((a, x) => a + Number(x.amount || 0), 0)

    const deductions = totalExp + drops + momo + salesDiff + app + cash + visa
    const netBalance = totalSales - deductions

    return {
      pms_open: Number(e.pms_open || 0), pms_close: Number(e.pms_close || 0),
      ago_open: Number(e.ago_open || 0), ago_close: Number(e.ago_close || 0),
      pmsLiters: pmsL, agoLiters: agoL, pmsSales: pmsS, agoSales: agoS,
      totalSales, momo, drops, app, salesDiff, totalExp, cash, visa, netBalance,
    }
  }

  function calcRow(pumpNumber) {
    const n = Number(pumpNumber)
    const pair = pairOf(n)
    const primary = pair?.[0]
    const partner = pair?.find(x => x !== n)
    const own = calcPump(n)

    if (!pair || n !== primary) return { ...own, aggregated: false }

    const partnerEntry = partner ? entries[partner] : null
    const ownEntry = entries[n]
    const sameAttendant = partnerEntry?.user_id && ownEntry?.user_id &&
                          partnerEntry.user_id === ownEntry.user_id

    if (!sameAttendant) return { ...own, aggregated: false }

    const other = calcPump(partner)
    return {
      pms_open: own.pms_open, pms_close: own.pms_close,
      ago_open: own.ago_open, ago_close: own.ago_close,
      pmsLiters: own.pmsLiters + other.pmsLiters,
      agoLiters: own.agoLiters + other.agoLiters,
      pmsSales: own.pmsSales + other.pmsSales,
      agoSales: own.agoSales + other.agoSales,
      totalSales: own.totalSales + other.totalSales,
      momo: own.momo + other.momo,
      drops: own.drops + other.drops,
      app: own.app + other.app,
      salesDiff: own.salesDiff + other.salesDiff,
      totalExp: own.totalExp + other.totalExp,
      cash: own.cash + other.cash,
      visa: own.visa + other.visa,
      netBalance: own.netBalance + other.netBalance,
      aggregated: true,
    }
  }

  function pumpDisplay(pumpNumber, key) {
    const n = Number(pumpNumber)
    const pair = pairOf(n)
    if (!pair) return calcPump(n)[key]
    const primary = pair[0]
    if (n === primary) return calcRow(n)[key]
    const partnerEntry = entries[pair[0]]
    const ownEntry = entries[n]
    if (partnerEntry?.user_id && ownEntry?.user_id &&
        partnerEntry.user_id === ownEntry.user_id) {
      return null
    }
    return calcPump(n)[key]
  }

  function downloadCSV(filename, rows) {
    const csv = rows.map(r =>
      r.map(cell => {
        const s = String(cell ?? '')
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
      }).join(',')
    ).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  function exportMeters() {
    if (!visiblePumps.length) return alert('Nothing to export.')
    const header = [
      'Pump', 'Product', 'Attendant',
      'PMS Open', 'PMS Close', 'PMS Liters', 'PMS Sales',
      'AGO Open', 'AGO Close', 'AGO Liters', 'AGO Sales',
      'TOTAL SALES',
    ]
    const rows = [header]
    visiblePumps.forEach(p => {
      const r = calcPump(p.pump_number)
      const entry = entries[Number(p.pump_number)]
      rows.push([
        p.pump_number, p.product,
        entry?.user_id ? (nameById[entry.user_id] || 'Unknown') : 'Unassigned',
        r.pms_open, r.pms_close, r.pmsLiters, r.pmsSales,
        r.ago_open, r.ago_close, r.agoLiters, r.agoSales,
        r.totalSales,
      ])
    })
    const stamp = shift ? `${shift.shift_date}_${shift.shift_type}` : 'shift'
    downloadCSV(`meters_${stamp}.csv`, rows)
  }

  function exportFullSheet() {
    if (!visiblePumps.length) return alert('Nothing to export.')
    const header = ['', ...visiblePumps.map(p => `Pump ${p.pump_number}`)]
    const rows = [header]

    const pushRow = (label, getValue, isTotal = false) => {
      const row = [label, ...visiblePumps.map(p => {
        const v = getValue(p)
        return v === null ? '' : v
      })]
      if (isTotal) {
        row.push(visiblePumps.reduce((s, p) => {
          const v = getValue(p)
          return s + (v === null ? 0 : Number(v) || 0)
        }, 0))
      }
      rows.push(row)
    }

    pushRow('ATTENDANT', p => {
      const entry = entries[Number(p.pump_number)]
      return entry?.user_id ? (nameById[entry.user_id] || 'Unknown') : 'Unassigned'
    })
    pushRow('PMS LITERS', p => pumpDisplay(p.pump_number, 'pmsLiters'))
    pushRow('PMS SALES', p => pumpDisplay(p.pump_number, 'pmsSales'))
    pushRow('AGO LITERS', p => pumpDisplay(p.pump_number, 'agoLiters'))
    pushRow('AGO SALES', p => pumpDisplay(p.pump_number, 'agoSales'))
    pushRow('TOTAL SALES', p => pumpDisplay(p.pump_number, 'totalSales'), true)
    pushRow('DROPS', p => pumpDisplay(p.pump_number, 'drops'))
    pushRow('MOMO/AIRTEL', p => pumpDisplay(p.pump_number, 'momo'))
    pushRow('APP USERS', p => pumpDisplay(p.pump_number, 'app'))
    pushRow('SALES DIFF', p => pumpDisplay(p.pump_number, 'salesDiff'))
    pushRow('VISA', p => pumpDisplay(p.pump_number, 'visa'))
    pushRow('CASH', p => pumpDisplay(p.pump_number, 'cash'))
    pushRow('TOTAL EXPENSES', p => pumpDisplay(p.pump_number, 'totalExp'))
    pushRow('NET BALANCE', p => pumpDisplay(p.pump_number, 'netBalance'), true)

    const stamp = shift ? `${shift.shift_date}_${shift.shift_type}` : 'shift'
    downloadCSV(`balance_sheet_${stamp}.csv`, rows)
  }

  if (loading) return <div className="drops-empty">Loading…</div>

  const visiblePumps = canEditAll
    ? pumps
    : pumps.filter(p => entries[Number(p.pump_number)]?.user_id === user.id)

  const isAggregatedSecondary = (pumpNumber) => {
    const n = Number(pumpNumber)
    const pair = pairOf(n)
    if (!pair || n === pair[0]) return false
    const own = entries[n]
    const partner = entries[pair[0]]
    return !!(own?.user_id && partner?.user_id && own.user_id === partner.user_id)
  }

  const renderAggregatedCell = (pumpNumber, value) => {
    if (value === null || isAggregatedSecondary(pumpNumber)) {
      return <span style={{ color: C.muted }}>—</span>
    }
    return Number(value || 0).toLocaleString()
  }

  if (!shift) {
    return (
      <div style={{ padding: 24, background: C.bg, minHeight: '100%' }}>
        <SearchBar
          viewDate={viewDate} setViewDate={setViewDate}
          viewShiftType={viewShiftType} setViewShiftType={setViewShiftType}
          onSearch={doSearch}
          locked={false}
        />
        <div style={{
          marginTop: 32, padding: 48, background: C.card, borderRadius: 12,
          border: `1px solid ${C.border}`, textAlign: 'center', color: C.muted,
        }}>
          <i className="fas fa-calendar-times" style={{ fontSize: 32, opacity: 0.4 }} />
          <div style={{ marginTop: 12, fontSize: 15 }}>
            No shift found for <b>{viewDate}</b>{viewShiftType ? ` — ${viewShiftType} shift` : ''}.
          </div>
          <div style={{ marginTop: 6, fontSize: 12 }}>Try another date or shift type.</div>
        </div>
      </div>
    )
  }

  return (
    <div className="balancing-screen" style={{ background: C.bg, minHeight: '100%' }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        gap: 12, padding: '20px 32px 8px', flexWrap: 'wrap',
      }}>
        <div>
          <h3 style={{ margin: 0, color: C.text, fontSize: 20 }}>
            TEXOL LEGACY — {shift.shift_date}
            {shiftLocked && (
              <span style={{
                marginLeft: 10, padding: '2px 10px', borderRadius: 999,
                background: C.warnBg, color: C.warn, fontSize: 11,
                fontWeight: 700, verticalAlign: 'middle',
              }}>
                {String(shift.status).toUpperCase().replace('_', ' ')}
              </span>
            )}
          </h3>
          <div style={{ color: C.muted, fontSize: 12, letterSpacing: 0.5, marginTop: 2 }}>
            {shift.shift_type.toUpperCase()} SHIFT
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={exportMeters} style={btn('#0ea5e9')}>
            <i className="fas fa-file-export" style={{ marginRight: 6 }} /> Export Meters
          </button>
          <button onClick={exportFullSheet} style={btn(C.accent)}>
            <i className="fas fa-file-csv" style={{ marginRight: 6 }} /> Export Full Sheet
          </button>
          {canEditAll && !shiftLocked && (
            <button onClick={() => setShowPriceSettings(true)} style={btn(C.muted)}>
              <i className="fas fa-cog" style={{ marginRight: 6 }} /> Price Settings
            </button>
          )}
        </div>
      </div>

      <SearchBar
        viewDate={viewDate} setViewDate={setViewDate}
        viewShiftType={viewShiftType} setViewShiftType={setViewShiftType}
        onSearch={doSearch}
        locked={shiftLocked}
      />

      <div style={{ padding: '0 32px', marginBottom: 16, display: 'flex',
        gap: 12, fontSize: 13, fontWeight: 600, color: C.text }}>
        <span style={pill()}>PMS: {Number(prices.PMS).toLocaleString()}</span>
        <span style={pill()}>AGO: {Number(prices.AGO).toLocaleString()}</span>
        {shiftLocked && (
          <span style={{ ...pill(), background: C.warnBg, color: C.warn }}>
            <i className="fas fa-lock" style={{ marginRight: 6 }} />
            Sheet locked — shift is closed
          </span>
        )}
      </div>

      <div style={{ overflowX: 'auto', padding: '0 32px 32px' }}>
        <table className="balance-sheet" style={{
          width: '100%', borderCollapse: 'separate', borderSpacing: 0,
          background: C.card, borderRadius: 12, overflow: 'hidden',
          border: `1px solid ${C.border}`, boxShadow: '0 1px 3px rgba(15,23,42,0.04)',
        }}>
          <thead>
            <tr>
              <th style={{ ...th(), minWidth: 150 }}>NAMES</th>
              {visiblePumps.map(p => {
                const pn = Number(p.pump_number)
                const entry = entries[pn]
                const hasPendingExp = (expenses[pn] || []).some(x => x.status === 'pending')
                const secondaryAgg = isAggregatedSecondary(pn)
                return (
                  <th key={p.id} style={{ ...th(), minWidth: 130 }}>
                    <div style={{ fontWeight: 700, marginBottom: 4, color: C.text }}>
                      PUMP {pn}
                      {secondaryAgg && (
                        <span style={{
                          marginLeft: 6, fontSize: 9, color: C.muted,
                          background: C.soft, padding: '1px 5px', borderRadius: 3,
                          textTransform: 'none', fontWeight: 600,
                        }}>
                          combined under {pairOf(pn)?.[0]}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 10, color: C.muted, marginBottom: 8 }}>{p.product}</div>

                    {/* FIXED BUTTON LAYOUT HERE */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {entry && !shiftLocked && (canEditAll || entry.user_id === user.id) && (
                        <button onClick={() => setOpenPumpModal(p)}
                          style={{ ...btn(C.accent), width: '100%', padding: '4px 10px',
                            fontSize: 11 }}>
                          <i className="fas fa-edit" style={{ marginRight: 4 }} /> Edit Data
                        </button>
                      )}

                      {canEditAll && !shiftLocked && (
                        <button onClick={() => setOpenAssign(pn)}
                          style={{
                            ...btn(null, true), width: '100%', padding: '4px 10px', fontSize: 11,
                            background: '#fff', borderColor: C.accent, color: C.accent
                          }}>
                          {entry ? '↻ Reassign' : '+ Assign'}
                        </button>
                      )}
                    </div>

                    {canApproveExpenses && !shiftLocked && hasPendingExp && (
                      <div style={{
                        marginTop: 6, fontSize: 10, fontWeight: 700,
                        background: C.warnBg, color: C.warn,
                        padding: '2px 6px', borderRadius: 4, textAlign: 'center',
                      }}>
                        PENDING EXPENSES
                      </div>
                    )}
                  </th>
                )
              })}
              {canEditAll && <th style={{ ...th(), background: C.band }}>TOTAL</th>}
            </tr>
            <tr>
              <th style={{ ...th(), fontSize: 10 }}>ATTENDANT</th>
              {visiblePumps.map(p => {
                const pn = Number(p.pump_number)
                const entry = entries[pn]
                const label = entry?.user_id
                  ? nameById[entry.user_id] || 'Unknown user'
                  : 'Unassigned'
                return (
                  <th key={p.id} style={{
                    ...th(), fontSize: 11, padding: 8,
                    color: entry?.user_id ? '#92400e' : C.muted,
                  }}>
                    {label}
                  </th>
                )
              })}
              {canEditAll && <th style={{ ...th(), background: C.band }}></th>}
            </tr>
          </thead>
          <tbody>
            <tr style={{ cursor: 'pointer' }} onClick={() => setShowPms(v => !v)}>
              <td colSpan={visiblePumps.length + (canEditAll ? 2 : 1)}
                style={sectionRow()}>
                <span style={{ marginRight: 8 }}>{showPms ? '▾' : '▸'}</span>
                PMS
                <span style={{ marginLeft: 8, fontSize: 10, color: C.muted, fontWeight: 400 }}>
                  {showPms ? '(click to hide meters)' : '(click to show meters)'}
                </span>
              </td>
            </tr>
            {showPms && (
              <>
                <ReadonlyRow label="PMS OPEN" pumps={visiblePumps}
                  getValue={p => pumpDisplay(p.pump_number, 'pms_open')} render={renderAggregatedCell} />
                <ReadonlyRow label="PMS CLOSE" pumps={visiblePumps}
                  getValue={p => pumpDisplay(p.pump_number, 'pms_close')} render={renderAggregatedCell} />
                <ReadonlyRow label="PMS LITERS" pumps={visiblePumps}
                  getValue={p => pumpDisplay(p.pump_number, 'pmsLiters')} render={renderAggregatedCell} />
                <ReadonlyRow label="PMS SALES" pumps={visiblePumps}
                  getValue={p => pumpDisplay(p.pump_number, 'pmsSales')} render={renderAggregatedCell} />
              </>
            )}

            <tr style={{ cursor: 'pointer' }} onClick={() => setShowAgo(v => !v)}>
              <td colSpan={visiblePumps.length + (canEditAll ? 2 : 1)}
                style={sectionRow()}>
                <span style={{ marginRight: 8 }}>{showAgo ? '▾' : '▸'}</span>
                AGO
                <span style={{ marginLeft: 8, fontSize: 10, color: C.muted, fontWeight: 400 }}>
                  {showAgo ? '(click to hide meters)' : '(click to show meters)'}
                </span>
              </td>
            </tr>
            {showAgo && (
              <>
                <ReadonlyRow label="AGO OPEN" pumps={visiblePumps}
                  getValue={p => pumpDisplay(p.pump_number, 'ago_open')} render={renderAggregatedCell} />
                <ReadonlyRow label="AGO CLOSE" pumps={visiblePumps}
                  getValue={p => pumpDisplay(p.pump_number, 'ago_close')} render={renderAggregatedCell} />
                <ReadonlyRow label="AGO LITERS" pumps={visiblePumps}
                  getValue={p => pumpDisplay(p.pump_number, 'agoLiters')} render={renderAggregatedCell} />
                <ReadonlyRow label="AGO SALES" pumps={visiblePumps}
                  getValue={p => pumpDisplay(p.pump_number, 'agoSales')} render={renderAggregatedCell} />
              </>
            )}

            <tr style={{ background: C.accentSoft }}>
              <td style={{ ...td(), fontSize: 15, fontWeight: 900, color: C.text, letterSpacing: 0.4 }}>
                TOTAL SALES
              </td>
              {visiblePumps.map(p => {
                const v = pumpDisplay(p.pump_number, 'totalSales')
                return (
                  <td key={p.id} style={{
                    ...td(), textAlign: 'right', fontSize: 15, fontWeight: 900, color: C.text,
                  }}>
                    {renderAggregatedCell(p.pump_number, v)}
                  </td>
                )
              })}
              {canEditAll && (
                <td style={{ ...td(), background: C.band, fontSize: 15, fontWeight: 900, color: C.text }}>
                  {visiblePumps.reduce((s, p) => {
                    const v = pumpDisplay(p.pump_number, 'totalSales')
                    return s + (v === null ? 0 : Number(v) || 0)
                  }, 0).toLocaleString()}
                </td>
              )}
            </tr>

            <tr>
              <td colSpan={visiblePumps.length + (canEditAll ? 2 : 1)} style={sectionRow()}>
                DEDUCTIONS & PAYMENTS
              </td>
            </tr>
            <ReadonlyRow label="DROPS" pumps={visiblePumps}
              getValue={p => pumpDisplay(p.pump_number, 'drops')} render={renderAggregatedCell} />
            <ReadonlyRow label="MOMO/AIRTEL" pumps={visiblePumps}
              getValue={p => pumpDisplay(p.pump_number, 'momo')} render={renderAggregatedCell} />
            <ReadonlyRow label="APP USERS" pumps={visiblePumps}
              getValue={p => pumpDisplay(p.pump_number, 'app')} render={renderAggregatedCell} />
            <ReadonlyRow label="SALES DIFF" pumps={visiblePumps}
              getValue={p => pumpDisplay(p.pump_number, 'salesDiff')} render={renderAggregatedCell} />
            <ReadonlyRow label="VISA" pumps={visiblePumps}
              getValue={p => pumpDisplay(p.pump_number, 'visa')} render={renderAggregatedCell} />
            <ReadonlyRow label="CASH" pumps={visiblePumps}
              getValue={p => pumpDisplay(p.pump_number, 'cash')} render={renderAggregatedCell} />

            <tr>
              <td colSpan={visiblePumps.length + (canEditAll ? 2 : 1)} style={sectionRow()}>
                TOTAL EXPENSES (Approved only)
              </td>
            </tr>
            <ReadonlyRow label="TOTAL EXPENSES" pumps={visiblePumps}
              getValue={p => pumpDisplay(p.pump_number, 'totalExp')} render={renderAggregatedCell} />

            <tr>
              <td style={{ ...td(), fontSize: 14, fontWeight: 800, color: C.text }}>
                NET BALANCE
              </td>
              {visiblePumps.map(p => {
                const v = pumpDisplay(p.pump_number, 'netBalance')
                if (v === null) {
                  return (
                    <td key={p.id} style={{ ...td(), textAlign: 'right', fontWeight: 800, color: C.muted }}>
                      —
                    </td>
                  )
                }
                let textColor = C.text
                if (v > 300) textColor = C.danger
                else if (v < -300) textColor = C.success
                return (
                  <td key={p.id} style={{
                    ...td(), textAlign: 'right', fontWeight: 800, color: textColor,
                  }}>
                    {Number(v || 0).toLocaleString()}
                  </td>
                )
              })}
              {canEditAll && (
                <td style={{ ...td(), background: C.band, fontSize: 14, fontWeight: 800 }}>
                  {visiblePumps.reduce((s, p) => {
                    const v = pumpDisplay(p.pump_number, 'netBalance')
                    return s + (v === null ? 0 : Number(v) || 0)
                  }, 0).toLocaleString()}
                </td>
              )}
            </tr>
          </tbody>
        </table>
      </div>

      {showPriceSettings && (
        <div className="modal-bg"
          onClick={e => { if (e.target === e.currentTarget) setShowPriceSettings(false) }}>
          <div className="modal" style={{ maxWidth: 400, background: C.card }}>
            <h3 style={{ color: C.text }}>Station Prices</h3>
            <p style={{ fontSize: 12, color: C.muted, marginBottom: 16 }}>
              These prices apply to all pumps in the current shift.
            </p>
            <label style={{ color: C.text }}>PMS Price</label>
            <input type="number" value={editPrices.PMS}
              onChange={e => setEditPrices({ ...editPrices, PMS: e.target.value })}
              style={input()} />
            <label style={{ color: C.text }}>AGO Price</label>
            <input type="number" value={editPrices.AGO}
              onChange={e => setEditPrices({ ...editPrices, AGO: e.target.value })}
              style={input()} />
            <div className="modal-actions">
              <button className="btn-ghost-full" onClick={() => setShowPriceSettings(false)}>Cancel</button>
              <button className="btn-primary-full" onClick={savePrices}>Save Prices</button>
            </div>
          </div>
        </div>
      )}

      {openAssign !== null && (
        <AssignPumpModal
          profile={profile}
          pumpNumber={openAssign}
          currentEntry={entries[Number(openAssign)]}
          userPumps={userPumps}
          onClose={() => setOpenAssign(null)}
          onSave={assignPump}
        />
      )}

      {openPumpModal && (
        <PumpBalanceModal
          profile={profile}
          pump={openPumpModal}
          entry={entries[Number(openPumpModal.pump_number)]}
          liveData={liveData[entries[Number(openPumpModal.pump_number)]?.user_id]}
          globalPrices={prices}
          canEditFinances={canEditFinances}
          canApproveExpenses={canApproveExpenses}
          canAddExpenses={canAddExpenses}
          isAdmin={isAdmin} // <-- NEW: Passed to modal
          locked={shiftLocked}
          onClose={() => setOpenPumpModal(null)}
          onSaved={() => loadShift(viewDate, viewShiftType, { silent: true })}
          onExpensesChanged={handleExpensesChanged}
        />
      )}
    </div>
  )
}

function SearchBar({ viewDate, setViewDate, viewShiftType, setViewShiftType, onSearch, locked }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap',
      padding: '0 32px 16px',
    }}>
      <div>
        <label style={{ display: 'block', fontSize: 11, color: C.muted, marginBottom: 4 }}>Date</label>
        <input type="date" value={viewDate}
          onChange={e => setViewDate(e.target.value)}
          style={{ ...input(), width: 160, marginBottom: 0 }} />
      </div>
      <div>
        <label style={{ display: 'block', fontSize: 11, color: C.muted, marginBottom: 4 }}>Shift</label>
        <select value={viewShiftType}
          onChange={e => setViewShiftType(e.target.value)}
          style={{ ...input(), width: 140, marginBottom: 0 }}>
          <option value="day">Day</option>
          <option value="night">Night</option>
        </select>
      </div>
      <button onClick={onSearch} style={btn(C.accent, false, true)}>
        <i className="fas fa-search" style={{ marginRight: 6 }} /> Search
      </button>
      {locked && (
        <span style={{
          fontSize: 12, color: C.muted, padding: '6px 12px',
          background: C.soft, borderRadius: 6,
        }}>
          <i className="fas fa-lock" style={{ marginRight: 6 }} /> Read-only
        </span>
      )}
    </div>
  )
}

function ReadonlyRow({ label, pumps, getValue, render }) {
  return (
    <tr>
      <td style={{ ...td(), fontSize: 12, color: C.text }}>{label}</td>
      {pumps.map(p => {
        const v = getValue(p)
        return (
          <td key={p.id} style={{ ...td(), textAlign: 'right', fontWeight: 500, fontSize: 13 }}>
            {render ? render(p.pump_number, v) : (v === null ? '—' : Number(v || 0).toLocaleString())}
          </td>
        )
      })}
      {render && <td style={{ ...td(), background: C.band }}></td>}
    </tr>
  )
}

function AssignPumpModal({ profile, pumpNumber, currentEntry, userPumps, onClose, onSave }) {
  const user = profile.user
  const [staffList, setStaffList] = useState([])
  const [selectedUserId, setSelectedUserId] = useState(currentEntry?.user_id || '')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let mounted = true
    async function load() {
      const { data } = await supabase.from('users')
        .select('id, name, role')
        .eq('station_id', user.station_id)
        .eq('is_active', true)
        .in('role', ['attendant', 'ambassador', 'supervisor'])
        .order('name')
      if (mounted) setStaffList(data || [])
    }
    load()
    return () => { mounted = false }
  }, [user.station_id])

  const handleSave = async () => {
    setSaving(true)
    const userIdToSave = selectedUserId === '' ? null : selectedUserId
    await onSave(Number(pumpNumber), userIdToSave)
    setSaving(false)
  }

  const pair = pairOf(pumpNumber)
  const pairLabel = pair ? `Pumps ${pair[0]} & ${pair[1]}` : `Pump ${pumpNumber}`

  return (
    <div className="modal-bg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ background: C.card }}>
        <h3 style={{ color: C.text }}>
          {currentEntry ? `Reassign ${pairLabel}` : `Assign ${pairLabel}`}
        </h3>
        {pair && (
          <p style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>
            This pump is part of <b>Pumps {pair[0]} & {pair[1]}</b>. The same attendant must
            operate both. Their figures will be combined on the main sheet under Pump {pair[0]}.
          </p>
        )}
        <label style={{ color: C.text }}>Attendant</label>
        <select value={selectedUserId || ''}
          onChange={e => setSelectedUserId(e.target.value)}
          style={input()}>
          <option value="">— None (Unassign) —</option>
          {staffList.map(s => {
            const theirPumps = userPumps[s.id] || []
            const conflict = theirPumps.length > 0 &&
              theirPumps.some(pn => !isPartnerOfPump(pumpNumber, pn))
            return (
              <option key={s.id} value={s.id} disabled={conflict}>
                {s.name} ({s.role})
                {theirPumps.length > 0 ? ` — on pump ${theirPumps.join(', ')}` : ''}
                {conflict ? ' [conflict]' : ''}
              </option>
            )
          })}
        </select>
        <div className="modal-actions">
          <button className="btn-ghost-full" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn-primary-full" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

function btn(color, outline = false, wide = false) {
  return {
    background: outline ? 'transparent' : (color || C.accent),
    color: outline ? C.muted : '#fff',
    border: outline ? `1px dashed ${C.border}` : 'none',
    padding: wide ? '10px 18px' : '8px 14px',
    borderRadius: 6,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    boxShadow: outline ? 'none' : '0 1px 2px rgba(15,23,42,0.06)',
  }
}
function th() {
  return {
    background: C.soft,
    color: C.text,
    fontWeight: 700,
    fontSize: 12,
    padding: '10px 8px',
    borderBottom: `1px solid ${C.border}`,
    borderRight: `1px solid ${C.border}`,
    textAlign: 'center',
  }
}
function td() {
  return {
    padding: '8px 10px',
    borderBottom: `1px solid ${C.border}`,
    borderRight: `1px solid ${C.border}`,
    color: C.text,
  }
}
function sectionRow() {
  return {
    background: C.soft,
    color: C.text,
    fontWeight: 700,
    fontSize: 12,
    letterSpacing: 0.5,
    padding: '8px 12px',
    borderBottom: `1px solid ${C.border}`,
  }
}
function pill() {
  return {
    background: C.card,
    color: C.text,
    padding: '6px 12px',
    borderRadius: 6,
    border: `1px solid ${C.border}`,
    fontSize: 13,
    fontWeight: 600,
  }
}
function input() {
  return {
    width: '100%',
    padding: '8px 10px',
    borderRadius: 6,
    border: `1px solid ${C.border}`,
    background: C.card,
    color: C.text,
    fontSize: 13,
    marginBottom: 12,
  }
}