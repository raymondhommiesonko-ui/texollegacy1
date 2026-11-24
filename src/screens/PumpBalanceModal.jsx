import { useEffect, useMemo, useState, memo } from 'react'
import { supabase } from '../supabase'

const C = {
  card: '#ffffff', border: '#e2e8f0', text: '#1e293b', muted: '#64748b',
  soft: '#eef2f7', accent: '#3b82f6', accentSoft: '#e0e7ff', danger: '#dc2626',
  dangerBg: '#fee2e2', warn: '#92400e', warnBg: '#fef3c7', success: '#16a34a', successBg: '#dcfce7',
}

const NumberInput = memo(({ label, value, onChange, disabled, isLive, liveValue, action }) => {
  return (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <label style={{ fontSize: 11, color: C.muted, marginBottom: 4, display: 'block' }}>
          {label}{isLive && liveValue != null ? ` (live: ${Number(liveValue).toLocaleString()})` : ''}
        </label>
        {action && <div>{action}</div>}
      </div>
      {disabled ? (
        <div style={{ padding: '8px 10px', background: C.soft, borderRadius: 6, fontSize: 13, fontWeight: 600, color: C.text, border: `1px solid ${C.border}` }}>
          {Number(value || 0).toLocaleString()}
        </div>
      ) : (
        <input type="text" inputMode="numeric" value={value} onChange={e => onChange(e.target.value)} style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: `1px solid ${C.border}`, background: C.card, color: C.text, fontSize: 13 }} />
      )}
    </div>
  )
})

