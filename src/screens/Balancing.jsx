import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabase'

const DEFAULT_EXPENSES = ['Water','Lunch','Super','Banking','Discount','Others']

export default function Balancing({ profile }) {
  const user = profile.user
  const isManager = ['admin','manager'].includes(user.role)
  const isSupervisor = user.role === 'supervisor'
  const canEditAll = isManager || isSupervisor
  const canApprove = isManager || isSupervisor

  const [shift, setShift] = useState(null)
  const [entries, setEntries] = useState([])
  const [expenses, setExpenses] = useState({})   // entry_id -> [expense rows]
  const [credits, setCredits] = useState({})     // entry_id -> [credit rows]
  const [customers, setCustomers] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedShift, setSelectedShift] = useState('current')

  // Load open shift + all data
  async function loadAll() {
    setLoading(true)
    const today = new Date().toISOString().slice(0, 10)

    // Current open shift
    const { data: shifts } = await supabase
      .from('shifts')
      .select('*')
      .eq('station_id', user.station_id)
      .eq('shift_date', today)
      .order('opened_at', { ascending: false })
      .limit(1)
    const cur = shifts?.[0] || null
    setShift(cur)

    if (!cur) { setLoading(false); return }

    // Entries for this shift
    const { data: ent } = await supabase
      .from('balance_entries')
      .select('*, users(id, name, role, initials)')
      .eq('shift_id', cur.id)
      .order('created_at')

    setEntries(ent || [])

    // Expenses + credits
    const eMap = {}
    const cMap = {}
    if (ent && ent.length > 0) {
      const ids = ent.map(e => e.id)
      const { data: exp } = await supabase
        .from('balance_expenses')
        .select('*')
        .in('entry_id', ids)
      ;(exp || []).forEach(x => {
        if (!eMap[x.entry_id]) eMap[x.entry_id] = []
        eMap[x.entry_id].push(x)
      })

      const { data: cr } = await supabase
        .from('balance_credits')
        .select('*, customers(name, customer_type)')
        .in('entry_id', ids)
      ;(cr || []).forEach(x => {
        if (!cMap[x.entry_id]) cMap[x.entry_id] = []
        cMap[x.entry_id].push(x)
      })
    }
    setExpenses(eMap)
    setCredits(cMap)

    // Customers for picker
    const { data: cust } = await supabase
      .from('customers')
      .select('id, name, customer_type, card_number')
      .eq('station_id', user.station_id)
      .eq('is_active', true)
      .order('name')
    setCustomers(cust || [])

    setLoading(false)
  }

  useEffect(() => { loadAll() }, [user.station_id])

  // Ensure a row exists for every station staff (auto-create entries)
  async function ensureRoster() {
    if (!shift) return
    const { data: staff } = await supabase
      .from('users')
      .select('id, role')
      .eq('station_id', user.station_id)
      .eq('is_active', true)
      .in('role', ['attendant','ambassador','supervisor'])
    const existing = new Set(entries.map(e => e.user_id))
    const toAdd = (staff || []).filter(s => !existing.has(s.id))
    if (toAdd.length === 0) return
    const rows = toAdd.map(s => ({
      shift_id: shift.id,
      station_id: user.station_id,
      user_id: s.id,
    }))
    await supabase.from('balance_entries').insert(rows)
    await loadAll()
  }

  useEffect(() => { if (shift && entries.length === 0) ensureRoster() }, [shift?.id])

  // Compute totals per row (for TOTAL column)
  const totalsByStaff = useMemo(() => {
    const t = {
      total_sales: 0, drops: 0, visa: 0, momo: 0, card_sales: 0,
      app_user: 0, expenses: 0, credits: 0, cash_in_hand: 0, topup: 0, balance: 0,
    }
    entries.forEach(e => {
      t.total_sales += Number(e.total_sales || 0)
      t.visa += Number(e.visa || 0)
      t.momo += Number(e.momo || 0)
      t.card_sales += Number(e.card_sales_manual || 0)
      t.app_user += Number(e.app_user || 0)
      t.cash_in_hand += Number(e.cash_in_hand || 0)
      t.balance += Number(e.balance || 0)
      t.expenses += (expenses[e.id] || []).filter(x => x.status === 'approved').reduce((s,x) => s + Number(x.amount || 0), 0)
      t.credits += (credits[e.id] || []).filter(x => x.status === 'approved').reduce((s,x) => s + Number(x.amount || 0), 0)
    })
    return t
  }, [entries, expenses, credits])

  if (loading) return <div className="drops-empty">Loading…</div>

  if (!shift) {
    return (
      <div className="balancing-screen">
        <div className="drops-empty">
          <i className="fas fa-balance-scale" />
          <h4>No open shift</h4>
          <p>Start a shift in Timetable to see the balancing sheet.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="balancing-screen">
      <div className="balance-sheet-head">
        <div>
          <h3>Staff Balancing Sheet</h3>
          <div className="sub">
            {shift.shift_date} · {String(shift.shift_type).toUpperCase()} · {shift.status}
          </div>
        </div>
        <div className="balance-sheet-actions">
          <button className="btn-ghost" onClick={() => downloadCSV(entries, expenses, credits, totalsByStaff)}>
            <i className="fas fa-file-csv" /> CSV
          </button>
          <button className="btn-primary" onClick={() => downloadWord(entries, expenses, credits, totalsByStaff, shift)}>
            <i className="fas fa-file-word" /> Word
          </button>
        </div>
      </div>

      <div style={{ overflowX: 'auto', padding: '0 32px 32px' }}>
        <table className="balance-sheet">
          <thead>
            <tr>
              <th className="sticky-col">Row</th>
              {entries.map(e => (
                <th key={e.id} className="staff-head">
                  <div className="staff-name">{e.users?.name || '—'}</div>
                  <div className="staff-role">{e.users?.role}</div>
                </th>
              ))}
              <th className="total-col">TOTAL</th>
            </tr>
          </thead>
          <tbody>
            {/* Supervisor-only inputs */}
            {canEditAll ? (
              <>
                <EditableRow label="Total Sales" field="total_sales" entries={entries} canEdit={canEditAll} onReload={loadAll} />
                <EditableRow label="Visa" field="visa" entries={entries} canEdit={canEditAll} onReload={loadAll} />
              </>
            ) : (
              <>
                <ReadonlyRow label="Total Sales" entries={entries} field="total_sales" />
                <ReadonlyRow label="Visa" entries={entries} field="visa" />
              </>
            )}

            {/* Auto rows */}
            <AutoRow label="Drops" entries={entries} field="drops" />
            <AutoRow label="Momo / Airtel" entries={entries} field="momo" />

            {/* Card sales (manual override) */}
            <EditableRow label="Card Sales" field="card_sales_manual" entries={entries} canEdit={canEditAll} onReload={loadAll} />

            {/* App user — attendant editable */}
            <EditableRow
              label="App User"
              field="app_user"
              entries={entries}
              canEdit={true}
              onReload={loadAll}
              onlyOwn={!canEditAll}
            />

            {/* Expenses */}
            <tr className="section-head">
              <td className="sticky-col">Expenses</td>
              {entries.map(e => <td key={e.id}></td>)}
              <td className="total-col"></td>
            </tr>
            {DEFAULT_EXPENSES.map(type => (
              <ExpenseRow
                key={type}
                type={type}
                entries={entries}
                expenses={expenses}
                canEditAll={canEditAll}
                canApprove={canApprove}
                onReload={loadAll}
                currentUserId={user.id}
              />
            ))}

            {/* Credits section */}
            <tr className="section-head">
              <td className="sticky-col">Credits (customers)</td>
              {entries.map(e => <td key={e.id}></td>)}
              <td className="total-col"></td>
            </tr>
            {entries.map(e => (
              <CreditRow
                key={e.id}
                entry={e}
                list={credits[e.id] || []}
                customers={customers}
                canEditAll={canEditAll}
                canApprove={canApprove}
                currentUserId={user.id}
                onReload={loadAll}
              />
            ))}

            {/* Cash in hand */}
            <EditableRow
              label="Cash in Hand"
              field="cash_in_hand"
              entries={entries}
              canEdit={true}
              onReload={loadAll}
              onlyOwn={!canEditAll}
            />

            {/* Topup auto */}
            <AutoRow label="Topup" entries={entries} field="topup" />

            {/* Balance */}
            <tr className="balance-row">
              <td className="sticky-col">Balance</td>
              {entries.map(e => (
                <td key={e.id} className={balanceClass(e.balance)}>
                  <div>{Number(e.balance || 0).toLocaleString()}</div>
                  {e.balance_status === 'pending' && canApprove && (
                    <button className="btn-tiny success" onClick={() => approveBalance(e.id, loadAll)}>
                      <i className="fas fa-check" /> Approve
                    </button>
                  )}
                  {e.balance_status === 'approved' && (
                    <span className="pill green" style={{ fontSize: 10 }}>approved</span>
                  )}
                </td>
              ))}
              <td className="total-col">{totalsByStaff.balance.toLocaleString()}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ============================================================
   ROW COMPONENTS
   ============================================================ */
function EditableRow({ label, field, entries, canEdit, onReload, onlyOwn }) {
  return (
    <tr>
      <td className="sticky-col">{label}</td>
      {entries.map(e => (
        <td key={e.id}>
          <EditableCell
            entry={e}
            field={field}
            canEdit={canEdit && (!onlyOwn || e.user_id === e.users?.id)}
            ownUserId={e.user_id}
            onReload={onReload}
          />
        </td>
      ))}
      <td className="total-col">
        {entries.reduce((s, e) => s + Number(e[field] || 0), 0).toLocaleString()}
      </td>
    </tr>
  )
}

function EditableCell({ entry, field, canEdit, onReload }) {
  const [val, setVal] = useState(entry[field] || '')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => { setVal(entry[field] || '') }, [entry[field]])

  async function save() {
    setBusy(true)
    await supabase.from('balance_entries').update({ [field]: Number(val) || 0 }).eq('id', entry.id)
    setBusy(false); setSaved(true)
    setTimeout(() => setSaved(false), 1200)
    onReload && onReload()
  }

  if (!canEdit) return <span>{Number(entry[field] || 0).toLocaleString()}</span>

  return (
    <input
      type="number"
      value={val}
      onChange={e => setVal(e.target.value)}
      onBlur={save}
      onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
      style={{
        width: '100%', padding: '6px 8px',
        border: saved ? '2px solid #10b981' : '1px solid #e2e8f0',
        borderRadius: 6, fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
        textAlign: 'right',
      }}
    />
  )
}

function ReadonlyRow({ label, entries, field }) {
  return (
    <tr>
      <td className="sticky-col">{label}</td>
      {entries.map(e => <td key={e.id}>{Number(e[field] || 0).toLocaleString()}</td>)}
      <td className="total-col">
        {entries.reduce((s, e) => s + Number(e[field] || 0), 0).toLocaleString()}
      </td>
    </tr>
  )
}

function AutoRow({ label, entries, field }) {
  return (
    <tr className="auto-row">
      <td className="sticky-col">{label} <i className="fas fa-robot" style={{ color: '#8ba0b9', fontSize: 10 }} /></td>
      {entries.map(e => <td key={e.id}>{Number(e[field] || 0).toLocaleString()}</td>)}
      <td className="total-col">
        {entries.reduce((s, e) => s + Number(e[field] || 0), 0).toLocaleString()}
      </td>
    </tr>
  )
}

function ExpenseRow({ type, entries, expenses, canEditAll, canApprove, onReload, currentUserId }) {
  async function addExpense(entry, amount, note) {
    await supabase.from('balance_expenses').insert({
      entry_id: entry.id,
      expense_type: type,
      amount: Number(amount),
      note: note || null,
      status: canEditAll ? 'approved' : 'pending',
      approved_by: canEditAll ? currentUserId : null,
      approved_at: canEditAll ? new Date().toISOString() : null,
      created_by: currentUserId,
    })
    onReload()
  }

  async function approve(id) {
    await supabase.from('balance_expenses').update({
      status: 'approved',
      approved_by: currentUserId,
      approved_at: new Date().toISOString(),
    }).eq('id', id)
    onReload()
  }

  async function reject(id) {
    await supabase.from('balance_expenses').update({
      status: 'rejected',
      approved_by: currentUserId,
      approved_at: new Date().toISOString(),
    }).eq('id', id)
    onReload()
  }

  return (
    <tr>
      <td className="sticky-col">{type}</td>
      {entries.map(e => {
        const list = (expenses[e.id] || []).filter(x => x.expense_type === type)
        const total = list.filter(x => x.status === 'approved').reduce((s, x) => s + Number(x.amount || 0), 0)
        return (
          <td key={e.id} className="expense-cell">
            <div style={{ fontSize: 12, fontWeight: 700 }}>{total.toLocaleString()}</div>
            <button className="btn-tiny" onClick={() => {
              const amt = prompt(`Amount for ${type}?`, '0')
              if (!amt) return
              const note = prompt('Note (optional)', '') || ''
              addExpense(e, amt, note)
            }}>
              <i className="fas fa-plus" />
            </button>
            {canApprove && list.filter(x => x.status === 'pending').length > 0 && (
              <div style={{ marginTop: 4 }}>
                {list.filter(x => x.status === 'pending').map(p => (
                  <div key={p.id} style={{ fontSize: 10, display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                    <button className="btn-tiny success" onClick={() => approve(p.id)}>✓</button>
                    <button className="btn-tiny danger" onClick={() => reject(p.id)}>✕</button>
                  </div>
                ))}
              </div>
            )}
          </td>
        )
      })}
      <td className="total-col">
        {entries.reduce((s, e) => {
          const list = (expenses[e.id] || []).filter(x => x.expense_type === type)
          return s + list.filter(x => x.status === 'approved').reduce((a, x) => a + Number(x.amount || 0), 0)
        }, 0).toLocaleString()}
      </td>
    </tr>
  )
}

function CreditRow({ entry, list, customers, canEditAll, canApprove, currentUserId, onReload }) {
  const total = list.filter(x => x.status === 'approved').reduce((s, x) => s + Number(x.amount || 0), 0)

  async function add() {
    if (customers.length === 0) { alert('No customers registered'); return }
    const custId = prompt(
      'Enter customer ID:\n' + customers.map(c => `${c.id.slice(0,8)} — ${c.name}`).join('\n')
    )
    if (!custId) return
    const customer = customers.find(c => c.id.startsWith(custId))
    if (!customer) { alert('Customer not found'); return }
    const amt = prompt(`Amount for ${customer.name}?`, '0')
    if (!amt) return
    await supabase.from('balance_credits').insert({
      entry_id: entry.id,
      customer_id: customer.id,
      amount: Number(amt),
      status: canEditAll ? 'approved' : 'pending',
      approved_by: canEditAll ? currentUserId : null,
      approved_at: canEditAll ? new Date().toISOString() : null,
      created_by: currentUserId,
    })
    onReload()
  }

  async function approve(id) {
    await supabase.from('balance_credits').update({
      status: 'approved',
      approved_by: currentUserId,
      approved_at: new Date().toISOString(),
    }).eq('id', id)
    onReload()
  }

  return (
    <tr>
      <td className="sticky-col">
        {entry.users?.name}
        <button className="btn-tiny" onClick={add} style={{ marginLeft: 6 }}>
          <i className="fas fa-plus" />
        </button>
      </td>
      {['customers'].map(() => null)}
      {/* Actually we want to display credits inline per staff column */}
      <td colSpan={999} style={{ display: 'none' }}></td>
    </tr>
  )
}

function approveBalance(entryId, onReload) {
  supabase.rpc('approve_balance', { p_entry: entryId }).then(() => onReload())
}

function balanceClass(b) {
  const n = Number(b || 0)
  if (n > 0) return 'balance-short'
  if (n < 0) return 'balance-excess'
  return 'balance-zero'
}

/* ============================================================
   DOWNLOADS
   ============================================================ */
function downloadCSV(entries, expenses, credits, totals) {
  const header = ['Row', ...entries.map(e => e.users?.name || '—'), 'TOTAL'].join(',') + '\n'
  const row = (label, fn) => [label, ...entries.map(fn), ''].join(',') + '\n'

  let csv = header
  csv += row('Total Sales', e => Number(e.total_sales || 0))
  csv += row('Drops', e => Number(e.drops || 0))
  csv += row('Visa', e => Number(e.visa || 0))
  csv += row('Momo', e => Number(e.momo || 0))
  csv += row('Card Sales', e => Number(e.card_sales_manual || 0))
  csv += row('App User', e => Number(e.app_user || 0))

  DEFAULT_EXPENSES.forEach(type => {
    csv += row(type, e => {
      const list = (expenses[e.id] || []).filter(x => x.expense_type === type && x.status === 'approved')
      return list.reduce((s, x) => s + Number(x.amount || 0), 0)
    })
  })

  csv += row('Credits', e => {
    const list = (credits[e.id] || []).filter(x => x.status === 'approved')
    return list.reduce((s, x) => s + Number(x.amount || 0), 0)
  })

  csv += row('Cash in Hand', e => Number(e.cash_in_hand || 0))
  csv += row('Topup', e => Number(e.topup || 0))
  csv += row('Balance', e => Number(e.balance || 0))

  const blob = new Blob([csv], { type: 'text/csv' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `balance-sheet-${new Date().toISOString().slice(0,10)}.csv`
  a.click()
}

function downloadWord(entries, expenses, credits, totals, shift) {
  let html = `<html><head><meta charset="utf-8"></head><body>
    <h1>TEXOL LEGACY — Staff Balancing Sheet</h1>
    <h3>${shift.shift_date} · ${shift.shift_type.toUpperCase()}</h3>
    <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-family:Arial;font-size:12px;">
    <tr><th>Row</th>${entries.map(e => `<th>${e.users?.name || '—'}</th>`).join('')}<th>TOTAL</th></tr>`

  const row = (label, fn, tot) => `<tr><td><strong>${label}</strong></td>${entries.map(e => `<td>${fn(e).toLocaleString()}</td>`).join('')}<td><strong>${tot.toLocaleString()}</strong></td></tr>`

  html += row('Total Sales', e => Number(e.total_sales||0), totals.total_sales)
  html += row('Drops', e => Number(e.drops||0), totals.total_drops)
  html += row('Visa', e => Number(e.visa||0), totals.visa)
  html += row('Momo', e => Number(e.momo||0), totals.momo)
  html += row('Card Sales', e => Number(e.card_sales_manual||0), totals.card_sales)
  html += row('App User', e => Number(e.app_user||0), totals.app_user)

  DEFAULT_EXPENSES.forEach(type => {
    html += row(type, e => {
      const list = (expenses[e.id] || []).filter(x => x.expense_type === type && x.status === 'approved')
      return list.reduce((s, x) => s + Number(x.amount || 0), 0)
    }, 0)
  })

  html += row('Cash in Hand', e => Number(e.cash_in_hand||0), totals.cash_in_hand)
  html += row('Topup', e => Number(e.topup||0), 0)
  html += row('Balance', e => Number(e.balance||0), totals.balance)

  html += '</table></body></html>'

  const blob = new Blob([html], { type: 'application/msword' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `balance-sheet-${shift.shift_date}.doc`
  a.click()
}