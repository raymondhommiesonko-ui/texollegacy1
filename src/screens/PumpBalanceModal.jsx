import { useEffect, useMemo, useState, memo } from 'react'
import { supabase } from '../supabase'

const C = {
  card: '#ffffff',
  border: '#e2e8f0',
  text: '#1e293b',
  muted: '#64748b',
  soft: '#eef2f7',
  accent: '#3b82f6',
  accentSoft: '#e0e7ff',
  danger: '#dc2626',
  dangerBg: '#fee2e2',
  warn: '#92400e',
  warnBg: '#fef3c7',
  success: '#16a34a',
  successBg: '#dcfce7',
}

// 1. Isolated Input Component to prevent focus loss and typing glitches
const NumberInput = memo(({ label, value, onChange, disabled, isLive, liveValue }) => {
  return (
    <div>
      <label style={{ fontSize: 11, color: C.muted }}>
        {label}{isLive && liveValue != null ? ` (live: ${Number(liveValue).toLocaleString()})` : ''}
      </label>
      {disabled ? (
        <div style={{
          padding: '8px 10px', background: C.soft, borderRadius: 6,
          fontSize: 13, fontWeight: 600, color: C.text,
          border: `1px solid ${C.border}`,
        }}>
          {Number(value || 0).toLocaleString()}
        </div>
      ) : (
        <input 
          type="text" 
          inputMode="numeric"
          value={value}
          onChange={e => onChange(e.target.value)}
          style={{
            width: '100%', padding: '8px 10px', borderRadius: 6,
            border: `1px solid ${C.border}`, background: C.card,
            color: C.text, fontSize: 13,
          }} 
        />
      )}
    </div>
  )
})

