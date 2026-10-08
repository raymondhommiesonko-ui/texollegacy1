import { useEffect, useMemo, useState } from 'react'
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
  const [pumps, setPumps] = useState([])
  const [entries, setEntries] = useState({})      // keyed by pump_number
  const [staff, setStaff] = useState([])
  const [customers, setCustomers] = useState([])
  const [expenses, setExpenses] = useState({})    // keyed by pump_number -> array
  const [credits, setCredits] = useState({})      // keyed by pump_number -> array
  const [customExpenseTypes, setCustomExpenseTypes] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const [openExpense, setOpenExpense] = useState(null)
  const [openCredit, setOpenCredit] = useState(null)
  const [openAssign, setOpenAssign] = useState(null)  // pump_number
  const [openAddPump, setOpenAddPump] = useState(false)
  const [newPumpNumber, setNewPumpNumber] = useState('')
  const [newPumpProduct, setNewPumpProduct] = useState('PMS')

  const [showAddExpenseType, setShowAddExpenseType] = useState(false)
  const [newExpenseName, setNewExpenseName] = useState('')
  const [focusPump, setFocusPump] = useState(null)   // for detail modal

  // Names map for the pump header
  const nameById = useMemo(() => {
    const m = {}
    staff.forEach(s => { m[s.id] = s.name })
    return m
  }, [staff])

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

      // 2) Load pumps for station
      const { data: pumpList } = await supabase
        .from('pumps')
        .select('*')
        .eq('station_id', user.station_id)
        .eq('is_active', true)
        .order('pump_number')
      setPumps(pumpList || [])

      // 3) Staff list (attendants + ambassadors + supervisor on shift)
      let staffQuery = supabase
        .from('users')
        .select('id, name, role, initials')
        .eq('station_id', user.station_id)
        .eq('is_active', true)
        .in('role', ['attendant','ambassador','supervisor'])
        .order('name')
      const { data: us } = await staffQuery
      setStaff(us || [])

      // 4) Customers
      const { data: cust } = await supabase
        .from('customers')
        .select('id, name, customer_type')
        .eq('station_id', user.station_id)
        .eq('is_active', true)
        .order('name')
      setCustomers(cust || [])

      if (!cur) { setLoading(false); return }

      // 5) Existing entries for this shift
      const { data: existing } = await supabase
        .from('balance_entries')
        .select('*')
        .eq('shift_id', cur.id)

      // Filter visible pumps if attendant
      let visibleEntries = existing || []
      if (!canEditAll) {
        visibleEntries = visibleEntries.filter(e => e.user_id === user.id)
      }

      const byPump = {}
      visibleEntries.forEach(e => {
        if (e.pump_number) byPump[e.pump_number] = e
      })
      setEntries(byPump)

      // 6) Load expenses + credits
      const ids = visibleEntries.map(e => e.id)
      const expMap = {}
      const crMap = {}
      const customTypes = new Set()

      if (ids.length > 0) {
        const { data: exp } = await supabase
          .from('balance_expenses')
          .select('*')
          .in('entry_id', ids)
        ;(exp || []).forEach(x => {
          const entry = visibleEntries.find(e => e.id === x.entry_id)
          if (entry) {
            const p = entry.pump_number
            if (!expMap[p]) expMap[p] = []
            expMap[p].push(x)
            if (x.expense_type) customTypes.add(x.expense_type)
          }
        })

        const { data: cr } = await supabase
          .from('balance_credits')
          .select('*')
          .in('entry_id', ids)
        ;(cr || []).forEach(x => {
          const entry = visibleEntries.find(e => e.id === x.entry_id)
          if (entry) {
            const p = entry.pump_number
            if (!crMap[p]) crMap[p] = []
            crMap[p].push(x)
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

  // ---------- Pump allocation ----------
  async function assignPump(pumpNumber, userId, product) {
    if (!shift) return
    setBusy(true)
    const { error } = await supabase.rpc('assign_pump', {
      p_shift: shift.id,
      p_pump: pumpNumber,
      p_user: userId || null,
      p_product: product || 'PMS',
    })
    setBusy(false)
    if (error) { alert(error.message); return }
    setOpenAssign(null)
    await loadAll()
  }

  // ---------- Add a new pump ----------
  async function addPump() {
    const num = parseInt(newPumpNumber, 10)
    if (!num || num < 1) return
    setBusy(true)
    const { error } = await supabase.from('pumps').insert({
      station_id: user.station_id,
      pump_number: num,
      product: newPumpProduct,
    })
    setBusy(false)
    if (error) { alert(error.message); return }
    setNewPumpNumber('')
    setOpenAddPump(false)
    await loadAll()
  }

  // ---------- Save a cell value ----------
  async function saveField(pumpNumber, field, value) {
    const entry = entries[pumpNumber]
    if (!entry) return
    await supabase
      .from('balance_entries')
      .update({ [field]: Number(value) || 0 })
      .eq('id', entry.id)
    await loadAll()
  }

  // ---------- Aggregations ----------
  function sumRow(field) {
    return Object.values(entries).reduce((s, e) => s + Number(e[field] || 0), 0)
  }
  function sumExpenseType(pumpNumber, type) {
    return (expenses[pumpNumber] || [])
      .filter(x => x.expense_type === type && x.status === 'approved')
      .reduce((s, x) => s + Number(x.amount || 0), 0)
  }
  function sumCredits(pumpNumber) {
    return (credits[pumpNumber] || [])
      .filter(x => x.status === 'approved')
      .reduce((s, x) => s + Number(x.amount || 0), 0)
  }

  // ---------- Approvals ----------
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

  // ---------- Submit / approve pump sheet ----------
  async function submitEntry(pumpNumber) {
    const entry = entries[pumpNumber]
    if (!entry) return
    setBusy(true)
    const { data, error } = await supabase.rpc('submit_balance_entry', { p_entry: entry.id })
    setBusy(false)
    if (error || !data?.ok) { alert(error?.message || data?.error || 'Failed'); return }
    await loadAll()
  }

  async function approveSubmission(pumpNumber) {
    const entry = entries[pumpNumber]
    if (!entry) return
    if (!confirm(`Approve submission for Pump ${pumpNumber}?`)) return
    setBusy(true)
    const { data, error } = await supabase.rpc('approve_submission', { p_entry: entry.id })
    setBusy(false)
    if (error || !data?.ok) { alert(error?.message || data?.error || 'Failed'); return }
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

  // Which pumps are visible to this user
  const visiblePumps = canEditAll
    ? pumps
    : pumps.filter(p => entries[p.pump_number]?.user_id === user.id)

  return (
    <div className="balancing-screen">
      <div className="balance-sheet-head">
        <div>
          <h3>TEXOL LEGACY — {shift.shift_date}</h3>
          <div className="sub">
            {shift.shift_type.toUpperCase()} SHIFT · {shift.status} · {visiblePumps.length} pump{visiblePumps.length !== 1 ? 's' : ''} visible
          </div>
        </div>
        <div className="balance-sheet-actions">
          {canApprove && (
            <>
              <button className="btn-ghost" onClick={() => exportCSV(visiblePumps, entries, expenses, credits, customExpenseTypes, shift, nameById)}>
                <i className="fas fa-file-csv" /> CSV
              </button>
              <button className="btn-primary" onClick={() => exportWord(visiblePumps, entries, expenses, credits, shift, customExpenseTypes, nameById)}>
                <i className="fas fa-file-word" /> Word
              </button>
            </>
          )}
          {canEditAll && (
            <button className="btn-ghost" onClick={() => setOpenAddPump(true)}>
              <i className="fas fa-plus" /> Add pump
            </button>
          )}
        </div>
      </div>

      <div style={{ overflowX: 'auto', padding: '0 32px 32px' }}>
        <table className="balance-sheet">
          <thead>
            {/* Row 1: NAMES + PUMP labels + TOTAL */}
            <tr>
              <th className="sticky-col">NAMES</th>
              {visiblePumps.map(p => (
                <th key={p.id} className="staff-head" style={{ cursor: 'pointer' }}
                    onClick={() => canEditAll && setOpenAssign(p.pump_number)}>
                  <div className="staff-name">PUMP {p.pump_number}</div>
                  <div style={{ fontSize: 9, color: '#8ba0b9', marginTop: 2, fontWeight: 500 }}>
                    {p.product}
                  </div>
                </th>
              ))}
              {canEditAll && <th className="total-col">TOTAL</th>}
            </tr>
            {/* Row 2: attendant name per pump */}
            <tr>
              <th className="sticky-col" style={{ fontSize: 10 }}>ATTENDANT</th>
              {visiblePumps.map(p => {
                const e = entries[p.pump_number]
                return (
                  <th key={p.id} className="staff-head" style={{ fontSize: 11, padding: '6px 8px' }}>
                    {e ? (
                      <>
                        <div style={{ color: '#92400e', fontWeight: 700 }}>
                          {nameById[e.user_id] || '—'}
                        </div>
                        {e.submission_status === 'submitted' && (
                          <span className="pill amber" style={{ fontSize: 8, marginTop: 4, display: 'inline-block' }}>
                            SUBMITTED
                          </span>
                        )}
                        {e.submission_status === 'approved' && (
                          <span className="pill green" style={{ fontSize: 8, marginTop: 4, display: 'inline-block' }}>
                            APPROVED
                          </span>
                        )}
                      </>
                    ) : (
                      <span style={{ color: '#8ba0b9', fontStyle: 'italic' }}>unassigned</span>
                    )}
                  </th>
                )
              })}
              {canEditAll && <th className="total-col"></th>}
            </tr>
          </thead>
          <tbody>

            {/* TOTAL SALES */}
            <SimpleEditRow
              label="TOTAL SALES"
              field="total_sales"
              pumps={visiblePumps}
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
              pumps={visiblePumps}
              entries={entries}
              field="drops"
              showTotal={canEditAll}
              total={sumRow('drops')}
            />

            {/* VISA */}
            <SimpleEditRow
              label="VISA"
              field="visa"
              pumps={visiblePumps}
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
              pumps={visiblePumps}
              entries={entries}
              field="momo"
              showTotal={canEditAll}
              total={sumRow('momo')}
            />

            {/* CARD SALES */}
            <SimpleEditRow
              label="CARD SALES"
              field="card_sales_manual"
              pumps={visiblePumps}
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
              pumps={visiblePumps}
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
              {visiblePumps.map(p => <td key={p.id}></td>)}
              {canEditAll && <td className="total-col"></td>}
            </tr>

            {customExpenseTypes.length === 0 && (
              <tr>
                <td className="sticky-col" style={{ color: '#8ba0b9', fontStyle: 'italic' }}>
                  No expense rows yet
                </td>
                {visiblePumps.map(p => <td key={p.id}></td>)}
                {canEditAll && <td className="total-col"></td>}
              </tr>
            )}

            {customExpenseTypes.map(type => (
              <tr key={type}>
                <td className="sticky-col">{type}</td>
                {visiblePumps.map(p => {
                  const list = (expenses[p.pump_number] || []).filter(x => x.expense_type === type)
                  const approvedTotal = list.filter(x => x.status === 'approved').reduce((a,x) => a + Number(x.amount||0), 0)
                  const pendingCount = list.filter(x => x.status === 'pending').length
                  const entry = entries[p.pump_number]
                  const canUserEdit = canEditAll || (entry && entry.user_id === user.id)

                  return (
                    <td key={p.id} className="expense-cell">
                      <div style={{ fontWeight: 700, textAlign: 'right' }}>{approvedTotal.toLocaleString()}</div>
                      {canUserEdit && entry && (
                        <button
                          className="btn-tiny"
                          onClick={() => setOpenExpense({ pumpNumber: p.pump_number, type })}
                          title="Add expense"
                        >
                          <i className="fas fa-plus" />
                        </button>
                      )}
                      {pendingCount > 0 && (
                        <div style={{ fontSize: 10, marginTop: 4, textAlign: 'right' }}>
                          <span className="pill amber" style={{ fontSize: 9 }}>{pendingCount} pending</span>
                          {canApprove && list.filter(x => x.status === 'pending').map(pn => (
                            <span key={pn.id} style={{ display: 'inline-flex', gap: 2, marginLeft: 4 }}>
                              <button className="btn-tiny success" onClick={() => approveExpense(pn.id)}>✓</button>
                              <button className="btn-tiny danger" onClick={() => rejectExpense(pn.id)}>✕</button>
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                  )
                })}
                {canEditAll && (
                  <td className="total-col">
                    {visiblePumps.reduce((s, p) => s + sumExpenseType(p.pump_number, type), 0).toLocaleString()}
                  </td>
                )}
              </tr>
            ))}

            {/* Add new expense type */}
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
                {visiblePumps.map(p => <td key={p.id}></td>)}
                {canEditAll && <td className="total-col"></td>}
              </tr>
            )}

            {/* CREDITS */}
            <tr className="section-head">
              <td className="sticky-col">CREDITS</td>
              {visiblePumps.map(p => <td key={p.id}></td>)}
              {canEditAll && <td className="total-col"></td>}
            </tr>

            <tr>
              <td className="sticky-col">
                Customer credit
                <span style={{ fontSize: 10, color: '#8ba0b9', display: 'block', marginTop: 2 }}>
                  Click + to add
                </span>
              </td>
              {visiblePumps.map(p => {
                const list = credits[p.pump_number] || []
                const approvedTotal = list.filter(x => x.status === 'approved').reduce((a,x) => a + Number(x.amount||0), 0)
                const pendingCount = list.filter(x => x.status === 'pending').length
                const entry = entries[p.pump_number]
                const canUserEdit = canEditAll || (entry && entry.user_id === user.id)

                return (
                  <td key={p.id} className="expense-cell">
                    <div style={{ fontWeight: 700, textAlign: 'right' }}>{approvedTotal.toLocaleString()}</div>
                    {canUserEdit && entry && (
                      <button
                        className="btn-tiny"
                        onClick={() => setOpenCredit({ pumpNumber: p.pump_number })}
                        title="Add customer credit"
                      >
                        <i className="fas fa-plus" />
                      </button>
                    )}
                    {pendingCount > 0 && (
                      <div style={{ fontSize: 10, marginTop: 4, textAlign: 'right' }}>
                        <span className="pill amber" style={{ fontSize: 9 }}>{pendingCount} pending</span>
                        {canApprove && list.filter(x => x.status === 'pending').map(pn => (
                          <span key={pn.id} style={{ display: 'inline-flex', gap: 2, marginLeft: 4 }}>
                            <button className="btn-tiny success" onClick={() => approveCredit(pn.id)}>✓</button>
                            <button className="btn-tiny danger" onClick={() => rejectCredit(pn.id)}>✕</button>
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                )
              })}
              {canEditAll && (
                <td className="total-col">
                  {visiblePumps.reduce((s, p) => s + sumCredits(p.pump_number), 0).toLocaleString()}
                </td>
              )}
            </tr>

            {/* CASH */}
            <SimpleEditRow
              label="CASH"
              field="cash_in_hand"
              pumps={visiblePumps}
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
              {visiblePumps.map(p => {
                const e = entries[p.pump_number]
                if (!e) return <td key={p.id}>—</td>
                const b = Number(e.balance || 0)
                const cls = b > 0 ? 'balance-short' : b < 0 ? 'balance-excess' : 'balance-zero'
                return (
                  <td key={p.id} className={cls}>
                    <div style={{ textAlign: 'right' }}>{b.toLocaleString()}</div>
                    {e.submission_status === 'draft' && isAttendant && e.user_id === user.id && (
                      <button className="btn-tiny success" onClick={() => submitEntry(p.pump_number)} disabled={busy}>
                        <i className="fas fa-paper-plane" /> Submit
                      </button>
                    )}
                    {e.submission_status === 'submitted' && canApprove && (
                      <>
                        <button className="btn-tiny success" onClick={() => approveSubmission(p.pump_number)} disabled={busy}>
                          <i className="fas fa-check" /> Approve
                        </button>
                      </>
                    )}
                    {e.submission_status === 'approved' && (
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
              pumps={visiblePumps}
              entries={entries}
              field="topup"
              showTotal={canEditAll}
              total={sumRow('topup')}
            />

          </tbody>
        </table>
      </div>

      {/* MODALS */}
      {openAssign !== null && (
        <AssignPumpModal
          profile={profile}
          pumpNumber={openAssign}
          currentEntry={entries[openAssign]}
          pumps={pumps}
          onClose={() => setOpenAssign(null)}
          onSave={assignPump}
        />
      )}

      {openAddPump && (
        <div className="modal-bg" onClick={e => { if (e.target === e.currentTarget) setOpenAddPump(false) }}>
          <div className="modal">
            <h3>Add a pump</h3>
            <div className="modal-sub">Beyond the existing 6</div>
            <label>Pump number</label>
            <input type="number" value={newPumpNumber} onChange={e => setNewPumpNumber(e.target.value)} autoFocus />
            <label>Product</label>
            <select value={newPumpProduct} onChange={e => setNewPumpProduct(e.target.value)}>
              <option value="PMS">PMS only</option>
              <option value="AGO">AGO only</option>
              <option value="BOTH">Both PMS and AGO</option>
            </select>
            <div className="modal-actions">
              <button className="btn-ghost-full" onClick={() => setOpenAddPump(false)}>Cancel</button>
              <button className="btn-primary-full" onClick={addPump} disabled={busy}>Add pump</button>
            </div>
          </div>
        </div>
      )}

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
function SimpleEditRow({ label, field, pumps, entries, canEdit, canEditOwn, currentUserId, onSave, total, showTotal, highlight }) {
  return (
    <tr className={highlight ? 'highlight-row' : ''}>
      <td className="sticky-col">{label}</td>
      {pumps.map(p => {
        const e = entries[p.pump_number]
        const userCanEdit = e && (canEdit || (canEditOwn && e.user_id === currentUserId))
        return (
          <td key={p.id}>
            <CellInput
              value={e?.[field] ?? 0}
              canEdit={userCanEdit}
              onSave={(v) => onSave(p.pump_number, field, v)}
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

  if (!canEdit) {
    return <span style={{ textAlign: 'right', display: 'block' }}>
      {Number(value || 0).toLocaleString()}
    </span>
  }

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

function ReadonlyRow({ label, pumps, entries, field, total, showTotal }) {
  return (
    <tr className="auto-row">
      <td className="sticky-col">{label}</td>
      {pumps.map(p => (
        <td key={p.id} style={{ textAlign: 'right' }}>
          {Number(entries[p.pump_number]?.[field] || 0).toLocaleString()}
        </td>
      ))}
      {showTotal && <td className="total-col">{total.toLocaleString()}</td>}
    </tr>
  )
}

/* ============================================================
   ASSIGN PUMP MODAL
   ============================================================ */
function AssignPumpModal({ profile, pumpNumber, currentEntry, pumps, onClose, onSave }) {
  const user = profile.user
  const [staffList, setStaffList] = useState([])
  const [selectedUserId, setSelectedUserId] = useState(currentEntry?.user_id || '')
  const [product, setProduct] = useState(currentEntry?.pump_product || 'PMS')
  const [busy, setBusy] = useState(false)

  const pump = pumps.find(p => p.pump_number === pumpNumber)

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('users')
        .select('id, name, role')
        .eq('station_id', user.station_id)
        .eq('is_active', true)
        .in('role', ['attendant','ambassador'])
        .order('name')
      setStaffList(data || [])
    }
    load()
  }, [user.station_id])

  async function save() {
    setBusy(true)
    await onSave(pumpNumber, selectedUserId || null, product)
    setBusy(false)
  }

  async function unassign() {
    if (!confirm('Remove the attendant from this pump?')) return
    setBusy(true)
    await onSave(pumpNumber, null, product)
    setBusy(false)
  }

  return (
    <div className="modal-bg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <h3>Pump {pumpNumber}</h3>
        <div className="modal-sub">
          {pump?.product === 'BOTH' ? 'Supports PMS and AGO' : pump?.product === 'PMS' ? 'PMS only' : 'AGO only'}
        </div>

        <label>Assign attendant</label>
        <select value={selectedUserId} onChange={e => setSelectedUserId(e.target.value)}>
          <option value="">— None —</option>
          {staffList.map(s => (
            <option key={s.id} value={s.id}>{s.name} ({s.role})</option>
          ))}
        </select>

        {pump?.product === 'BOTH' && (
          <>
            <label>Product this attendant is selling</label>
            <select value={product} onChange={e => setProduct(e.target.value)}>
              <option value="PMS">PMS</option>
              <option value="AGO">AGO</option>
              <option value="BOTH">Both</option>
            </select>
          </>
        )}

        <div className="modal-actions">
          <button className="btn-ghost-full" onClick={onClose}>Cancel</button>
          {currentEntry && (
            <button className="btn-ghost-full" onClick={unassign} style={{ color: '#dc2626' }}>
              Unassign
            </button>
          )}
          <button className="btn-primary-full" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ============================================================
   EXPENSE MODAL
   ============================================================ */
function ExpenseModal({ profile, pumpNumber, type, onClose, onSaved }) {
  const user = profile.user
  const isManager = ['admin','manager','supervisor'].includes(user.role)
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function save() {
    if (!amount || Number(amount) <= 0) { setErr('Enter amount'); return }
    setBusy(true); setErr('')

    const { data: entry } = await supabase
      .from('balance_entries')
      .select('id')
      .eq('pump_number', pumpNumber)
      .eq('station_id', user.station_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (!entry) { setErr('Entry not found'); setBusy(false); return }

    const { error } = await supabase.from('balance_expenses').insert({
      entry_id: entry.id,
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
          Pump {pumpNumber} · {isManager ? 'Auto-approved' : 'Sent to supervisor for approval'}
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

/* ============================================================
   CREDIT MODAL
   ============================================================ */
function CreditModal({ profile, pumpNumber, customers, onClose, onSaved }) {
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

    const { data: entry } = await supabase
      .from('balance_entries')
      .select('id')
      .eq('pump_number', pumpNumber)
      .eq('station_id', user.station_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (!entry) { setErr('Entry not found'); setBusy(false); return }

    const { error } = await supabase.from('balance_credits').insert({
      entry_id: entry.id,
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
          Pump {pumpNumber} · {isManager ? 'Auto-approved' : 'Sent to supervisor for approval'}
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
   EXPORTS
   ============================================================ */
function exportCSV(pumps, entries, expenses, credits, expenseTypes, shift, nameById) {
  const head = ['NAMES', ...pumps.map(p => `PUMP ${p.pump_number}`), 'TOTAL'].join(',') + '\n'
  const attendantHead = ['ATTENDANT', ...pumps.map(p => {
    const e = entries[p.pump_number]
    return e ? (nameById[e.user_id] || '—') : ''
  }), ''].join(',') + '\n'

  const rowOf = (label, fn) => {
    const vals = pumps.map(fn)
    const total = vals.reduce((s, v) => s + Number(v || 0), 0)
    return [label, ...vals, total].join(',') + '\n'
  }

  let csv = `TEXOL LEGACY — ${shift.shift_date} — ${shift.shift_type.toUpperCase()}\n`
  csv += `Generated: ${new Date().toLocaleString()}\n\n`
  csv += head
  csv += attendantHead
  csv += rowOf('TOTAL SALES', p => entries[p.pump_number]?.total_sales || 0)
  csv += rowOf('DROPS', p => entries[p.pump_number]?.drops || 0)
  csv += rowOf('VISA', p => entries[p.pump_number]?.visa || 0)
  csv += rowOf('MOMO / AIRTEL', p => entries[p.pump_number]?.momo || 0)
  csv += rowOf('CARD SALES', p => entries[p.pump_number]?.card_sales_manual || 0)
  csv += rowOf('APP USER', p => entries[p.pump_number]?.app_user || 0)
  csv += '\nEXPENSES\n'
  expenseTypes.forEach(type => {
    csv += rowOf(type, p => (expenses[p.pump_number] || [])
      .filter(x => x.expense_type === type && x.status === 'approved')
      .reduce((s, x) => s + Number(x.amount || 0), 0))
  })
  csv += '\nCREDITS\n'
  csv += rowOf('Customer credits', p => (credits[p.pump_number] || [])
    .filter(x => x.status === 'approved')
    .reduce((s, x) => s + Number(x.amount || 0), 0))
  csv += rowOf('CASH', p => entries[p.pump_number]?.cash_in_hand || 0)
  csv += rowOf('BALANCE', p => entries[p.pump_number]?.balance || 0)
  csv += rowOf('TOPUP', p => entries[p.pump_number]?.topup || 0)

  const blob = new Blob([csv], { type: 'text/csv' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `balance-${shift.shift_date}.csv`
  a.click()
}

function exportWord(pumps, entries, expenses, credits, shift, expenseTypes, nameById) {
  let html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
  <head><meta charset="utf-8"><title>Balance Sheet</title></head>
  <body>
  <h1>TEXOL LEGACY — ${shift.shift_date}</h1>
  <h3>${shift.shift_type.toUpperCase()} SHIFT</h3>
  <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-family:Arial;font-size:12px;">
  <tr style="background:#0b1a2e;color:#f0c94b;"><th>NAMES</th>${pumps.map(p=>`<th>PUMP ${p.pump_number}</th>`).join('')}<th>TOTAL</th></tr>
  <tr style="background:#fef3c7;color:#92400e;"><th>ATTENDANT</th>${pumps.map(p => {
    const e = entries[p.pump_number]
    return `<th>${e ? (nameById[e.user_id] || '—') : ''}</th>`
  }).join('')}<th></th></tr>`

  const rowOf = (label, fn) => {
    const vals = pumps.map(fn)
    const total = vals.reduce((s, v) => s + Number(v || 0), 0)
    return `<tr><td><strong>${label}</strong></td>${vals.map(v=>`<td align="right">${Number(v).toLocaleString()}</td>`).join('')}<td align="right"><strong>${total.toLocaleString()}</strong></td></tr>`
  }

  html += rowOf('TOTAL SALES', p => entries[p.pump_number]?.total_sales || 0)
  html += rowOf('DROPS', p => entries[p.pump_number]?.drops || 0)
  html += rowOf('VISA', p => entries[p.pump_number]?.visa || 0)
  html += rowOf('MOMO / AIRTEL', p => entries[p.pump_number]?.momo || 0)
  html += rowOf('CARD SALES', p => entries[p.pump_number]?.card_sales_manual || 0)
  html += rowOf('APP USER', p => entries[p.pump_number]?.app_user || 0)

  html += `<tr style="background:#0b1a2e;color:#f0c94b;"><td colspan="${pumps.length+2}"><strong>EXPENSES</strong></td></tr>`
  expenseTypes.forEach(type => {
    html += rowOf(type, p => (expenses[p.pump_number] || [])
      .filter(x => x.expense_type === type && x.status === 'approved')
      .reduce((s, x) => s + Number(x.amount || 0), 0))
  })

  html += `<tr style="background:#0b1a2e;color:#f0c94b;"><td colspan="${pumps.length+2}"><strong>CREDITS</strong></td></tr>`
  html += rowOf('Customer credits', p => (credits[p.pump_number] || [])
    .filter(x => x.status === 'approved')
    .reduce((s, x) => s + Number(x.amount || 0), 0))

  html += rowOf('CASH', p => entries[p.pump_number]?.cash_in_hand || 0)
  html += rowOf('BALANCE', p => entries[p.pump_number]?.balance || 0)
  html += rowOf('TOPUP', p => entries[p.pump_number]?.topup || 0)

  html += '</table></body></html>'

  const blob = new Blob([html], { type: 'application/msword' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `balance-${shift.shift_date}.doc`
  a.click()
}