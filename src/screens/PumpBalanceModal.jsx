import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabase'

export default function PumpBalanceModal({ profile, pump, entry, liveData, globalPrices, onClose, onSaved }) {
  const user = profile.user
  const isManager = ['admin', 'manager', 'supervisor'].includes(user.role)
  const canEditAll = isManager || profile.powers?.edit_balancing
  
  const [form, setForm] = useState({
    pms_open: 0, pms_close: 0, ago_open: 0, ago_close: 0,
    cash: 0, visa: 0, sales_difference: 0, drops: 0, momo: 0, app_users: 0
  })
  
  const [expenses, setExpenses] = useState([])
  const [newExpense, setNewExpense] = useState({ type: 'Lunch', amount: '', note: '' })
  const [customExpenseTypes] = useState(['Lunch', 'Milk', 'Generator', 'KPI', 'RTT', 'RAY', 'KIBULI'])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (entry) {
      setForm({
        pms_open: entry.pms_open || 0, pms_close: entry.pms_close || 0, 
        ago_open: entry.ago_open || 0, ago_close: entry.ago_close || 0, 
        cash: entry.cash || 0, visa: entry.visa || 0, sales_difference: entry.sales_difference || 0,
        drops: entry.drops || liveData?.drops || 0, 
        momo: entry.momo || liveData?.momo || 0, 
        app_users: entry.app_users || liveData?.app || 0
      })
      loadExpenses(entry.id)
    }
  }, [entry?.id]) // Only runs when the ID changes

  async function loadExpenses(entryId) {
    const { data } = await supabase.from('balance_expenses').select('*').eq('entry_id', entryId).order('created_at', { ascending: false })
    setExpenses(data || [])
  }

  const handleChange = (field, value) => setForm(prev => ({ ...prev, [field]: value }))

  const calc = useMemo(() => {
    const pmsL = Math.max(0, Number(form.pms_close) - Number(form.pms_open))
    const agoL = Math.max(0, Number(form.ago_close) - Number(form.ago_open))
    
    const pmsSales = pmsL * Number(globalPrices?.pms || 0)
    const agoSales = agoL * Number(globalPrices?.ago || 0)
    const totalSales = pmsSales + agoSales

    const totalApprovedExpenses = expenses.filter(e => e.status === 'approved').reduce((sum, e) => sum + Number(e.amount), 0)
    const deductions = totalApprovedExpenses + Number(form.drops) + Number(form.momo) + Number(form.sales_difference) + Number(form.app_users) + Number(form.cash) + Number(form.visa)
    const netBalance = totalSales - deductions

    let status = 'BALANCED'
    if (netBalance > 300) status = 'SHORTAGE'
    else if (netBalance < -300) status = 'EXCESS'

    return { pmsL, agoL, pmsSales, agoSales, totalSales, deductions, netBalance, status }
  }, [form, expenses, globalPrices])

  async function saveBalance() {
    setSaving(true)
    try {
      const { error } = await supabase.from('balance_entries').update({
        pms_open: Number(form.pms_open), pms_close: Number(form.pms_close), 
        ago_open: Number(form.ago_open), ago_close: Number(form.ago_close), 
        cash: Number(form.cash), visa: Number(form.visa), sales_difference: Number(form.sales_difference),
        drops: Number(form.drops), momo: Number(form.momo), app_users: Number(form.app_users)
      }).eq('id', entry.id)
      
      if (error) throw error
      onSaved() 
      onClose() 
    } catch (err) {
      alert(err.message)
    }
    setSaving(false)
  }

  async function addExpense() {
    if (!newExpense.amount) return alert('Enter amount')
    setSaving(true)
    try {
      const { error } = await supabase.from('balance_expenses').insert({
        entry_id: entry.id, expense_type: newExpense.type, amount: Number(newExpense.amount),
        note: newExpense.note, status: isManager ? 'approved' : 'pending',
        approved_by: isManager ? user.id : null, approved_at: isManager ? new Date().toISOString() : null
      })
      if (error) throw error
      setNewExpense({ type: newExpense.type, amount: '', note: '' })
      await loadExpenses(entry.id)
    } catch (err) {
      alert(err.message)
    }
    setSaving(false)
  }

  async function approveExpense(id) {
    setSaving(true)
    await supabase.from('balance_expenses').update({ status: 'approved', approved_by: user.id, approved_at: new Date().toISOString() }).eq('id', id)
    await loadExpenses(entry.id)
    setSaving(false)
  }

  const canEdit = canEditAll || entry?.user_id === user.id

  return (
    <div className="modal-bg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ maxWidth: '600px', width: '90%', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <h3 style={{ margin: 0 }}>Pump {pump?.pump_number} — {pump?.product}</h3>
            <div className="modal-sub">Attendant: {entry?.user_id ? 'Assigned' : 'Unassigned'}</div>
          </div>
          <button className="btn-ghost" onClick={onClose}><i className="fas fa-times" /></button>
        </div>

        {!entry ? (
          <div style={{ textAlign: 'center', padding: 20 }}>Please assign an attendant to this pump first.</div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
              <div style={{ background: '#f8fafc', padding: 12, borderRadius: 8 }}>
                <h4 style={{ margin: '0 0 10px', fontSize: 13, color: '#64748b' }}>PMS (Price: {globalPrices?.pms})</h4>
                <label style={{ fontSize: 11 }}>Open Meter</label>
                <input type="number" disabled={!canEdit} value={form.pms_open} onChange={e => handleChange('pms_open', e.target.value)} style={{ width: '100%', marginBottom: 8 }} />
                <label style={{ fontSize: 11 }}>Close Meter</label>
                <input type="number" disabled={!canEdit} value={form.pms_close} onChange={e => handleChange('pms_close', e.target.value)} style={{ width: '100%', marginBottom: 8 }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginTop: 8, color: '#334155' }}>
                  <span>Liters: <b>{calc.pmsL.toLocaleString()}</b></span>
                  <span>Sales: <b>{calc.pmsSales.toLocaleString()}</b></span>
                </div>
              </div>

              <div style={{ background: '#f8fafc', padding: 12, borderRadius: 8 }}>
                <h4 style={{ margin: '0 0 10px', fontSize: 13, color: '#64748b' }}>AGO (Price: {globalPrices?.ago})</h4>
                <label style={{ fontSize: 11 }}>Open Meter</label>
                <input type="number" disabled={!canEdit} value={form.ago_open} onChange={e => handleChange('ago_open', e.target.value)} style={{ width: '100%', marginBottom: 8 }} />
                <label style={{ fontSize: 11 }}>Close Meter</label>
                <input type="number" disabled={!canEdit} value={form.ago_close} onChange={e => handleChange('ago_close', e.target.value)} style={{ width: '100%', marginBottom: 8 }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginTop: 8, color: '#334155' }}>
                  <span>Liters: <b>{calc.agoL.toLocaleString()}</b></span>
                  <span>Sales: <b>{calc.agoSales.toLocaleString()}</b></span>
                </div>
              </div>
            </div>

            <div style={{ background: '#e0e7ff', padding: 12, borderRadius: 8, display: 'flex', justifyContent: 'space-between', marginBottom: 20, fontWeight: 'bold' }}>
              <span>TOTAL SALES</span>
              <span>{calc.totalSales.toLocaleString()}</span>
            </div>

            <h4 style={{ fontSize: 13, color: '#64748b', marginBottom: 10 }}>Deductions & Payments</h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
              <div><label style={{ fontSize: 11 }}>Drops</label><input type="number" disabled={!canEdit} value={form.drops} onChange={e => handleChange('drops', e.target.value)} style={{ width: '100%' }} /></div>
              <div><label style={{ fontSize: 11 }}>MOMO/Airtel</label><input type="number" disabled={!canEdit} value={form.momo} onChange={e => handleChange('momo', e.target.value)} style={{ width: '100%' }} /></div>
              <div><label style={{ fontSize: 11 }}>App Users</label><input type="number" disabled={!canEdit} value={form.app_users} onChange={e => handleChange('app_users', e.target.value)} style={{ width: '100%' }} /></div>
              <div><label style={{ fontSize: 11 }}>Sales Diff</label><input type="number" disabled={!canEdit} value={form.sales_difference} onChange={e => handleChange('sales_difference', e.target.value)} style={{ width: '100%' }} /></div>
              <div><label style={{ fontSize: 11 }}>Visa</label><input type="number" disabled={!canEdit} value={form.visa} onChange={e => handleChange('visa', e.target.value)} style={{ width: '100%' }} /></div>
              <div><label style={{ fontSize: 11 }}>Cash</label><input type="number" disabled={!canEdit} value={form.cash} onChange={e => handleChange('cash', e.target.value)} style={{ width: '100%' }} /></div>
            </div>

            <button className="btn-primary-full" onClick={saveBalance} disabled={saving || !canEdit} style={{ marginBottom: 20 }}>
              {saving ? 'Saving...' : 'Save Meter & Deductions'}
            </button>

            <h4 style={{ fontSize: 13, color: '#64748b', marginBottom: 10 }}>Expenses</h4>
            <div style={{ marginBottom: 16 }}>
              {expenses.map(ex => (
                <div key={ex.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #e2e8f0' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{ex.expense_type} - {Number(ex.amount).toLocaleString()}</div>
                    {ex.note && <div style={{ fontSize: 11, color: '#64748b' }}>{ex.note}</div>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: ex.status === 'approved' ? '#dcfce7' : '#fef9c3', color: ex.status === 'approved' ? '#166534' : '#854d0e' }}>
                      {ex.status.toUpperCase()}
                    </span>
                    {ex.status === 'pending' && canEditAll && (
                      <button className="btn-tiny success" onClick={() => approveExpense(ex.id)}>✓</button>
                    )}
                  </div>
                </div>
              ))}
              {expenses.length === 0 && <div style={{ fontSize: 12, color: '#94a3b8' }}>No expenses recorded.</div>}
            </div>

            {canEdit && (
              <div style={{ background: '#f8fafc', padding: 12, borderRadius: 8, marginBottom: 20 }}>
                <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <select value={newExpense.type} onChange={e => setNewExpense({ ...newExpense, type: e.target.value })} style={{ flex: 1 }}>
                    {customExpenseTypes.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <input type="number" placeholder="Amount" value={newExpense.amount} onChange={e => setNewExpense({ ...newExpense, amount: e.target.value })} style={{ width: 100 }} />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input placeholder="Note (optional)" value={newExpense.note} onChange={e => setNewExpense({ ...newExpense, note: e.target.value })} style={{ flex: 1 }} />
                  <button className="btn-primary" onClick={addExpense} disabled={saving}>Add</button>
                </div>
              </div>
            )}

            <div style={{ padding: 16, borderRadius: 8, background: calc.status === 'SHORTAGE' ? '#fef2f2' : calc.status === 'EXCESS' ? '#f0fdf4' : '#f8fafc', border: `1px solid ${calc.status === 'SHORTAGE' ? '#fca5a5' : calc.status === 'EXCESS' ? '#86efac' : '#e2e8f0'}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}><span>Total Sales</span><span>{calc.totalSales.toLocaleString()}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, color: '#ef4444' }}><span>Total Deductions</span><span>-{calc.deductions.toLocaleString()}</span></div>
              <div style={{ height: 1, background: '#cbd5e1', margin: '12px 0' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 'bold' }}>NET BALANCE</span>
                <span style={{ fontSize: 20, fontWeight: 'bold', color: calc.status === 'SHORTAGE' ? '#dc2626' : calc.status === 'EXCESS' ? '#16a34a' : '#0f172a' }}>{calc.netBalance.toLocaleString()}</span>
              </div>
              <div style={{ textAlign: 'right', fontSize: 12, fontWeight: 'bold', color: calc.status === 'SHORTAGE' ? '#dc2626' : calc.status === 'EXCESS' ? '#16a34a' : '#0f172a' }}>{calc.status}</div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}