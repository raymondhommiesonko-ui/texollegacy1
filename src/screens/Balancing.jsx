import { useEffect, useState } from 'react'
import { supabase } from '../supabase'

export default function Balancing({ profile }) {
  const user = profile.user
  const powers = profile.powers || {}
  const isManager = ['admin','manager'].includes(user.role)
  const isSupervisor = user.role === 'supervisor'
  const canEditAll = isManager || isSupervisor || powers.edit_balancing
  const canApprove = isManager || isSupervisor || powers.approve_balancing
  const isAttendant = user.role === 'attendant' || user.role === 'ambassador'

  const [shift, setShift] = useState(null)
  const [staff, setStaff] = useState([])
  const [entries, setEntries] = useState({})
  const [expenses, setExpenses] = useState({})
  const [credits, setCredits] = useState({})
  const [customers, setCustomers] = useState([])
  const [customExpenseTypes, setCustomExpenseTypes] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const [openExpense, setOpenExpense] = useState(null)
  const [openCredit, setOpenCredit] = useState(null)
  const [showAddExpenseType, setShowAddExpenseType] = useState(false)
  const [newExpenseName, setNewExpenseName] = useState('')

  async function loadAll() {
    setLoading(true)
    try {
      // 1) Open shift
      const { data: shifts } = await supabase
        .from('shifts')
        .select('*')
        .eq('station_id', user.station_id)
        .in('status', ['open','pending_close'])
        .order('opened_at', { ascending: false })
        .limit(1)
      const cur = shifts?.[0] || null
      setShift(cur)

      // 2) Staff (filtered by role)
      let staffQuery = supabase
        .from('users')
        .select('id, name, role, initials')
        .eq('station_id', user.station_id)
        .eq('is_active', true)
        .in('role', ['attendant','ambassador','supervisor'])
        .order('name')

      if (!canEditAll) {
        staffQuery = staffQuery.eq('id', user.id)
      }

      const { data: us } = await staffQuery
      setStaff(us || [])

      // 3) Customers for credit picker
      const { data: cust } = await supabase
        .from('customers')
        .select('id, name, customer_type')
        .eq('station_id', user.station_id)
        .eq('is_active', true)
        .order('name')
      setCustomers(cust || [])

      if (!cur) { setLoading(false); return }

      // 4) Auto-create balance_entries
      const { data: existing } = await supabase
        .from('balance_entries')
        .select('*')
        .eq('shift_id', cur.id)

      const byUser = {}
      ;(existing || []).forEach(e => { byUser[e.user_id] = e })

      const toCreate = (us || []).filter(s => !byUser[s.id])
      let reload = existing || []
      if (toCreate.length > 0) {
        const rows = toCreate.map(s => ({
          shift_id: cur.id,
          station_id: user.station_id,
          user_id: s.id,
        }))
        await supabase.from('balance_entries').insert(rows)
        const { data: fresh } = await supabase
          .from('balance_entries')
          .select('*')
          .eq('shift_id', cur.id)
        reload = fresh || []
      }

      const map = {}
      ;(reload || []).forEach(e => { map[e.user_id] = e })
      setEntries(map)

      // 5) Load expenses + credits
      const ids = (reload || []).map(e => e.id)
      const expMap = {}
      const crMap = {}
      const customTypes = new Set()

      if (ids.length > 0) {
        const { data: exp } = await supabase
          .from('balance_expenses')
          .select('*')
          .in('entry_id', ids)
        ;(exp || []).forEach(x => {
          const entry = (reload || []).find(e => e.id === x.entry_id)
          if (entry) {
            if (!expMap[entry.user_id]) expMap[entry.user_id] = []
            expMap[entry.user_id].push(x)
            if (x.expense_type) customTypes.add(x.expense_type)
          }
        })

        const { data: cr } = await supabase
          .from('balance_credits')
          .select('*')
          .in('entry_id', ids)
        ;(cr || []).forEach(x => {
          const entry = (reload || []).find(e => e.id === x.entry_id)
          if (entry) {
            if (!crMap[entry.user_id]) crMap[entry.user_id] = []
            crMap[entry.user_id].push(x)
          }
        })
      }
      setExpenses(expMap)
      setCredits(crMap)
      setCustomExpenseTypes(Array.from(customTypes).sort())
    } catch (e) {
      console.error('Load error:', e)
    }
    setLoading(false)
  }

  useEffect(() => { loadAll() }, [user.station_id])

  async function saveField(userId, field, value) {
    const entry = entries[userId]
    if (!entry) return
    await supabase
      .from('balance_entries')
      .update({ [field]: Number(value) || 0 })
      .eq('id', entry.id)
    await loadAll()
  }

  function sumRow(field) {
    return staff.reduce((s, u) => s + Number(entries[u.id]?.[field] || 0), 0)
  }
  function sumExpenseType(userId, type) {
    return (expenses[userId] || [])
      .filter(x => x.expense_type === type && x.status === 'approved')
      .reduce((s,x) => s + Number(x.amount||0), 0)
  }
  function sumRowCustom(fn) {
    return staff.reduce((s, u) => s + fn(u.id), 0)
  }
  function sumCredits(userId) {
    return (credits[userId] || [])
      .filter(x => x.status === 'approved')
      .reduce((s,x) => s + Number(x.amount||0), 0)
  }

  // Approval helpers
  async function approveExpense(id) {
    await supabase.from('balance_expenses').update({
      status: 'approved', approved_by: user.id, approved_at: new Date().toISOString(),
    }).eq('id', id)
    await loadAll()
  }
  async function rejectExpense(id) {
    await supabase.from('balance_expenses').update({
      status: 'rejected', approved_by: user.id, approved_at: new Date().toISOString(),
    }).eq('id', id)
    await loadAll()
  }
  async function approveCredit(id) {
    await supabase.from('balance_credits').update({
      status: 'approved', approved_by: user.id, approved_at: new Date().toISOString(),
    }).eq('id', id)
    await loadAll()
  }
  async function rejectCredit(id) {
    await supabase.from('balance_credits').update({
      status: 'rejected', approved_by: user.id, approved_at: new Date().toISOString(),
    }).eq('id', id)
    await loadAll()
  }
  async function approveBalanceEntry(userId) {
    const entry = entries[userId]
    if (!entry) return
    if (!confirm(`Approve balance for ${staff.find(s=>s.id===userId)?.name}?`)) return
    setBusy(true)
    await supabase.rpc('approve_balance', { p_entry: entry.id })
    setBusy(false)
    await loadAll()
  }

  async function addCustomExpenseType() {
    const name = newExpenseName.trim()
    if (!name) return
    if (!customExpenseTypes.includes(name)) {
      setCustomExpenseTypes([...customExpenseTypes, name].sort())
    }
    setNewExpenseName('')
    setShowAddExpenseType(false)
  }

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
      {/* HEADER */}
      <div className="balance-sheet-head">
        <div>
          <h3>TEXOL LEGACY — {shift.shift_date}</h3>
          <div className="sub">
            {shift.shift_type.toUpperCase()} SHIFT · {shift.status}
          </div>
        </div>
        <div className="balance-sheet-actions">
          {canApprove && (
            <>
              <button className="btn-ghost" onClick={() => exportCSV(staff, entries, expenses, credits, customExpenseTypes, shift)}>
                <i className="fas fa-file-csv" /> CSV
              </button>
              <button className="btn-primary" onClick={() => exportWord(staff, entries, expenses, credits, shift, customExpenseTypes)}>
                <i className="fas fa-file-word" /> Word
              </button>
            </>
          )}
        </div>
      </div>

      {/* TABLE */}
      <div style={{ overflowX: 'auto', padding: '0 32px 32px' }}>
        <table className="balance-sheet">
          <thead>
            <tr>
              <th className="sticky-col">NAMES</th>
              {staff.map(s => (
                <th key={s.id} className="staff-head">
                  <div className="staff-name">{s.name.toUpperCase()}</div>
                </th>
              ))}
              {canEditAll && <th className="total-col">TOTAL</th>}
            </tr>
          </thead>
          <tbody>

            {/* TOTAL SALES */}
            <SimpleEditRow
              label="TOTAL SALES"
              field="total_sales"
              staff={staff}
              entries={entries}
              canEdit={canEditAll}
              canEditOwn={false}
              currentUserId={user.id}
              onSave={saveField}
              showTotal={canEditAll}
              total={sumRow('total_sales')}
              highlight
            />

            {/* DROPS */}
            <ReadonlyRow
              label="DROPS"
              staff={staff}
              entries={entries}
              field="drops"
              showTotal={canEditAll}
              total={sumRow('drops')}
            />

            {/* VISA */}
            <SimpleEditRow
              label="VISA"
              field="visa"
              staff={staff}
              entries={entries}
              canEdit={canEditAll}
              canEditOwn={false}
              currentUserId={user.id}
              onSave={saveField}
              showTotal={canEditAll}
              total={sumRow('visa')}
            />

            {/* MOMO / AIRTEL */}
            <ReadonlyRow
              label="MOMO / AIRTEL"
              staff={staff}
              entries={entries}
              field="momo"
              showTotal={canEditAll}
              total={sumRow('momo')}
            />

            {/* CARD SALES */}
            <SimpleEditRow
              label="CARD SALES"
              field="card_sales_manual"
              staff={staff}
              entries={entries}
              canEdit={canEditAll}
              canEditOwn={false}
              currentUserId={user.id}
              onSave={saveField}
              showTotal={canEditAll}
              total={sumRow('card_sales_manual')}
            />

            {/* APP USER */}
            <SimpleEditRow
              label="APP USER"
              field="app_user"
              staff={staff}
              entries={entries}
              canEdit={canEditAll}
              canEditOwn={true}
              currentUserId={user.id}
              onSave={saveField}
              showTotal={canEditAll}
              total={sumRow('app_user')}
            />

            {/* EXPENSES SECTION */}
            <tr className="section-head">
              <td className="sticky-col">EXPENSES</td>
              {staff.map(s => <td key={s.id}></td>)}
              {canEditAll && <td className="total-col"></td>}
            </tr>

            {customExpenseTypes.length === 0 && (
              <tr>
                <td className="sticky-col" style={{ color: '#8ba0b9', fontStyle: 'italic' }}>
                  No expense rows yet
                </td>
                {staff.map(s => <td key={s.id}></td>)}
                {canEditAll && <td className="total-col"></td>}
              </tr>
            )}

            {customExpenseTypes.map(type => (
              <tr key={type}>
                <td className="sticky-col">{type}</td>
                {staff.map(s => {
                  const list = (expenses[s.id] || []).filter(x => x.expense_type === type)
                  const approvedTotal = list.filter(x => x.status === 'approved').reduce((a,x) => a + Number(x.amount||0), 0)
                  const pendingCount = list.filter(x => x.status === 'pending').length
                  const canUserEdit = canEditAll || s.id === user.id

                  return (
                    <td key={s.id} className="expense-cell">
                      <div style={{ fontWeight: 700, textAlign: 'right' }}>{approvedTotal.toLocaleString()}</div>
                      {canUserEdit && (
                        <button
                          className="btn-tiny"
                          onClick={() => setOpenExpense({ userId: s.id, type })}
                          title="Add expense"
                        >
                          <i className="fas fa-plus" />
                        </button>
                      )}
                      {pendingCount > 0 && (
                        <div style={{ fontSize: 10, marginTop: 4, textAlign: 'right' }}>
                          <span className="pill amber" style={{ fontSize: 9 }}>{pendingCount} pending</span>
                          {canApprove && list.filter(x => x.status === 'pending').map(p => (
                            <span key={p.id} style={{ display: 'inline-flex', gap: 2, marginLeft: 4 }}>
                              <button className="btn-tiny success" onClick={() => approveExpense(p.id)}>✓</button>
                              <button className="btn-tiny danger" onClick={() => rejectExpense(p.id)}>✕</button>
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                  )
                })}
                {canEditAll && (
                  <td className="total-col">
                    {sumRowCustom(id => sumExpenseType(id, type)).toLocaleString()}
                  </td>
                )}
              </tr>
            ))}

            {/* Add new expense type row */}
            {(canEditAll || isAttendant) && (
              <tr>
                <td className="sticky-col">
                  {!showAddExpenseType ? (
                    <button className="btn-ghost btn-sm" onClick={() => setShowAddExpenseType(true)}>
                      <i className="fas fa-plus" /> Add expense type
                    </button>
                  ) : (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input
                        autoFocus
                        placeholder="e.g. Lunch"
                        value={newExpenseName}
                        onChange={e => setNewExpenseName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') addCustomExpenseType() }}
                        style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 12, flex: 1 }}
                      />
                      <button className="btn-tiny success" onClick={addCustomExpenseType}>✓</button>
                      <button className="btn-tiny danger" onClick={() => { setShowAddExpenseType(false); setNewExpenseName('') }}>✕</button>
                    </div>
                  )}
                </td>
                {staff.map(s => <td key={s.id}></td>)}
                {canEditAll && <td className="total-col"></td>}
              </tr>
            )}

            {/* CREDITS SECTION */}
            <tr className="section-head">
              <td className="sticky-col">CREDITS</td>
              {staff.map(s => <td key={s.id}></td>)}
              {canEditAll && <td className="total-col"></td>}
            </tr>

            <tr>
              <td className="sticky-col">
                Customer credit
                <span style={{ fontSize: 10, color: '#8ba0b9', display: 'block', marginTop: 2 }}>
                  Click + to add
                </span>
              </td>
              {staff.map(s => {
                const list = credits[s.id] || []
                const approvedTotal = list.filter(x => x.status === 'approved').reduce((a,x) => a + Number(x.amount||0), 0)
                const pendingCount = list.filter(x => x.status === 'pending').length
                const canUserEdit = canEditAll || s.id === user.id

                return (
                  <td key={s.id} className="expense-cell">
                    <div style={{ fontWeight: 700, textAlign: 'right' }}>{approvedTotal.toLocaleString()}</div>
                    {canUserEdit && (
                      <button
                        className="btn-tiny"
                        onClick={() => setOpenCredit({ userId: s.id })}
                        title="Add customer credit"
                      >
                        <i className="fas fa-plus" />
                      </button>
                    )}
                    {pendingCount > 0 && (
                      <div style={{ fontSize: 10, marginTop: 4, textAlign: 'right' }}>
                        <span className="pill amber" style={{ fontSize: 9 }}>{pendingCount} pending</span>
                        {canApprove && list.filter(x => x.status === 'pending').map(p => (
                          <span key={p.id} style={{ display: 'inline-flex', gap: 2, marginLeft: 4 }}>
                            <button className="btn-tiny success" onClick={() => approveCredit(p.id)}>✓</button>
                            <button className="btn-tiny danger" onClick={() => rejectCredit(p.id)}>✕</button>
                          </span>
                        ))}
                      </div>
                    )}
                    {list.length > 0 && (
                      <div style={{ fontSize: 10, color: '#6b85a0', marginTop: 4, textAlign: 'right' }}>
                        {list.slice(0,2).map(x => (
                          <div key={x.id}>{x.customer_name || '—'}: {Number(x.amount).toLocaleString()}</div>
                        ))}
                        {list.length > 2 && <div>+{list.length - 2} more</div>}
                      </div>
                    )}
                  </td>
                )
              })}
              {canEditAll && (
                <td className="total-col">
                  {sumRowCustom(id => sumCredits(id)).toLocaleString()}
                </td>
              )}
            </tr>

            {/* CASH */}
            <SimpleEditRow
              label="CASH"
              field="cash_in_hand"
              staff={staff}
              entries={entries}
              canEdit={canEditAll}
              canEditOwn={true}
              currentUserId={user.id}
              onSave={saveField}
              showTotal={canEditAll}
              total={sumRow('cash_in_hand')}
              highlight
            />

            {/* BALANCE */}
            <tr className="balance-row">
              <td className="sticky-col">BALANCE</td>
              {staff.map(s => {
                const e = entries[s.id]
                if (!e) return <td key={s.id}>—</td>
                const b = Number(e.balance || 0)
                const cls = b > 0 ? 'balance-short' : b < 0 ? 'balance-excess' : 'balance-zero'
                return (
                  <td key={s.id} className={cls}>
                    <div style={{ textAlign: 'right' }}>{b.toLocaleString()}</div>
                    {e.balance_status === 'pending' && canApprove && (
                      <button className="btn-tiny success" onClick={() => approveBalanceEntry(s.id)} disabled={busy}>
                        <i className="fas fa-check" />
                      </button>
                    )}
                    {e.balance_status === 'approved' && (
                      <span className="pill green" style={{ fontSize: 10 }}>approved</span>
                    )}
                  </td>
                )
              })}
              {canEditAll && <td className="total-col">{sumRow('balance').toLocaleString()}</td>}
            </tr>

            {/* TOPUP */}
            <ReadonlyRow
              label="TOPUP"
              staff={staff}
              entries={entries}
              field="topup"
              showTotal={canEditAll}
              total={sumRow('topup')}
            />

          </tbody>
        </table>
      </div>

      {openExpense && (
        <ExpenseModal
          profile={profile}
          onClose={() => setOpenExpense(null)}
          onSaved={async () => { setOpenExpense(null); await loadAll() }}
          {...openExpense}
        />
      )}

      {openCredit && (
        <CreditModal
          profile={profile}
          customers={customers}
          onClose={() => setOpenCredit(null)}
          onSaved={async () => { setOpenCredit(null); await loadAll() }}
          {...openCredit}
        />
      )}
    </div>
  )
}

/* ============================================================
   ROW COMPONENTS
   ============================================================ */
function SimpleEditRow({ label, field, staff, entries, canEdit, canEditOwn, currentUserId, onSave, total, showTotal, highlight }) {
  return (
    <tr className={highlight ? 'highlight-row' : ''}>
      <td className="sticky-col">{label}</td>
      {staff.map(s => {
        const e = entries[s.id]
        const userCanEdit = canEdit || (canEditOwn && s.id === currentUserId)
        return (
          <td key={s.id}>
            <CellInput
              value={e?.[field] ?? 0}
              canEdit={userCanEdit}
              onSave={(v) => onSave(s.id, field, v)}
            />
          </td>
        )
      })}
      {showTotal && <td className="total-col">{total.toLocaleString()}</td>}
    </tr>
  )
}

function CellInput({ value, canEdit, onSave }) {
  const [v, setV] = useState(value)
  const [saved, setSaved] = useState(false)

  useEffect(() => { setV(value) }, [value])

  if (!canEdit) return <span style={{ textAlign: 'right', display: 'block' }}>{Number(value || 0).toLocaleString()}</span>

  return (
    <input
      type="number"
      value={v}
      onChange={e => setV(e.target.value)}
      onBlur={() => {
        if (Number(v) !== Number(value)) {
          onSave(v)
          setSaved(true)
          setTimeout(() => setSaved(false), 800)
        }
      }}
      onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
      style={{
        width: '100%', padding: '6px 8px',
        border: saved ? '2px solid #10b981' : '1px solid #e2e8f0',
        borderRadius: 6, fontFamily: 'inherit', fontSize: 13,
        fontWeight: 600, textAlign: 'right', outline: 'none',
      }}
    />
  )
}

function ReadonlyRow({ label, staff, entries, field, total, showTotal }) {
  return (
    <tr className="auto-row">
      <td className="sticky-col">{label}</td>
      {staff.map(s => (
        <td key={s.id} style={{ textAlign: 'right' }}>
          {Number(entries[s.id]?.[field] || 0).toLocaleString()}
        </td>
      ))}
      {showTotal && <td className="total-col">{total.toLocaleString()}</td>}
    </tr>
  )
}

/* ============================================================
   MODALS
   ============================================================ */
function ExpenseModal({ profile, userId, type, onClose, onSaved }) {
  const user = profile.user
  const isManager = ['admin','manager','supervisor'].includes(user.role)
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function save() {
    if (!amount || Number(amount) <= 0) { setErr('Enter amount'); return }
    setBusy(true); setErr('')

    const entryResp = await supabase
      .from('balance_entries')
      .select('id')
      .eq('user_id', userId)
      .eq('station_id', user.station_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (!entryResp.data) { setErr('Entry not found'); setBusy(false); return }

    const { error } = await supabase.from('balance_expenses').insert({
      entry_id: entryResp.data.id,
      expense_type: type,
      amount: Number(amount),
      note: note.trim() || null,
      status: isManager ? 'approved' : 'pending',
      approved_by: isManager ? user.id : null,
      approved_at: isManager ? new Date().toISOString() : null,
      created_by: user.id,
    })
    setBusy(false)
    if (error) { setErr(error.message); return }
    onSaved()
  }

  return (
    <div className="modal-bg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <h3>Add expense — {type}</h3>
        <div className="modal-sub">
          {isManager ? 'Auto-approved as supervisor' : 'Will be sent to supervisor for approval'}
        </div>

        <label>Amount (UGX)</label>
        <input type="number" value={amount} onChange={e => setAmount(e.target.value)} autoFocus />

        <label>Note (optional)</label>
        <input value={note} onChange={e => setNote(e.target.value)} />

        {err && <div className="auth-err">{err}</div>}

        <div className="modal-actions">
          <button className="btn-ghost-full" onClick={onClose}>Cancel</button>
          <button className="btn-primary-full" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Add expense'}
          </button>
        </div>
      </div>
    </div>
  )
}

function CreditModal({ profile, userId, customers, onClose, onSaved }) {
  const user = profile.user
  const isManager = ['admin','manager','supervisor'].includes(user.role)
  const [customerId, setCustomerId] = useState('')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function save() {
    if (!customerId) { setErr('Pick a customer'); return }
    if (!amount || Number(amount) <= 0) { setErr('Enter amount'); return }
    setBusy(true); setErr('')

    const entryResp = await supabase
      .from('balance_entries')
      .select('id')
      .eq('user_id', userId)
      .eq('station_id', user.station_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (!entryResp.data) { setErr('Entry not found'); setBusy(false); return }

    const customer = customers.find(c => c.id === customerId)

    const { error } = await supabase.from('balance_credits').insert({
      entry_id: entryResp.data.id,
      customer_id: customerId,
      amount: Number(amount),
      note: note.trim() || null,
      status: isManager ? 'approved' : 'pending',
      approved_by: isManager ? user.id : null,
      approved_at: isManager ? new Date().toISOString() : null,
      created_by: user.id,
    })
    setBusy(false)
    if (error) { setErr(error.message); return }
    onSaved()
  }

  return (
    <div className="modal-bg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <h3>Add customer credit</h3>
        <div className="modal-sub">
          {isManager ? 'Auto-approved as supervisor' : 'Will be sent to supervisor for approval'}
        </div>

        <label>Customer</label>
        <select value={customerId} onChange={e => setCustomerId(e.target.value)}>
          <option value="">— Pick a customer —</option>
          {customers.map(c => (
            <option key={c.id} value={c.id}>{c.name} ({c.customer_type})</option>
          ))}
        </select>

        <label>Amount (UGX)</label>
        <input type="number" value={amount} onChange={e => setAmount(e.target.value)} />

        <label>Note (optional)</label>
        <input value={note} onChange={e => setNote(e.target.value)} />

        {err && <div className="auth-err">{err}</div>}

        <div className="modal-actions">
          <button className="btn-ghost-full" onClick={onClose}>Cancel</button>
          <button className="btn-primary-full" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Add credit'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ============================================================
   DOWNLOADS
   ============================================================ */
function exportCSV(staff, entries, expenses, credits, expenseTypes, shift) {
  const header = ['NAMES', ...staff.map(s => s.name), 'TOTAL'].join(',') + '\n'
  const rowOf = (label, fn) => {
    const vals = staff.map(fn)
    const total = vals.reduce((s, v) => s + Number(v || 0), 0)
    return [label, ...vals, total].join(',') + '\n'
  }

  let csv = `TEXOL LEGACY — ${shift.shift_date} — ${shift.shift_type.toUpperCase()}\n`
  csv += `Generated: ${new Date().toLocaleString()}\n\n`
  csv += header
  csv += rowOf('TOTAL SALES', u => entries[u.id]?.total_sales || 0)
  csv += rowOf('DROPS', u => entries[u.id]?.drops || 0)
  csv += rowOf('VISA', u => entries[u.id]?.visa || 0)
  csv += rowOf('MOMO / AIRTEL', u => entries[u.id]?.momo || 0)
  csv += rowOf('CARD SALES', u => entries[u.id]?.card_sales_manual || 0)
  csv += rowOf('APP USER', u => entries[u.id]?.app_user || 0)
  csv += '\nEXPENSES\n'
  expenseTypes.forEach(type => {
    csv += rowOf(type, u => (expenses[u.id] || [])
      .filter(x => x.expense_type === type && x.status === 'approved')
      .reduce((s,x) => s + Number(x.amount||0), 0))
  })
  csv += '\nCREDITS\n'
  csv += rowOf('Customer credits', u => (credits[u.id] || [])
    .filter(x => x.status === 'approved')
    .reduce((s,x) => s + Number(x.amount||0), 0))
  csv += rowOf('CASH', u => entries[u.id]?.cash_in_hand || 0)
  csv += rowOf('BALANCE', u => entries[u.id]?.balance || 0)
  csv += rowOf('TOPUP', u => entries[u.id]?.topup || 0)

  const blob = new Blob([csv], { type: 'text/csv' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `balance-${shift.shift_date}.csv`
  a.click()
}

function exportWord(staff, entries, expenses, credits, shift, expenseTypes) {
  let html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
  <head><meta charset="utf-8"><title>Balance Sheet</title></head>
  <body>
  <h1>TEXOL LEGACY — ${shift.shift_date}</h1>
  <h3>${shift.shift_type.toUpperCase()} SHIFT</h3>
  <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-family:Arial;font-size:12px;">
  <tr style="background:#0b1a2e;color:#f0c94b;"><th>NAMES</th>${staff.map(s=>`<th>${s.name.toUpperCase()}</th>`).join('')}<th>TOTAL</th></tr>`

  const rowOf = (label, fn) => {
    const vals = staff.map(fn)
    const total = vals.reduce((s, v) => s + Number(v || 0), 0)
    return `<tr><td><strong>${label}</strong></td>${vals.map(v=>`<td align="right">${Number(v).toLocaleString()}</td>`).join('')}<td align="right"><strong>${total.toLocaleString()}</strong></td></tr>`
  }

  html += rowOf('TOTAL SALES', u => entries[u.id]?.total_sales || 0)
  html += rowOf('DROPS', u => entries[u.id]?.drops || 0)
  html += rowOf('VISA', u => entries[u.id]?.visa || 0)
  html += rowOf('MOMO / AIRTEL', u => entries[u.id]?.momo || 0)
  html += rowOf('CARD SALES', u => entries[u.id]?.card_sales_manual || 0)
  html += rowOf('APP USER', u => entries[u.id]?.app_user || 0)

  html += `<tr style="background:#0b1a2e;color:#f0c94b;"><td colspan="${staff.length+2}"><strong>EXPENSES</strong></td></tr>`
  expenseTypes.forEach(type => {
    html += rowOf(type, u => (expenses[u.id] || [])
      .filter(x => x.expense_type === type && x.status === 'approved')
      .reduce((s,x) => s + Number(x.amount||0), 0))
  })

  html += `<tr style="background:#0b1a2e;color:#f0c94b;"><td colspan="${staff.length+2}"><strong>CREDITS</strong></td></tr>`
  html += rowOf('Customer credits', u => (credits[u.id] || [])
    .filter(x => x.status === 'approved')
    .reduce((s,x) => s + Number(x.amount||0), 0))

  html += rowOf('CASH', u => entries[u.id]?.cash_in_hand || 0)
  html += rowOf('BALANCE', u => entries[u.id]?.balance || 0)
  html += rowOf('TOPUP', u => entries[u.id]?.topup || 0)

  html += '</table></body></html>'

  const blob = new Blob([html], { type: 'application/msword' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `balance-${shift.shift_date}.doc`
  a.click()
}