export default function PumpBalanceModal({
  profile,
  pump,
  entry,
  liveData,
  globalPrices,
  canEditFinances,
  canApproveExpenses,
  canAddExpenses,
  isAdmin,
  locked,
  onClose,
  onSaved,
  onExpensesChanged,
}) {
  const user = profile.user
  const pumpNumber = Number(pump?.pump_number)

  const editFinances = !locked && (canEditFinances ?? false)
  const approveExpenses = !locked && (canApproveExpenses ?? false)
  const addExpenses = !locked && (canAddExpenses ?? false)
  
  const editOpenMeters = editFinances && isAdmin 

  const [form, setForm] = useState({
    pms_open: '0', pms_close: '0', ago_open: '0', ago_close: '0',
    cash: '0', visa: '0', sales_difference: '0', drops: '0', momo: '0', app_users: '0',
  })

  const [expenses, setExpenses] = useState([])
  const [newExpense, setNewExpense] = useState({ type: 'LUNCH', amount: '', note: '' })
  const customExpenseTypes = ['LUNCH', 'OFFLOADING MILK', 'STA CAFE','KAMED SECURITY','GREAT AMBASSADOR SCHOOL','INSIGHT SECURITY', 'GENERATOR FUEL', 'KPI', 'RTT', 'DIVINE Cottages', 'KIBULI MUSLIM HOSPITAL','KIBULI NURSING SCHOOL']
  const [saving, setSaving] = useState(false)
  const [busyExpenseId, setBusyExpenseId] = useState(null)

  useEffect(() => {
    if (entry) {
      setForm({
        pms_open: String(entry.pms_open || 0),
        pms_close: String(entry.pms_close || 0),
        ago_open: String(entry.ago_open || 0),
        ago_close: String(entry.ago_close || 0),
        cash: String(entry.cash || 0),
        visa: String(entry.visa || 0),
        sales_difference: String(entry.sales_difference || 0),
        drops: String(entry.drops || liveData?.drops || 0),
        momo: String(entry.momo || liveData?.momo || 0),
        app_users: String(entry.app_users || liveData?.app || 0),
      })
      loadExpenses(entry.id)
    }
  }, [entry?.id])

  async function loadExpenses(entryId) {
    const { data } = await supabase
      .from('balance_expenses')
      .select('*')
      .eq('entry_id', entryId)
      .order('created_at', { ascending: false })
    setExpenses(data || [])
    onExpensesChanged?.(pumpNumber, data || [])
  }

  const handleChange = (field, value) => {
    if (field === 'pms_open' || field === 'ago_open') {
      if (!editOpenMeters) return
    } else {
      if (!editFinances) return
    }
    setForm(prev => ({ ...prev, [field]: value }))
  }

  const digitCount = v => String(v ?? '').replace(/[^0-9]/g, '').length
  const closeMeterInvalid =
    editFinances && (digitCount(form.pms_close) < 2 || digitCount(form.ago_close) < 2)

  // Memoized calculations to prevent unnecessary recalculation on re-render
  const calc = useMemo(() => {
    const pmsL = Math.max(0, Number(form.pms_close || 0) - Number(form.pms_open || 0))
    const agoL = Math.max(0, Number(form.ago_close || 0) - Number(form.ago_open || 0))

    const pmsSales = pmsL * Number(globalPrices?.PMS || globalPrices?.pms || 0)
    const agoSales = agoL * Number(globalPrices?.AGO || globalPrices?.ago || 0)
    const totalSales = pmsSales + agoSales

    const totalApprovedExpenses = expenses
      .filter(e => e.status === 'approved')
      .reduce((sum, e) => sum + Number(e.amount), 0)

    const deductions =
      totalApprovedExpenses +
      Number(form.drops || 0) + Number(form.momo || 0) + Number(form.sales_difference || 0) +
      Number(form.app_users || 0) + Number(form.cash || 0) + Number(form.visa || 0)

    const netBalance = totalSales - deductions

    let status = 'BALANCED'
    if (netBalance > 300) status = 'SHORTAGE'
    else if (netBalance < -300) status = 'EXCESS'

    return { pmsL, agoL, pmsSales, agoSales, totalSales, deductions, netBalance, status }
  }, [form, expenses, globalPrices])

  async function saveBalance() {
    if (!entry?.id || !editFinances) return
    if (closeMeterInvalid) {
      alert('Close meters must be at least 2 digits.')
      return
    }
    setSaving(true)
    try {
      const { error } = await supabase.from('balance_entries').update({
        pms_open: Number(form.pms_open || 0),
        pms_close: Number(form.pms_close || 0),
        ago_open: Number(form.ago_open || 0),
        ago_close: Number(form.ago_close || 0),
        cash: Number(form.cash || 0),
        visa: Number(form.visa || 0),
        sales_difference: Number(form.sales_difference || 0),
        drops: Number(form.drops || 0),
        momo: Number(form.momo || 0),
        app_users: Number(form.app_users || 0),
      }).eq('id', entry.id)

      if (error) throw error
      onSaved?.()
      onClose?.()
    } catch (err) {
      alert(err.message)
    }
    setSaving(false)
  }

  async function addExpense() {
    if (!entry?.id || !addExpenses) return
    if (!newExpense.amount) return alert('Enter amount')
    setSaving(true)
    try {
      const { error } = await supabase.from('balance_expenses').insert({
        entry_id: entry.id,
        expense_type: newExpense.type,
        amount: Number(newExpense.amount),
        note: newExpense.note,
        status: editFinances ? 'approved' : 'pending',
        approved_by: editFinances ? user.id : null,
        approved_at: editFinances ? new Date().toISOString() : null,
      })
      if (error) throw error
      setNewExpense({ type: newExpense.type, amount: '', note: '' })
      await loadExpenses(entry.id)
    } catch (err) {
      alert(err.message)
    }
    setSaving(false)
  }

  async function setExpenseStatus(id, status) {
    if (!approveExpenses) return
    setBusyExpenseId(id)
    try {
      const { error } = await supabase
        .from('balance_expenses')
        .update({
          status,
          approved_by: user.id,
          approved_at: new Date().toISOString(),
        })
        .eq('id', id)
      if (error) throw error
      await loadExpenses(entry.id)
    } catch (err) {
      alert(err.message)
    }
    setBusyExpenseId(null)
  }

  async function deleteExpense(id) {
    if (!window.confirm('Delete this expense?')) return
    setBusyExpenseId(id)
    try {
      const { error } = await supabase
        .from('balance_expenses')
        .delete()
        .eq('id', id)
      if (error) throw error
      await loadExpenses(entry.id)
    } catch (err) {
      alert(err.message)
    }
    setBusyExpenseId(null)
  }

  const financesLocked = !editFinances

  return (
    <div className="modal-bg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{
        maxWidth: 640, width: '92%', maxHeight: '92vh', overflowY: 'auto',
        background: C.card, color: C.text, borderRadius: 12,
        border: `1px solid ${C.border}`, padding: 20,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between',
          alignItems: 'center', marginBottom: 16 }}>
          <div>
            <h3 style={{ margin: 0, color: C.text, fontSize: 18 }}>
              Pump {pump?.pump_number} — {pump?.product}
            </h3>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
              Attendant: {entry?.user_id ? 'Assigned' : 'Unassigned'}
            </div>
          </div>
          <button className="btn-ghost" onClick={onClose}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer',
              color: C.muted, fontSize: 18 }}>
            <i className="fas fa-times" />
          </button>
        </div>

        {locked && (
          <div style={{
            fontSize: 12, color: C.warn, background: C.warnBg,
            padding: '8px 12px', borderRadius: 6, marginBottom: 14,
          }}>
            <i className="fas fa-lock" style={{ marginRight: 6 }} />
            This shift is closed — the sheet is read-only.
          </div>
        )}

        {!entry ? (
          <div style={{ textAlign: 'center', padding: 20, color: C.muted }}>
            Please assign an attendant to this pump first.
          </div>
        ) : (
          <>
            {!locked && financesLocked && (
              <div style={{
                fontSize: 12, color: C.warn, background: C.warnBg,
                padding: '8px 12px', borderRadius: 6, marginBottom: 14,
              }}>
                Meter and payment figures are read-only. You can add expenses — they will be
                pending until a supervisor or manager approves them.
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr',
              gap: 14, marginBottom: 16 }}>
              <div style={{ background: C.soft, padding: 12, borderRadius: 8,
                border: `1px solid ${C.border}` }}>
                <h4 style={{ margin: '0 0 10px', fontSize: 12, color: C.muted,
                  textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  PMS (Price: {Number(globalPrices?.PMS || globalPrices?.pms || 0).toLocaleString()})
                </h4>
                <NumberInput
                  label={`Open Meter ${isAdmin ? '' : '(auto)'}`}
                  value={form.pms_open}
                  onChange={val => handleChange('pms_open', val)}
                  disabled={!editOpenMeters}
                />
                <div style={{ height: 8 }} />
                <NumberInput
                  label="Close Meter"
                  value={form.pms_close}
                  onChange={val => handleChange('pms_close', val)}
                  disabled={financesLocked}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between',
                  fontSize: 12, marginTop: 8, color: C.text }}>
                  <span>Liters: <b>{calc.pmsL.toLocaleString()}</b></span>
                  <span>Sales: <b>{calc.pmsSales.toLocaleString()}</b></span>
                </div>
              </div>

              <div style={{ background: C.soft, padding: 12, borderRadius: 8,
                border: `1px solid ${C.border}` }}>
                <h4 style={{ margin: '0 0 10px', fontSize: 12, color: C.muted,
                  textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  AGO (Price: {Number(globalPrices?.AGO || globalPrices?.ago || 0).toLocaleString()})
                </h4>
                <NumberInput
                  label={`Open Meter ${isAdmin ? '' : '(auto)'}`}
                  value={form.ago_open}
                  onChange={val => handleChange('ago_open', val)}
                  disabled={!editOpenMeters}
                />
                <div style={{ height: 8 }} />
                <NumberInput
                  label="Close Meter"
                  value={form.ago_close}
                  onChange={val => handleChange('ago_close', val)}
                  disabled={financesLocked}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between',
                  fontSize: 12, marginTop: 8, color: C.text }}>
                  <span>Liters: <b>{calc.agoL.toLocaleString()}</b></span>
                  <span>Sales: <b>{calc.agoSales.toLocaleString()}</b></span>
                </div>
              </div>
            </div>

            {closeMeterInvalid && (
              <div style={{
                fontSize: 12, color: '#7f1d1d', background: C.dangerBg,
                padding: '8px 12px', borderRadius: 6, marginBottom: 12,
              }}>
                Close meters must have at least <b>2 digits</b>. Enter the full meter reading before saving.
              </div>
            )}

            <div style={{ background: C.accentSoft, padding: 12, borderRadius: 8,
              display: 'flex', justifyContent: 'space-between', marginBottom: 16,
              fontWeight: 800, color: C.text, fontSize: 14 }}>
              <span>TOTAL SALES</span>
              <span>{calc.totalSales.toLocaleString()}</span>
            </div>

            <h4 style={{ fontSize: 12, color: C.muted, marginBottom: 10,
              textTransform: 'uppercase', letterSpacing: 0.5 }}>Deductions & Payments</h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
              gap: 12, marginBottom: 16 }}>
              <NumberInput
                label="Drops"
                value={form.drops}
                onChange={val => handleChange('drops', val)}
                disabled={financesLocked}
                isLive
                liveValue={liveData?.drops}
              />
              <NumberInput
                label="MOMO/Airtel"
                value={form.momo}
                onChange={val => handleChange('momo', val)}
                disabled={financesLocked}
                isLive
                liveValue={liveData?.momo}
              />
              <NumberInput
                label="App Users"
                value={form.app_users}
                onChange={val => handleChange('app_users', val)}
                disabled={financesLocked}
                isLive
                liveValue={liveData?.app}
              />
              <NumberInput
                label="Sales Diff"
                value={form.sales_difference}
                onChange={val => handleChange('sales_difference', val)}
                disabled={financesLocked}
              />
              <NumberInput
                label="Visa"
                value={form.visa}
                onChange={val => handleChange('visa', val)}
                disabled={financesLocked}
              />
              <NumberInput
                label="Cash"
                value={form.cash}
                onChange={val => handleChange('cash', val)}
                disabled={financesLocked}
              />
            </div>

            {editFinances && (
              <button onClick={saveBalance} disabled={saving || closeMeterInvalid}
                style={{
                  width: '100%', padding: '10px 14px', marginBottom: 16,
                  background: closeMeterInvalid ? '#cbd5e1' : C.accent,
                  color: '#fff', border: 'none', borderRadius: 6,
                  fontSize: 13, fontWeight: 700,
                  cursor: closeMeterInvalid ? 'not-allowed' : 'pointer',
                }}>
                {saving ? 'Saving...' : 'Save Meter & Deductions'}
              </button>
            )}

            <h4 style={{ fontSize: 12, color: C.muted, marginBottom: 10,
              textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Expenses {financesLocked && !locked ? '(pending requires supervisor approval)' : ''}
            </h4>
            <div style={{ marginBottom: 12 }}>
              {expenses.map(ex => {
                const isPending = ex.status === 'pending'
                const busy = busyExpenseId === ex.id
                const canDelete = !locked && (editFinances || (isPending && ex.created_by === user.id))
                const badgeBg = ex.status === 'approved' ? C.successBg
                  : ex.status === 'rejected' ? C.dangerBg : C.warnBg
                const badgeColor = ex.status === 'approved' ? '#166534'
                  : ex.status === 'rejected' ? '#991b1b' : C.warn
                return (
                  <div key={ex.id} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '8px 0', borderBottom: `1px solid ${C.border}`,
                  }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13, color: C.text }}>
                        {ex.expense_type} — {Number(ex.amount).toLocaleString()}
                      </div>
                      {ex.note && (
                        <div style={{ fontSize: 11, color: C.muted }}>{ex.note}</div>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{
                        fontSize: 10, padding: '2px 8px', borderRadius: 4,
                        background: badgeBg, color: badgeColor, fontWeight: 700,
                      }}>
                        {ex.status.toUpperCase()}
                      </span>
                      {isPending && approveExpenses && !locked && (
                        <>
                          <button disabled={busy}
                            onClick={() => setExpenseStatus(ex.id, 'approved')}
                            style={{ padding: '3px 8px', background: C.success,
                              color: '#fff', border: 'none', borderRadius: 4,
                              fontSize: 12, cursor: 'pointer' }}>
                            ✓
                          </button>
                          <button disabled={busy}
                            onClick={() => setExpenseStatus(ex.id, 'rejected')}
                            style={{ padding: '3px 8px', background: C.danger,
                              color: '#fff', border: 'none', borderRadius: 4,
                              fontSize: 12, cursor: 'pointer' }}>
                            ✕
                          </button>
                        </>
                      )}
                      {canDelete && (
                        <button disabled={busy}
                          onClick={() => deleteExpense(ex.id)}
                          style={{ padding: '3px 8px', background: C.soft,
                            color: C.muted, border: 'none', borderRadius: 4,
                            fontSize: 11, cursor: 'pointer' }}>
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
              {expenses.length === 0 && (
                <div style={{ fontSize: 12, color: C.muted }}>No expenses recorded.</div>
              )}
            </div>

            {addExpenses && (
              <div style={{ background: C.soft, padding: 12, borderRadius: 8,
                marginBottom: 16, border: `1px solid ${C.border}` }}>
                <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <select value={newExpense.type}
                    onChange={e => setNewExpense({ ...newExpense, type: e.target.value })}
                    style={{ flex: 1, padding: '8px 10px', borderRadius: 6,
                      border: `1px solid ${C.border}`, background: C.card,
                      color: C.text, fontSize: 13 }}>
                    {customExpenseTypes.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  
                  <input 
                    type="text" 
                    inputMode="numeric"
                    placeholder="Amount"
                    value={newExpense.amount}
                    onChange={e => setNewExpense({ ...newExpense, amount: e.target.value })}
                    style={{ width: 110, padding: '8px 10px', borderRadius: 6,
                      border: `1px solid ${C.border}`, background: C.card,
                      color: C.text, fontSize: 13 }} 
                  />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input placeholder="Note (optional)"
                    value={newExpense.note}
                    onChange={e => setNewExpense({ ...newExpense, note: e.target.value })}
                    style={{ flex: 1, padding: '8px 10px', borderRadius: 6,
                      border: `1px solid ${C.border}`, background: C.card,
                      color: C.text, fontSize: 13 }} />
                  <button onClick={addExpense} disabled={saving}
                    style={{ padding: '8px 14px', background: C.accent,
                      color: '#fff', border: 'none', borderRadius: 6,
                      fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                    {editFinances ? 'Add (auto-approve)' : 'Add (pending)'}
                  </button>
                </div>
              </div>
            )}

            <div style={{
              padding: 14, borderRadius: 8,
              background: calc.status === 'SHORTAGE' ? C.dangerBg
                : calc.status === 'EXCESS' ? C.successBg : C.soft,
              border: `1px solid ${calc.status === 'SHORTAGE' ? '#fca5a5'
                : calc.status === 'EXCESS' ? '#86efac' : C.border}`,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between',
                marginBottom: 6, color: C.text }}>
                <span>Total Sales</span><span>{calc.totalSales.toLocaleString()}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between',
                marginBottom: 6, color: C.danger }}>
                <span>Total Deductions</span><span>-{calc.deductions.toLocaleString()}</span>
              </div>
              <div style={{ height: 1, background: C.border, margin: '10px 0' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 800, color: C.text }}>NET BALANCE</span>
                <span style={{
                  fontSize: 20, fontWeight: 900,
                  color: calc.status === 'SHORTAGE' ? C.danger
                    : calc.status === 'EXCESS' ? C.success : C.text,
                }}>
                  {calc.netBalance.toLocaleString()}
                </span>
              </div>
              <div style={{
                textAlign: 'right', fontSize: 12, fontWeight: 700,
                color: calc.status === 'SHORTAGE' ? C.danger
                  : calc.status === 'EXCESS' ? C.success : C.text,
              }}>
                {calc.status}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}