import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabase'

export default function Balancing({ profile }) {
  const user = profile.user
  const powers = profile.powers || {}
  const isManager = ['admin','manager'].includes(user.role)
  const isSupervisor = user.role === 'supervisor'
  const isAdminManagerSup = isManager || isSupervisor
  
  const canEditAll = isAdminManagerSup || powers.edit_balancing
  const canApprove = isAdminManagerSup || powers.approve_balancing
  const isAttendant = user.role === 'attendant' || user.role === 'ambassador'

  const [shift, setShift] = useState(null)
  const [pumps, setPumps] = useState([])
  const [entries, setEntries] = useState({})      
  const [staff, setStaff] = useState([])
  const [expenses, setExpenses] = useState({})    
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const [liveData, setLiveData] = useState({})
  const [openExpense, setOpenExpense] = useState(null)
  const [openAssign, setOpenAssign] = useState(null)

  const nameById = useMemo(() => {
    const m = {}
    staff.forEach(s => { m[s.id] = s.name })
    return m
  }, [staff])

  async function loadAll() {
    setLoading(true)
    try {
      const { data: shifts } = await supabase.from('shifts').select('*').eq('station_id', user.station_id).in('status', ['open','pending_close']).order('opened_at', { ascending: false }).limit(1)
      const cur = shifts?.[0] || null
      setShift(cur)

      const { data: pumpList } = await supabase.from('pumps').select('*').eq('station_id', user.station_id).eq('is_active', true).order('pump_number')
      setPumps(pumpList || [])

      const { data: us } = await supabase.from('users').select('id, name, role').eq('station_id', user.station_id).eq('is_active', true).in('role', ['attendant','ambassador','supervisor']).order('name')
      setStaff(us || [])

      if (!cur) { setLoading(false); return }

      const { data: existing } = await supabase.from('balance_entries').select('*').eq('shift_id', cur.id)
      let visibleEntries = existing || []
      if (!canEditAll) visibleEntries = visibleEntries.filter(e => e.user_id === user.id)

      const byPump = {}
      visibleEntries.forEach(e => { if (e.pump_number) byPump[e.pump_number] = e })
      setEntries(byPump)

      // Fetch Live DB Data for current shift
      const startTime = cur.opened_at
      const endTime = cur.closed_at || new Date().toISOString()

      const [txnsRes, appUsersRes, dropsRes, cardsRes] = await Promise.all([
        supabase.from('transactions').select('*').eq('station_id', user.station_id).eq('status', 'claimed').gte('received_at', startTime).lte('received_at', endTime),
        supabase.from('app_users').select('*').eq('station_id', user.station_id).gte('txn_at', startTime).lte('txn_at', endTime),
        supabase.from('money_drops').select('*').eq('shift_id', cur.id).eq('status', 'active'),
        supabase.from('card_sales').select('*').eq('station_id', user.station_id).gte('txn_at', startTime).lte('txn_at', endTime)
      ])

      const live = {}
      const initLive = (id) => { if (!live[id]) live[id] = { momo: 0, app: 0, drops: 0, cardDiff: 0 } }

      ;(txnsRes.data || []).forEach(t => {
        if (!t.claimed_by) return
        initLive(t.claimed_by)
        if (t.provider === 'airtel' || t.provider === 'mtn') live[t.claimed_by].momo += Number(t.amount)
      })
      ;(appUsersRes.data || []).forEach(a => {
        if (!a.claimed_by) return
        initLive(a.claimed_by)
        live[a.claimed_by].app += Number(a.amount)
      })
      ;(dropsRes.data || []).forEach(d => {
        if (!d.attendant_id) return
        initLive(d.attendant_id)
        live[d.attendant_id].drops += Number(d.amount)
      })
      ;(cardsRes.data || []).forEach(c => {
        if (!c.staff_name) return
        const u = staff.find(x => x.name === c.staff_name)
        if (u) {
          initLive(u.id)
          live[u.id].cardDiff += (Number(c.discounted_amount || c.original_amount || 0) - Number(c.original_amount || 0))
        }
      })
      setLiveData(live)

      const ids = visibleEntries.map(e => e.id)
      const expMap = {}
      if (ids.length > 0) {
        const { data: exp } = await supabase.from('balance_expenses').select('*').in('entry_id', ids)
        ;(exp || []).forEach(x => {
          const entry = visibleEntries.find(e => e.id === x.entry_id)
          if (entry) {
            const p = entry.pump_number
            if (!expMap[p]) expMap[p] = []
            expMap[p].push(x)
          }
        })
      }
      setExpenses(expMap)

    } catch (e) {
      console.error('Load error:', e)
    }
    setLoading(false)
  }

  useEffect(() => { loadAll() }, [user.station_id])

  async function assignPump(pumpNumber, userId) {
    if (!shift) return
    setBusy(true)
    const { data: existing } = await supabase.from('balance_entries').select('id').eq('shift_id', shift.id).eq('pump_number', pumpNumber).maybeSingle()
    if (existing) {
      await supabase.from('balance_entries').update({ user_id: userId }).eq('id', existing.id)
    } else {
      await supabase.from('balance_entries').insert({ shift_id: shift.id, station_id: user.station_id, pump_number: pumpNumber, user_id: userId })
    }
    setBusy(false)
    setOpenAssign(null)
    await loadAll()
  }

  async function saveField(pumpNumber, field, value) {
    const entry = entries[pumpNumber]
    if (!entry) return
    setEntries(prev => ({ ...prev, [pumpNumber]: { ...prev[pumpNumber], [field]: Number(value) || 0 } }))
    await supabase.from('balance_entries').update({ [field]: Number(value) || 0 }).eq('id', entry.id)
  }

  async function approveExpense(id) {
    await supabase.from('balance_expenses').update({ status: 'approved', approved_by: user.id, approved_at: new Date().toISOString() }).eq('id', id)
    await loadAll()
  }

  function calcRow(pumpNumber) {
    const e = entries[pumpNumber]
    if (!e) return { pmsLiters: 0, agoLiters: 0, pmsSales: 0, agoSales: 0, totalSales: 0, netBalance: 0 }

    // Meters
    const pmsL = Math.max(0, Number(e.pms_close || 0) - Number(e.pms_open || 0))
    const agoL = Math.max(0, Number(e.ago_close || 0) - Number(e.ago_open || 0))
    const pmsS = pmsL * Number(e.pms_price || 6789)
    const agoS = agoL * Number(e.ago_price || 7039)
    
    // Total Sales
    const totalSales = pmsS + agoS

    // Auto
    const live = liveData[e.user_id] || { momo: 0, app: 0, drops: 0, cardDiff: 0 }
    const momo = Number(e.momo) || live.momo
    const drops = Number(e.drops) || live.drops
    const app = Number(e.app_users) || live.app
    const salesDiff = Number(e.sales_difference) || live.cardDiff

    // Manual
    const cash = Number(e.cash || 0)
    const visa = Number(e.visa || 0)

    // Expenses
    const expList = (expenses[pumpNumber] || []).filter(x => x.status === 'approved')
    const totalExp = expList.reduce((a, x) => a + Number(x.amount || 0), 0)

    // Formula
    const deductions = totalExp + drops + momo + salesDiff + app + cash + visa
    const netBalance = totalSales - deductions

    return { pmsLiters: pmsL, agoLiters: agoL, pmsSales: pmsS, agoSales: agoS, totalSales, momo, drops, app, salesDiff, totalExp, cash, visa, netBalance }
  }

  if (loading) return <div className="drops-empty">Loading…</div>
  if (!shift) return <div className="drops-empty">No open shift.</div>

  const visiblePumps = canEditAll ? pumps : pumps.filter(p => entries[p.pump_number]?.user_id === user.id)

  return (
    <div className="balancing-screen">
      <div className="balance-sheet-head">
        <div>
          <h3>TEXOL LEGACY — {shift.shift_date}</h3>
          <div className="sub">{shift.shift_type.toUpperCase()} SHIFT</div>
        </div>
      </div>

      <div style={{ overflowX: 'auto', padding: '0 32px 32px' }}>
        <table className="balance-sheet">
          <thead>
            <tr>
              <th className="sticky-col">NAMES</th>
              {visiblePumps.map(p => (
                <th key={p.id} className="staff-head" onClick={() => canEditAll && setOpenAssign(p.pump_number)} style={{ cursor: 'pointer' }}>
                  <div className="staff-name">PUMP {p.pump_number}</div>
                  <div style={{ fontSize: 9 }}>{p.product}</div>
                </th>
              ))}
            </tr>
            <tr>
              <th className="sticky-col" style={{ fontSize: 10 }}>ATTENDANT</th>
              {visiblePumps.map(p => (
                <th key={p.id} style={{ fontSize: 11 }}>{entries[p.pump_number] ? nameById[entries[p.pump_number].user_id] : '—'}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            
            {/* PMS METERS */}
            <tr className="section-head"><td className="sticky-col" colSpan={visiblePumps.length + 1}>PMS</td></tr>
            <SimpleEditRow label="PMS OPEN" field="pms_open" pumps={visiblePumps} entries={entries} canEdit={canEditAll} onSave={saveField} />
            <SimpleEditRow label="PMS CLOSE" field="pms_close" pumps={visiblePumps} entries={entries} canEdit={canEditAll} onSave={saveField} />
            <SimpleEditRow label="PMS PRICE" field="pms_price" pumps={visiblePumps} entries={entries} canEdit={canEditAll} onSave={saveField} />
            <ReadonlyRow label="PMS LITERS" pumps={visiblePumps} getValue={(p) => calcRow(p.pump_number).pmsLiters} />
            <ReadonlyRow label="PMS SALES" pumps={visiblePumps} getValue={(p) => calcRow(p.pump_number).pmsSales} />

            {/* AGO METERS */}
            <tr className="section-head"><td className="sticky-col" colSpan={visiblePumps.length + 1}>AGO</td></tr>
            <SimpleEditRow label="AGO OPEN" field="ago_open" pumps={visiblePumps} entries={entries} canEdit={canEditAll} onSave={saveField} />
            <SimpleEditRow label="AGO CLOSE" field="ago_close" pumps={visiblePumps} entries={entries} canEdit={canEditAll} onSave={saveField} />
            <SimpleEditRow label="AGO PRICE" field="ago_price" pumps={visiblePumps} entries={entries} canEdit={canEditAll} onSave={saveField} />
            <ReadonlyRow label="AGO LITERS" pumps={visiblePumps} getValue={(p) => calcRow(p.pump_number).agoLiters} />
            <ReadonlyRow label="AGO SALES" pumps={visiblePumps} getValue={(p) => calcRow(p.pump_number).agoSales} />

            {/* TOTAL SALES */}
            <ReadonlyRow label="TOTAL SALES" pumps={visiblePumps} getValue={(p) => calcRow(p.pump_number).totalSales} highlight />

            {/* AUTO DATA */}
            <SimpleEditRow label="DROPS" field="drops" pumps={visiblePumps} entries={entries} canEdit={canEditAll} onSave={saveField} placeholder={(p) => calcRow(p.pump_number).drops} />
            <SimpleEditRow label="MOMO/AIRTEL" field="momo" pumps={visiblePumps} entries={entries} canEdit={canEditAll} onSave={saveField} placeholder={(p) => calcRow(p.pump_number).momo} />
            <SimpleEditRow label="APP USERS" field="app_users" pumps={visiblePumps} entries={entries} canEdit={canEditAll} onSave={saveField} placeholder={(p) => calcRow(p.pump_number).app} />
            <SimpleEditRow label="SALES DIFF" field="sales_difference" pumps={visiblePumps} entries={entries} canEdit={canEditAll} onSave={saveField} placeholder={(p) => calcRow(p.pump_number).salesDiff} />

            {/* MANUAL DATA */}
            <SimpleEditRow label="VISA" field="visa" pumps={visiblePumps} entries={entries} canEdit={canEditAll} onSave={saveField} />
            <SimpleEditRow label="CASH" field="cash" pumps={visiblePumps} entries={entries} canEdit={canEditAll || isAttendant} onSave={saveField} />

            {/* EXPENSES */}
            <tr className="section-head"><td className="sticky-col" colSpan={visiblePumps.length + 1}>EXPENSES (Approved only count towards balance)</td></tr>
            {visiblePumps.map(p => {
              const list = (expenses[p.pump_number] || [])
              const approvedTotal = list.filter(x => x.status === 'approved').reduce((a,x) => a + Number(x.amount||0), 0)
              const entry = entries[p.pump_number]
              return (
                <tr key={p.id}>
                  <td className="sticky-col">
                    EXPENSES (Pump {p.pump_number})
                    {entry && <button className="btn-tiny" onClick={() => setOpenExpense({ pumpNumber: p.pump_number, type: 'Expense' })}><i className="fas fa-plus" /></button>}
                  </td>
                  <td colSpan={visiblePumps.length} style={{ textAlign: 'right', fontWeight: 700 }}>UGX {approvedTotal.toLocaleString()}</td>
                </tr>
              )
            })}

            {/* FINAL BALANCE */}
            <tr className="balance-row">
              <td className="sticky-col">BALANCE</td>
              {visiblePumps.map(p => {
                const val = calcRow(p.pump_number).netBalance
                let cls = 'balance-zero'
                if (val > 300) cls = 'balance-short'
                else if (val < -300) cls = 'balance-excess'

                return (
                  <td key={p.id} className={cls} style={{ textAlign: 'right', fontWeight: 800 }}>
                    {val.toLocaleString()}
                  </td>
                )
              })}
            </tr>

          </tbody>
        </table>
      </div>

      {openAssign !== null && <AssignPumpModal profile={profile} pumpNumber={openAssign} currentEntry={entries[openAssign]} pumps={pumps} onClose={() => setOpenAssign(null)} onSave={assignPump} />}
      {openExpense && <ExpenseModal profile={profile} onClose={() => setOpenExpense(null)} onSaved={async () => { setOpenExpense(null); await loadAll() }} {...openExpense} />}
    </div>
  )
}

function SimpleEditRow({ label, field, pumps, entries, canEdit, onSave, highlight, placeholder }) {
  return (
    <tr className={highlight ? 'highlight-row' : ''}>
      <td className="sticky-col">{label}</td>
      {pumps.map(p => {
        const e = entries[p.pump_number]
        const val = e?.[field] ?? 0
        const liveVal = placeholder ? placeholder(p) : null
        const displayVal = (Number(val) === 0 && liveVal !== null) ? liveVal : val
        const isLive = (Number(val) === 0 && liveVal !== null && liveVal !== 0)
        return (
          <td key={p.id}>
            {isLive ? (
              <div style={{ textAlign: 'right', color: '#8ba0b9', fontStyle: 'italic', fontSize: 13, paddingRight: 8 }}>
                {Number(displayVal).toLocaleString()}
              </div>
            ) : (
              <CellInput value={val} canEdit={canEdit && e} onSave={(v) => onSave(p.pump_number, field, v)} />
            )}
          </td>
        )
      })}
    </tr>
  )
}

function ReadonlyRow({ label, pumps, getValue, highlight }) {
  return (
    <tr className={highlight ? 'highlight-row' : ''}>
      <td className="sticky-col">{label}</td>
      {pumps.map(p => (
        <td key={p.id} style={{ textAlign: 'right', fontWeight: highlight ? 700 : 400 }}>
          {Number(getValue(p) || 0).toLocaleString()}
        </td>
      ))}
    </tr>
  )
}

function CellInput({ value, canEdit, onSave }) {
  const [v, setV] = useState(value || '')
  const [saved, setSaved] = useState(false)
  useEffect(() => { setV(value || '') }, [value])
  if (!canEdit) return <span style={{ textAlign: 'right', display: 'block' }}>{Number(value || 0).toLocaleString()}</span>
  return (
    <input type="number" value={v} onChange={e => setV(e.target.value)} onBlur={() => {
      if (Number(v) !== Number(value)) { onSave(v); setSaved(true); setTimeout(() => setSaved(false), 800) }
    }} style={{ width: '100%', padding: '6px', border: saved ? '2px solid #10b981' : '1px solid #e2e8f0', borderRadius: 4, textAlign: 'right', fontSize: 13 }} />
  )
}

function AssignPumpModal({ profile, pumpNumber, currentEntry, pumps, onClose, onSave }) {
  const user = profile.user
  const [staffList, setStaffList] = useState([])
  const [selectedUserId, setSelectedUserId] = useState(currentEntry?.user_id || '')
  useEffect(() => {
    async function load() {
      const { data } = await supabase.from('users').select('id, name, role').eq('station_id', user.station_id).in('role', ['attendant','ambassador']).order('name')
      setStaffList(data || [])
    }
    load()
  }, [user.station_id])
  return (
    <div className="modal-bg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <h3>Assign Pump {pumpNumber}</h3>
        <label>Attendant</label>
        <select value={selectedUserId} onChange={e => setSelectedUserId(e.target.value)}>
          <option value="">— None —</option>
          {staffList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <div className="modal-actions">
          <button className="btn-ghost-full" onClick={onClose}>Cancel</button>
          <button className="btn-primary-full" onClick={() => onSave(pumpNumber, selectedUserId)}>Save</button>
        </div>
      </div>
    </div>
  )
}

function ExpenseModal({ profile, pumpNumber, type, onClose, onSaved }) {
  const user = profile.user
  const isManager = ['admin','manager','supervisor'].includes(user.role)
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  async function save() {
    if (!amount) return
    const { data: entry } = await supabase.from('balance_entries').select('id').eq('pump_number', pumpNumber).eq('station_id', user.station_id).order('created_at', { ascending: false }).limit(1).single()
    if (!entry) return
    await supabase.from('balance_expenses').insert({
      entry_id: entry.id, expense_type: type, amount: Number(amount), note,
      status: isManager ? 'approved' : 'pending',
      approved_by: isManager ? user.id : null, approved_at: isManager ? new Date().toISOString() : null,
    })
    onSaved()
  }
  return (
    <div className="modal-bg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <h3>Add Expense — {type}</h3>
        <div className="modal-sub">Pump {pumpNumber} · {isManager ? 'Auto-approved' : 'Pending Approval'}</div>
        <label>Amount</label>
        <input type="number" value={amount} onChange={e => setAmount(e.target.value)} autoFocus />
        <label>Note</label>
        <input value={note} onChange={e => setNote(e.target.value)} />
        <div className="modal-actions">
          <button className="btn-ghost-full" onClick={onClose}>Cancel</button>
          <button className="btn-primary-full" onClick={save}>Save</button>
        </div>
      </div>
    </div>
  )
}