export default function PumpBalanceModal({
  profile, pump, entry, liveData, globalPrices, canEditFinances, canApproveExpenses, canAddExpenses, isAdmin, locked, onClose, onSaved, onExpensesChanged,
}) {
  const user = profile.user
  const pumpNumber = Number(pump?.pump_number)
  const isPmsOnly = [5, 6].includes(pumpNumber)

  const isActuallyLocked = locked && !isAdmin
  const editFinances = !isActuallyLocked && (canEditFinances ?? false)
  const approveExpenses = !isActuallyLocked && (canApproveExpenses ?? false)
  const addExpenses = !isActuallyLocked && (canAddExpenses ?? false)
  const editOpenMeters = editFinances && isAdmin

  const [form, setForm] = useState({
    pms_open: '0', pms_close: '0', ago_open: '0', ago_close: '0',
    cash: '0', visa: '0', sales_difference: '0', drops: '0', momo: '0', app_users: '0',
  })

  const [cashApproval, setCashApproval] = useState({
    approved_amount: '', status: 'pending'
  })

  const [expenses, setExpenses] = useState([])
  const [adjustments, setAdjustments] = useState([])
  const [newExpense, setNewExpense] = useState({ type: '', amount: '', note: '' })

  // Inline edit state for expenses (attendants editing own pending / managers editing any)
  const [editingExpenseId, setEditingExpenseId] = useState(null)
  const [editExpenseForm, setEditExpenseForm] = useState({ type: '', amount: '', note: '' })

  const [adjustModal, setAdjustModal] = useState(null)
  const [adjustForm, setAdjustForm] = useState({ amount: '', reason: '' })

  const [cashInput, setCashInput] = useState('')
  const [cashReason, setCashReason] = useState('')

  const customExpenseTypes = ['LUNCH', 'OFFLOADING MILK', 'STA CAFE','KAMED SECURITY','GREAT AMBASSADOR SCHOOL','INSIGHT SECURITY', 'GENERATOR FUEL', 'KPI', 'RTT', 'DIVINE Cottages', 'KIBULI MUSLIM HOSPITAL','KIBULI NURSING SCHOOL']
  const [saving, setSaving] = useState(false)
  const [busyExpenseId, setBusyExpenseId] = useState(null)

  useEffect(() => {
    if (entry) {
      setForm({
        pms_open: String(entry.pms_open || 0), pms_close: String(entry.pms_close || 0),
        ago_open: String(entry.ago_open || 0), ago_close: String(entry.ago_close || 0),
        cash: String(entry.cash || 0), visa: String(entry.visa || 0),
        sales_difference: String(entry.sales_difference || 0),
        drops: String(entry.drops || liveData?.drops || 0),
        momo: String(entry.momo || liveData?.momo || 0),
        app_users: String(entry.app_users || liveData?.app || 0),
      })
      setCashApproval({
        approved_amount: entry.cash_approved || '',
        status: entry.cash_status || 'pending'
      })
      loadData(entry.id)
    }
  }, [entry?.id])

  async function loadData(entryId) {
    const { data: exp } = await supabase.from('balance_expenses').select('*').eq('entry_id', entryId).order('created_at', { ascending: false })
    setExpenses(exp || [])
    onExpensesChanged?.(pumpNumber, exp || [])

    const { data: adj } = await supabase.from('balance_adjustments').select('*').eq('entry_id', entryId).order('created_at', { ascending: false })
    setAdjustments(adj || [])
  }

  const handleChange = (field, value) => {
    if (field === 'pms_open' || field === 'ago_open') {
      if (!editOpenMeters) return
    } else if (field === 'cash') {
      if (!editFinances) return
    } else {
      if (!editFinances) return
    }
    setForm(prev => ({ ...prev, [field]: value }))
  }

  const digitCount = v => String(v ?? '').replace(/[^0-9]/g, '').length
  const closeMeterInvalid = editFinances && !isPmsOnly && (digitCount(form.pms_close) < 2 || digitCount(form.ago_close) < 2)

  const calc = useMemo(() => {
    const pmsL = Math.max(0, Number(form.pms_close || 0) - Number(form.pms_open || 0))
    const agoL = isPmsOnly ? 0 : Math.max(0, Number(form.ago_close || 0) - Number(form.ago_open || 0))

    const pmsSales = pmsL * Number(globalPrices?.PMS || globalPrices?.pms || 0)
    const agoSales = agoL * Number(globalPrices?.AGO || globalPrices?.ago || 0)
    const totalSales = pmsSales + agoSales

    const totalApprovedExpenses = expenses.filter(e => e.status === 'approved').reduce((sum, e) => sum + Number(e.amount), 0)
    const adjTotal = adjustments.reduce((sum, a) => sum + Number(a.amount), 0)

    const baseCash = form.cash !== '0' && editFinances ? Number(form.cash) : (cashApproval.status === 'approved' ? Number(cashApproval.approved_amount) : Number(form.cash))

    const deductions = totalApprovedExpenses + adjTotal + baseCash +
      Number(form.drops || 0) + Number(form.momo || 0) + Number(form.sales_difference || 0) +
      Number(form.app_users || 0) + Number(form.visa || 0)

    const netBalance = totalSales - deductions

    let status = 'BALANCED'
    if (netBalance > 300) status = 'SHORTAGE'
    else if (netBalance < -300) status = 'EXCESS'

    return { pmsL, agoL, pmsSales, agoSales, totalSales, deductions, netBalance, status, adjTotal }
  }, [form, expenses, adjustments, globalPrices, cashApproval, editFinances, isPmsOnly])

  async function saveBalance() {
    if (!entry?.id || !editFinances) return
    if (closeMeterInvalid) { alert('Close meters must be at least 2 digits.'); return }
    setSaving(true)
    try {
      const { error } = await supabase.from('balance_entries').update({
        pms_open: Number(form.pms_open || 0), pms_close: Number(form.pms_close || 0),
        ago_open: isPmsOnly ? 0 : Number(form.ago_open || 0), ago_close: isPmsOnly ? 0 : Number(form.ago_close || 0),
        visa: Number(form.visa || 0),
        sales_difference: Number(form.sales_difference || 0),
        drops: Number(form.drops || 0), momo: Number(form.momo || 0), app_users: Number(form.app_users || 0),
        cash: editFinances ? Number(form.cash || 0) : undefined
      }).eq('id', entry.id)
      if (error) throw error
      onSaved?.()
      onClose?.()
    } catch (err) { alert(err.message) }
    setSaving(false)
  }

  async function submitCashAdjustment() {
    if (!entry?.id || !cashInput) return
    setSaving(true)
    try {
      const { error } = await supabase.from('balance_adjustments').insert({
        entry_id: entry.id,
        item: 'cash',
        amount: Number(cashInput),
        reason: cashReason || 'Cash submitted',
        created_by: user.id
      })
      if (error) throw error
      setCashInput('')
      setCashReason('')
      await loadData(entry.id)
      onSaved?.()
    } catch (err) { alert(err.message) }
    setSaving(false)
  }

  async function approveCash() {
    if (!approveExpenses) return
    setSaving(true)
    try {
      const { error } = await supabase.from('balance_entries').update({
        cash_approved: Number(cashApproval.approved_amount),
        cash_status: 'approved',
        cash_approved_by: user.id,
        cash_approved_at: new Date().toISOString()
      }).eq('id', entry.id)
      if (error) throw error
      setCashApproval(prev => ({ ...prev, status: 'approved' }))
      onSaved?.()
    } catch (err) { alert(err.message) }
    setSaving(false)
  }

  async function addAdjustment() {
    if (!adjustModal) return
    if (!adjustForm.amount || !adjustForm.reason) return alert('Enter amount and reason')
    setSaving(true)
    try {
      const { error } = await supabase.from('balance_adjustments').insert({
        entry_id: entry.id,
        item: adjustModal.item,
        amount: Number(adjustForm.amount),
        reason: adjustForm.reason,
        created_by: user.id
      })
      if (error) throw error
      setAdjustModal(null)
      setAdjustForm({ amount: '', reason: '' })
      await loadData(entry.id)
      onSaved?.()
    } catch (err) { alert(err.message) }
    setSaving(false)
  }

  async function deleteAdjustment(id) {
    if (!window.confirm('Delete this adjustment record?')) return
    setSaving(true)
    try {
      const { error } = await supabase.from('balance_adjustments').delete().eq('id', id)
      if (error) throw error
      await loadData(entry.id)
      onSaved?.()
    } catch (err) { alert(err.message) }
    setSaving(false)
  }

  async function addExpense() {
    if (!entry?.id || !addExpenses) return
    if (!newExpense.amount) return alert('Enter amount')
    if (!newExpense.type.trim()) return alert('Enter expense name/type')
    setSaving(true)
    try {
      const { error } = await supabase.from('balance_expenses').insert({
        entry_id: entry.id, expense_type: newExpense.type.trim().toUpperCase(), amount: Number(newExpense.amount),
        note: newExpense.note, status: editFinances ? 'approved' : 'pending',
        approved_by: editFinances ? user.id : null, approved_at: editFinances ? new Date().toISOString() : null,
        created_by: user.id
      })
      if (error) { throw error }
      setNewExpense({ type: '', amount: '', note: '' })
      await loadData(entry.id)
      onSaved?.()
    } catch (err) { alert("Failed to add expense: " + err.message) }
    setSaving(false)
  }

  // ---- INLINE EDIT EXPENSE (attendants -> own pending; managers -> any) ----
  function startEditExpense(ex) {
    setEditingExpenseId(ex.id)
    setEditExpenseForm({
      type: ex.expense_type || '',
      amount: String(ex.amount ?? ''),
      note: ex.note || '',
    })
  }

  function cancelEditExpense() {
    setEditingExpenseId(null)
    setEditExpenseForm({ type: '', amount: '', note: '' })
  }

  async function saveEditedExpense(id) {
    if (!editExpenseForm.amount) return alert('Enter amount')
    if (!editExpenseForm.type.trim()) return alert('Enter expense name/type')
    setBusyExpenseId(id)
    try {
      const { error } = await supabase.from('balance_expenses').update({
        expense_type: editExpenseForm.type.trim().toUpperCase(),
        amount: Number(editExpenseForm.amount),
        note: editExpenseForm.note,
      }).eq('id', id)
      if (error) throw error
      cancelEditExpense()
      await loadData(entry.id)
      onSaved?.()
    } catch (err) { alert(err.message) }
    setBusyExpenseId(null)
  }

  async function setExpenseStatus(id, status) {
    if (!approveExpenses) return
    setBusyExpenseId(id)
    try {
      const { error } = await supabase.from('balance_expenses').update({ status, approved_by: user.id, approved_at: new Date().toISOString() }).eq('id', id)
      if (error) throw error
      await loadData(entry.id)
      onSaved?.()
    } catch (err) { alert(err.message) }
    setBusyExpenseId(null)
  }

  async function deleteExpense(id) {
    if (!window.confirm('Delete this expense?')) return
    setBusyExpenseId(id)
    try {
      const { error } = await supabase.from('balance_expenses').delete().eq('id', id)
      if (error) throw error
      await loadData(entry.id)
      onSaved?.()
    } catch (err) { alert(err.message) }
    setBusyExpenseId(null)
  }

  const financesLocked = !editFinances

  const AdjBtn = ({ item }) => {
    if (!editFinances) return null
    return (
      <button onClick={() => setAdjustModal({ item })} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: C.accent, fontSize: 16 }} title="Add Adjustment">
        <i className="fas fa-plus-circle" />
      </button>
    )
  }

  const cashAdjustments = adjustments.filter(a => a.item === 'cash')
  const otherAdjustments = adjustments.filter(a => a.item !== 'cash')
  const totalCashSubmitted = cashAdjustments.reduce((sum, a) => sum + Number(a.amount), 0)

  return (
    <div className="modal-bg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ maxWidth: 640, width: '92%', maxHeight: '92vh', overflowY: 'auto', background: C.card, color: C.text, borderRadius: 12, border: `1px solid ${C.border}`, padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <h3 style={{ margin: 0, color: C.text, fontSize: 18 }}>Pump {pump?.pump_number} — {pump?.product}</h3>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>Attendant: {entry?.user_id ? 'Assigned' : 'Unassigned'}</div>
          </div>
          <button className="btn-ghost" onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: C.muted, fontSize: 18 }}><i className="fas fa-times" /></button>
        </div>

        {locked && (
          <div style={{ fontSize: 12, color: C.warn, background: C.warnBg, padding: '8px 12px', borderRadius: 6, marginBottom: 14 }}>
            <i className="fas fa-lock" style={{ marginRight: 6 }} /> This shift is closed — the sheet is read-only.
            {isAdmin && <span style={{ fontWeight: 700, marginLeft: 6 }}>(Admin Override Active)</span>}
          </div>
        )}

        {!entry ? (
          <div style={{ textAlign: 'center', padding: 20, color: C.muted }}>Please assign an attendant to this pump first.</div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: isPmsOnly ? '1fr' : '1fr 1fr', gap: 14, marginBottom: 16 }}>
              <div style={{ background: C.soft, padding: 12, borderRadius: 8, border: `1px solid ${C.border}` }}>
                <h4 style={{ margin: '0 0 10px', fontSize: 12, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5 }}>PMS (Price: {Number(globalPrices?.PMS || globalPrices?.pms || 0).toLocaleString()})</h4>
                <NumberInput label={`Open Meter ${isAdmin ? '' : '(auto)'}`} value={form.pms_open} onChange={val => handleChange('pms_open', val)} disabled={!editOpenMeters} />
                <div style={{ height: 8 }} />
                <NumberInput label="Close Meter" value={form.pms_close} onChange={val => handleChange('pms_close', val)} disabled={financesLocked} />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginTop: 8, color: C.text }}>
                  <span>Liters: <b>{calc.pmsL.toLocaleString()}</b></span><span>Sales: <b>{calc.pmsSales.toLocaleString()}</b></span>
                </div>
              </div>

              {!isPmsOnly && (
                <div style={{ background: C.soft, padding: 12, borderRadius: 8, border: `1px solid ${C.border}` }}>
                  <h4 style={{ margin: '0 0 10px', fontSize: 12, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5 }}>AGO (Price: {Number(globalPrices?.AGO || globalPrices?.ago || 0).toLocaleString()})</h4>
                  <NumberInput label={`Open Meter ${isAdmin ? '' : '(auto)'}`} value={form.ago_open} onChange={val => handleChange('ago_open', val)} disabled={!editOpenMeters} />
                  <div style={{ height: 8 }} />
                  <NumberInput label="Close Meter" value={form.ago_close} onChange={val => handleChange('ago_close', val)} disabled={financesLocked} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginTop: 8, color: C.text }}>
                    <span>Liters: <b>{calc.agoL.toLocaleString()}</b></span><span>Sales: <b>{calc.agoSales.toLocaleString()}</b></span>
                  </div>
                </div>
              )}
            </div>

            {closeMeterInvalid && (
              <div style={{ fontSize: 12, color: '#7f1d1d', background: C.dangerBg, padding: '8px 12px', borderRadius: 6, marginBottom: 12 }}>
                Close meters must have at least <b>2 digits</b>.
              </div>
            )}

            <div style={{ background: C.accentSoft, padding: 12, borderRadius: 8, display: 'flex', justifyContent: 'space-between', marginBottom: 16, fontWeight: 800, color: C.text, fontSize: 14 }}>
              <span>TOTAL SALES</span><span>{calc.totalSales.toLocaleString()}</span>
            </div>

            <h4 style={{ fontSize: 12, color: C.muted, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>Deductions & Payments</h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
              <NumberInput label="Drops" value={form.drops} onChange={val => handleChange('drops', val)} disabled={financesLocked} isLive liveValue={liveData?.drops} action={<AdjBtn item="drops" />} />
              <NumberInput label="MOMO/Airtel" value={form.momo} onChange={val => handleChange('momo', val)} disabled={financesLocked} isLive liveValue={liveData?.momo} action={<AdjBtn item="momo" />} />
              <NumberInput label="App Users" value={form.app_users} onChange={val => handleChange('app_users', val)} disabled={financesLocked} isLive liveValue={liveData?.app} action={<AdjBtn item="app_users" />} />
              <NumberInput label="Sales Diff" value={form.sales_difference} onChange={val => handleChange('sales_difference', val)} disabled={financesLocked} action={<AdjBtn item="sales_difference" />} />
              <NumberInput label="Visa" value={form.visa} onChange={val => handleChange('visa', val)} disabled={financesLocked} action={<AdjBtn item="visa" />} />

              {/* CASH FIELD */}
              <div style={{ position: 'relative' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <label style={{ fontSize: 11, color: C.muted }}>Cash</label>
                  <AdjBtn item="cash" />
                </div>

                {editFinances ? (
                  <input type="text" inputMode="numeric" value={form.cash} onChange={e => handleChange('cash', e.target.value)} style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: `1px solid ${C.border}`, background: C.card, color: C.text, fontSize: 13 }} />
                ) : (
                  <>
                    <div style={{ padding: '8px 10px', background: C.soft, borderRadius: 6, fontSize: 13, fontWeight: 600, color: C.text, border: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>{Number(totalCashSubmitted).toLocaleString()}</span>
                    </div>
                    {!locked && (
                      <div style={{ marginTop: 8, padding: 8, background: '#f8fafc', borderRadius: 6, border: `1px dashed #cbd5e1` }}>
                        <input type="text" inputMode="numeric" placeholder="Amount submitted" value={cashInput} onChange={e => setCashInput(e.target.value)} style={{ width: '100%', padding: 6, borderRadius: 4, border: '1px solid #cbd5e1', marginBottom: 4, fontSize: 12 }} />
                        <input type="text" placeholder="Reason/Note" value={cashReason} onChange={e => setCashReason(e.target.value)} style={{ width: '100%', padding: 6, borderRadius: 4, border: '1px solid #cbd5e1', marginBottom: 6, fontSize: 12 }} />
                        <button onClick={submitCashAdjustment} style={{ width: '100%', padding: 6, background: C.accent, color: 'white', border: 'none', borderRadius: 4, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Submit Cash</button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            {editFinances && (
              <button onClick={saveBalance} disabled={saving || closeMeterInvalid} style={{ width: '100%', padding: '10px 14px', marginBottom: 16, background: closeMeterInvalid ? '#cbd5e1' : C.accent, color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: closeMeterInvalid ? 'not-allowed' : 'pointer' }}>
                {saving ? 'Saving...' : 'Save Meter & Deductions'}
              </button>
            )}

            {/* ADJUSTMENTS LIST */}
            {adjustments.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                {cashAdjustments.length > 0 && (
                  <>
                    <h4 style={{ fontSize: 12, color: C.muted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>Cash Submission Log</h4>
                    {cashAdjustments.map(adj => (
                      <div key={adj.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: `1px solid ${C.border}`, fontSize: 12 }}>
                        <div>
                          <span style={{ fontWeight: 600 }}>CASH</span> — <span style={{ color: C.muted }}>{adj.reason}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontWeight: 700, color: Number(adj.amount) >= 0 ? C.success : C.danger }}>
                            +{Number(adj.amount).toLocaleString()}
                          </span>
                          {editFinances && !locked && (
                            <button onClick={() => deleteAdjustment(adj.id)} style={{ background: 'none', border: 'none', color: C.danger, cursor: 'pointer', fontSize: 12 }} title="Delete">
                              <i className="fas fa-trash" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </>
                )}

                {otherAdjustments.length > 0 && (
                  <>
                    <h4 style={{ fontSize: 12, color: C.muted, marginBottom: 8, marginTop: 16, textTransform: 'uppercase', letterSpacing: 0.5 }}>Other Adjustments</h4>
                    {otherAdjustments.map(adj => (
                      <div key={adj.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: `1px solid ${C.border}`, fontSize: 12 }}>
                        <div>
                          <span style={{ fontWeight: 600, textTransform: 'uppercase' }}>{adj.item}</span> — <span style={{ color: C.muted }}>{adj.reason}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontWeight: 700, color: Number(adj.amount) >= 0 ? C.success : C.danger }}>
                            {Number(adj.amount) >= 0 ? '+' : ''}{Number(adj.amount).toLocaleString()}
                          </span>
                          {editFinances && !locked && (
                            <button onClick={() => deleteAdjustment(adj.id)} style={{ background: 'none', border: 'none', color: C.danger, cursor: 'pointer', fontSize: 12 }} title="Delete">
                              <i className="fas fa-trash" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}

            <h4 style={{ fontSize: 12, color: C.muted, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>Expenses {financesLocked && !locked ? '(pending requires approval)' : ''}</h4>
            <div style={{ marginBottom: 12 }}>
              {expenses.map(ex => {
                const isPending = ex.status === 'pending'
                const busy = busyExpenseId === ex.id
                const canDelete = !locked && (editFinances || (isPending && ex.created_by === user.id))
                // Attendant can edit their own pending expense inline; managers can edit any
                const canInlineEdit = !locked && !editFinances && isPending && ex.created_by === user.id
                const badgeBg = ex.status === 'approved' ? C.successBg : ex.status === 'rejected' ? C.dangerBg : C.warnBg
                const badgeColor = ex.status === 'approved' ? '#166534' : ex.status === 'rejected' ? '#991b1b' : C.warn

                if (editingExpenseId === ex.id) {
                  return (
                    <div key={ex.id} style={{ padding: '8px 0', borderBottom: `1px solid ${C.border}` }}>
                      <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                        <input list="expense-types" value={editExpenseForm.type}
                          onChange={e => setEditExpenseForm({ ...editExpenseForm, type: e.target.value })}
                          style={{ flex: 1, padding: '6px 8px', borderRadius: 6, border: `1px solid ${C.border}`, background: C.card, color: C.text, fontSize: 12 }} />
                        <input type="text" inputMode="numeric" value={editExpenseForm.amount}
                          onChange={e => setEditExpenseForm({ ...editExpenseForm, amount: e.target.value })}
                          style={{ width: 100, padding: '6px 8px', borderRadius: 6, border: `1px solid ${C.border}`, background: C.card, color: C.text, fontSize: 12 }} />
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <input placeholder="Note (optional)" value={editExpenseForm.note}
                          onChange={e => setEditExpenseForm({ ...editExpenseForm, note: e.target.value })}
                          style={{ flex: 1, padding: '6px 8px', borderRadius: 6, border: `1px solid ${C.border}`, background: C.card, color: C.text, fontSize: 12 }} />
                        <button disabled={busy} onClick={() => saveEditedExpense(ex.id)}
                          style={{ padding: '4px 12px', background: C.success, color: '#fff', border: 'none', borderRadius: 4, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Save</button>
                        <button disabled={busy} onClick={cancelEditExpense}
                          style={{ padding: '4px 12px', background: C.soft, color: C.muted, border: 'none', borderRadius: 4, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
                      </div>
                    </div>
                  )
                }

                return (
                  <div key={ex.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: `1px solid ${C.border}` }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13, color: C.text }}>{ex.expense_type} — {Number(ex.amount).toLocaleString()}</div>
                      {ex.note && <div style={{ fontSize: 11, color: C.muted }}>{ex.note}</div>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: badgeBg, color: badgeColor, fontWeight: 700 }}>{ex.status.toUpperCase()}</span>
                      {canInlineEdit && (
                        <button disabled={busy} onClick={() => startEditExpense(ex)}
                          style={{ padding: '3px 8px', background: C.accentSoft, color: C.accent, border: 'none', borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Edit</button>
                      )}
                      {isPending && approveExpenses && !locked && (
                        <>
                          <button disabled={busy} onClick={() => setExpenseStatus(ex.id, 'approved')} style={{ padding: '3px 8px', background: C.success, color: '#fff', border: 'none', borderRadius: 4, fontSize: 12, cursor: 'pointer' }}>✓</button>
                          <button disabled={busy} onClick={() => setExpenseStatus(ex.id, 'rejected')} style={{ padding: '3px 8px', background: C.danger, color: '#fff', border: 'none', borderRadius: 4, fontSize: 12, cursor: 'pointer' }}>✕</button>
                        </>
                      )}
                      {canDelete && (
                        <button disabled={busy} onClick={() => deleteExpense(ex.id)} style={{ padding: '3px 8px', background: C.soft, color: C.muted, border: 'none', borderRadius: 4, fontSize: 11, cursor: 'pointer' }}>Delete</button>
                      )}
                    </div>
                  </div>
                )
              })}
              {expenses.length === 0 && <div style={{ fontSize: 12, color: C.muted }}>No expenses recorded.</div>}
            </div>

            {addExpenses && (
              <div style={{ background: C.soft, padding: 12, borderRadius: 8, marginBottom: 16, border: `1px solid ${C.border}` }}>
                <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <input list="expense-types" placeholder="Expense Name / Type" value={newExpense.type} onChange={e => setNewExpense({ ...newExpense, type: e.target.value })} style={{ flex: 1, padding: '8px 10px', borderRadius: 6, border: `1px solid ${C.border}`, background: C.card, color: C.text, fontSize: 13 }} />
                  <datalist id="expense-types">{customExpenseTypes.map(t => <option key={t} value={t} />)}</datalist>
                  <input type="text" inputMode="numeric" placeholder="Amount" value={newExpense.amount} onChange={e => setNewExpense({ ...newExpense, amount: e.target.value })} style={{ width: 110, padding: '8px 10px', borderRadius: 6, border: `1px solid ${C.border}`, background: C.card, color: C.text, fontSize: 13 }} />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input placeholder="Note (optional)" value={newExpense.note} onChange={e => setNewExpense({ ...newExpense, note: e.target.value })} style={{ flex: 1, padding: '8px 10px', borderRadius: 6, border: `1px solid ${C.border}`, background: C.card, color: C.text, fontSize: 13 }} />
                  <button onClick={addExpense} disabled={saving} style={{ padding: '8px 14px', background: C.accent, color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                    {editFinances ? 'Add (auto-approve)' : 'Add (pending)'}
                  </button>
                </div>
              </div>
            )}

            <div style={{ padding: 14, borderRadius: 8, background: calc.status === 'SHORTAGE' ? C.dangerBg : calc.status === 'EXCESS' ? C.successBg : C.soft, border: `1px solid ${calc.status === 'SHORTAGE' ? '#fca5a5' : calc.status === 'EXCESS' ? '#86efac' : C.border}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, color: C.text }}><span>Total Sales</span><span>{calc.totalSales.toLocaleString()}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, color: C.danger }}><span>Total Deductions</span><span>-{calc.deductions.toLocaleString()}</span></div>
              <div style={{ height: 1, background: C.border, margin: '10px 0' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 800, color: C.text }}>NET BALANCE</span>
                <span style={{ fontSize: 20, fontWeight: 900, color: calc.status === 'SHORTAGE' ? C.danger : calc.status === 'EXCESS' ? C.success : C.text }}>{calc.netBalance.toLocaleString()}</span>
              </div>
              <div style={{ textAlign: 'right', fontSize: 12, fontWeight: 700, color: calc.status === 'SHORTAGE' ? C.danger : calc.status === 'EXCESS' ? C.success : C.text }}>{calc.status}</div>
            </div>
          </>
        )}
      </div>

      {adjustModal && (
        <div className="modal-bg" onClick={e => { if (e.target === e.currentTarget) setAdjustModal(null) }}>
          <div className="modal" style={{ maxWidth: 400, background: C.card }}>
            <h3 style={{ color: C.text, textTransform: 'uppercase' }}>Adjust {adjustModal.item.replace('_', ' ')}</h3>
            <p style={{ fontSize: 12, color: C.muted, marginBottom: 16 }}>Enter a positive number to add, or a negative number to subtract (e.g., -500).</p>
            <label style={{ color: C.text }}>Amount</label>
            <input type="text" inputMode="numeric" placeholder="e.g. 5000 or -2000" value={adjustForm.amount} onChange={e => setAdjustForm({ ...adjustForm, amount: e.target.value })} style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: `1px solid ${C.border}`, marginBottom: 12 }} />
            <label style={{ color: C.text }}>Reason</label>
            <input type="text" placeholder="e.g. Correcting error" value={adjustForm.reason} onChange={e => setAdjustForm({ ...adjustForm, reason: e.target.value })} style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: `1px solid ${C.border}`, marginBottom: 12 }} />
            <div className="modal-actions">
              <button className="btn-ghost-full" onClick={() => setAdjustModal(null)}>Cancel</button>
              <button className="btn-primary-full" onClick={addAdjustment} disabled={saving}>Add Adjustment</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}