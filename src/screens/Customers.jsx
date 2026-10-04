import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabase'

export default function Customers({ profile }) {
  const user = profile.user
  const isManager = ['admin','manager'].includes(user.role)
  const isSupervisor = user.role === 'supervisor'
  const isAmbassador = user.role === 'ambassador'
  const canAdd = isManager || isSupervisor || isAmbassador
  const canEdit = isManager
  const canPay = isManager

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [creditFilter, setCreditFilter] = useState('all')

  const [openEdit, setOpenEdit] = useState(null)     // 'new' | customer object
  const [openDetail, setOpenDetail] = useState(null) // customer object
  const [openPayment, setOpenPayment] = useState(null)
  const [openAddCredit, setOpenAddCredit] = useState(null)

  async function loadAll() {
    setLoading(true)

    const { data: customers } = await supabase
      .from('customers')
      .select('*')
      .eq('station_id', user.station_id)
      .order('name', { ascending: true })

    // Compute credit balance for each customer
    const enriched = await Promise.all((customers || []).map(async c => {
      const { data: credits } = await supabase
        .from('shortages_credits')
        .select('amount')
        .eq('category','credit')
        .eq('subject_id', c.id)
        .neq('status','rejected')
      const { data: payments } = await supabase
        .from('credit_payments')
        .select('amount')
        .eq('customer_id', c.id)

      const totalCredit = (credits || []).reduce((s, r) => s + Number(r.amount || 0), 0)
      const totalPaid = (payments || []).reduce((s, r) => s + Number(r.amount || 0), 0)
      return {
        ...c,
        totalCredit,
        totalPaid,
        balance: totalCredit - totalPaid,
      }
    }))

    setRows(enriched)
    setLoading(false)
  }

  useEffect(() => { loadAll() }, [user.station_id])

  const filtered = useMemo(() => {
    let r = rows.slice()
    if (search) {
      const q = search.toLowerCase()
      r = r.filter(c =>
        (c.name || '').toLowerCase().includes(q) ||
        (c.phone || '').toLowerCase().includes(q) ||
        (c.company || '').toLowerCase().includes(q) ||
        (c.card_number || '').toLowerCase().includes(q)
      )
    }
    if (typeFilter !== 'all') r = r.filter(c => c.customer_type === typeFilter)
    if (creditFilter === 'with_credit') r = r.filter(c => c.balance > 0)
    if (creditFilter === 'clean') r = r.filter(c => c.balance <= 0)
    return r
  }, [rows, search, typeFilter, creditFilter])

  function downloadCSV() {
    const header = 'Name,Phone,Company,Type,Card,Credit Given,Paid,Balance,Portal\n'
    const body = filtered.map(c => [
      (c.name || '').replace(/,/g,''),
      c.phone || '',
      (c.company || '').replace(/,/g,''),
      c.customer_type || '',
      c.card_number || '',
      c.totalCredit || 0,
      c.totalPaid || 0,
      c.balance || 0,
      c.portal_enabled ? 'yes' : 'no',
    ].join(',')).join('\n')
    const blob = new Blob([header + body], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `texol-customers-${new Date().toISOString().slice(0,10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const totalCreditOut = rows.reduce((s, c) => s + Number(c.balance || 0), 0)
  const customersWithCredit = rows.filter(c => c.balance > 0).length

  return (
    <div className="customers-screen">
      <div className="customers-head">
        <div>
          <h3>Customers</h3>
          <div className="sub">
            {rows.length} total · {customersWithCredit} with credit · UGX {totalCreditOut.toLocaleString()} outstanding
          </div>
        </div>
        <div className="customers-actions">
          <button className="btn-ghost" onClick={downloadCSV}>
            <i className="fas fa-file-csv" /> Download list
          </button>
          {canAdd && (
            <button className="btn-primary" onClick={() => setOpenEdit('new')}>
              <i className="fas fa-plus" /> Add customer
            </button>
          )}
        </div>
      </div>

      <div className="staff-filters">
        <input
          placeholder="Search name, phone, card…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          <option value="all">All types</option>
          <option value="card">Card holders</option>
          <option value="cash">Cash</option>
          <option value="credit">Credit</option>
        </select>
        <select value={creditFilter} onChange={e => setCreditFilter(e.target.value)}>
          <option value="all">All</option>
          <option value="with_credit">Has credit</option>
          <option value="clean">No credit</option>
        </select>
        <button className="btn-ghost btn-sm" onClick={() => {
          setSearch(''); setTypeFilter('all'); setCreditFilter('all')
        }}>Clear</button>
      </div>

      {loading ? (
        <div className="drops-empty">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="drops-empty">
          <i className="fas fa-users" />
          <h4>No customers</h4>
          <p>{canAdd ? 'Add one to get started.' : 'No customers match your filters.'}</p>
        </div>
      ) : (
        <div className="drops-table-wrap">
          <table className="drops-table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Type</th>
                <th>Card</th>
                <th>Credit</th>
                <th>Paid</th>
                <th>Balance</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => (
                <tr key={c.id}>
                  <td>
                    <strong>{c.name}</strong>
                    <br />
                    <span style={{ fontSize: 11, color: '#8ba0b9' }}>
                      {c.phone || '—'} {c.company ? '· ' + c.company : ''}
                    </span>
                  </td>
                  <td>
                    <span className={`pill ${
                      c.customer_type === 'card' ? 'blue' :
                      c.customer_type === 'credit' ? 'amber' : 'gray'
                    }`}>{c.customer_type || '—'}</span>
                  </td>
                  <td>{c.card_number ? <span className="code-pill" style={{fontSize:11}}>{c.card_number}</span> : '—'}</td>
                  <td>UGX {Number(c.totalCredit || 0).toLocaleString()}</td>
                  <td>UGX {Number(c.totalPaid || 0).toLocaleString()}</td>
                  <td>
                    <span className={`pill ${Number(c.balance || 0) === 0 ? 'green' : 'red'}`}>
                      UGX {Number(c.balance || 0).toLocaleString()}
                    </span>
                  </td>
                  <td>
                    <button className="btn-tiny" onClick={() => setOpenDetail(c)} title="View">
                      <i className="fas fa-eye" />
                    </button>
                    {canEdit && (
                      <button className="btn-tiny" onClick={() => setOpenEdit(c)} title="Edit">
                        <i className="fas fa-edit" />
                      </button>
                    )}
                    {canPay && Number(c.balance || 0) > 0 && (
                      <button className="btn-tiny success" onClick={() => setOpenPayment(c)} title="Record payment">
                        <i className="fas fa-money-bill" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {openEdit && (
        <EditCustomerModal
          profile={profile}
          customer={openEdit === 'new' ? null : openEdit}
          onClose={() => setOpenEdit(null)}
          onSaved={async () => { setOpenEdit(null); await loadAll() }}
        />
      )}

      {openDetail && (
        <CustomerDetailModal
          profile={profile}
          customer={openDetail}
          canEdit={canEdit}
          canPay={canPay}
          onClose={() => setOpenDetail(null)}
          onPay={() => { setOpenPayment(openDetail); setOpenDetail(null) }}
          onAddCredit={() => { setOpenAddCredit(openDetail); setOpenDetail(null) }}
          onReload={loadAll}
        />
      )}

      {openPayment && (
        <PaymentModal
          profile={profile}
          customer={openPayment}
          onClose={() => setOpenPayment(null)}
          onSaved={async () => { setOpenPayment(null); await loadAll() }}
        />
      )}

      {openAddCredit && (
        <AddCreditModal
          profile={profile}
          customer={openAddCredit}
          onClose={() => setOpenAddCredit(null)}
          onSaved={async () => { setOpenAddCredit(null); await loadAll() }}
        />
      )}
    </div>
  )
}

/* ============================================================
   EDIT / CREATE CUSTOMER
   ============================================================ */
function EditCustomerModal({ profile, customer, onClose, onSaved }) {
  const user = profile.user
  const isNew = !customer
  const isManager = ['admin','manager'].includes(user.role)

  const [name, setName] = useState(customer?.name || '')
  const [phone, setPhone] = useState(customer?.phone || '')
  const [company, setCompany] = useState(customer?.company || '')
  const [type, setType] = useState(customer?.customer_type || 'card')
  const [cardNumber, setCardNumber] = useState(customer?.card_number || '')
  const [creditLimit, setCreditLimit] = useState(customer?.credit_limit || 0)
  const [notes, setNotes] = useState(customer?.notes || '')
  const [portalEnabled, setPortalEnabled] = useState(customer?.portal_enabled || false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function save() {
    if (!name.trim()) { setErr('Name required'); return }
    setBusy(true); setErr('')

    try {
      if (isNew) {
        const payload = {
          station_id: user.station_id,
          name: name.trim(),
          phone: phone.trim() || null,
          company: company.trim() || null,
          customer_type: type,
          card_number: cardNumber.trim() || null,
          credit_limit: Number(creditLimit) || 0,
          notes: notes.trim() || null,
          registered_by: user.id,
          is_active: true,
        }

        // Supervisors/Ambassadors insert as pending; managers insert as active
        if (isManager) {
          payload.portal_enabled = portalEnabled
        }

        const { error } = await supabase.from('customers').insert(payload)
        if (error) throw error
      } else {
        const payload = {
          name: name.trim(),
          phone: phone.trim() || null,
          company: company.trim() || null,
          customer_type: type,
          card_number: cardNumber.trim() || null,
          credit_limit: Number(creditLimit) || 0,
          notes: notes.trim() || null,
        }
        if (isManager) payload.portal_enabled = portalEnabled

        const { error } = await supabase.from('customers').update(payload).eq('id', customer.id)
        if (error) throw error
      }

      onSaved()
    } catch (e) {
      setErr(e.message || 'Save failed')
      setBusy(false)
    }
  }

  return (
    <div className="modal-bg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <h3>{isNew ? 'Add Customer' : 'Edit ' + customer.name}</h3>
        <div className="modal-sub">
          {isNew && !isManager ? 'Will be sent to manager for approval' : 'Customer details'}
        </div>

        <label>Name</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Kampala Coach Ltd" />

        <label>Phone</label>
        <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+256…" />

        <label>Company (optional)</label>
        <input value={company} onChange={e => setCompany(e.target.value)} />

        <label>Type</label>
        <select value={type} onChange={e => setType(e.target.value)}>
          <option value="card">Card holder</option>
          <option value="cash">Cash customer</option>
          <option value="credit">Credit customer</option>
        </select>

        <label>Fuel card number (optional)</label>
        <input value={cardNumber} onChange={e => setCardNumber(e.target.value)} placeholder="e.g. TXL-004512 or card ID" />

        <label>Credit limit (UGX)</label>
        <input type="number" value={creditLimit} onChange={e => setCreditLimit(e.target.value)} />

        <label>Notes</label>
        <input value={notes} onChange={e => setNotes(e.target.value)} />

        {isManager && (
          <label className="check-row" style={{ marginTop: 16 }}>
            <input type="checkbox" checked={portalEnabled} onChange={e => setPortalEnabled(e.target.checked)} />
            <span>Enable customer mini-portal access</span>
          </label>
        )}

        {err && <div className="auth-err">{err}</div>}

        <div className="modal-actions">
          <button className="btn-ghost-full" onClick={onClose}>Cancel</button>
          <button className="btn-primary-full" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : isNew ? 'Add customer' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ============================================================
   CUSTOMER DETAIL MODAL
   ============================================================ */
function CustomerDetailModal({ profile, customer, canEdit, canPay, onClose, onPay, onAddCredit, onReload }) {
  const [credits, setCredits] = useState([])
  const [payments, setPayments] = useState([])
  const [transactions, setTransactions] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('overview')

  useEffect(() => {
    async function load() {
      setLoading(true)

      const { data: cr } = await supabase
        .from('shortages_credits')
        .select('*')
        .eq('category','credit')
        .eq('subject_id', customer.id)
        .order('created_at', { ascending: false })
      setCredits(cr || [])

      const { data: pm } = await supabase
        .from('credit_payments')
        .select('*')
        .eq('customer_id', customer.id)
        .order('recorded_at', { ascending: false })
      setPayments(pm || [])

      if (customer.card_number) {
        const { data: tx } = await supabase
          .from('v_customer_transactions')
          .select('*')
          .eq('card_number', customer.card_number)
          .order('txn_at', { ascending: false })
          .limit(100)
        setTransactions(tx || [])
      }

      setLoading(false)
    }
    load()
  }, [customer.id])

  return (
    <div className="modal-bg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal modal-wide">
        <h3>{customer.name}</h3>
        <div className="modal-sub">
          {customer.phone || '—'} {customer.company ? '· ' + customer.company : ''} · {customer.customer_type}
        </div>

        <div className="dashboard-grid" style={{ padding: '0 0 20px', gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <div className="stat-card">
            <div className="stat-title">Credit given</div>
            <div className="stat-value">UGX {Number(customer.totalCredit || 0).toLocaleString()}</div>
          </div>
          <div className="stat-card">
            <div className="stat-title">Paid</div>
            <div className="stat-value">UGX {Number(customer.totalPaid || 0).toLocaleString()}</div>
          </div>
          <div className="stat-card">
            <div className="stat-title">Balance</div>
            <div className="stat-value" style={{ color: customer.balance > 0 ? '#dc2626' : '#10b981' }}>
              UGX {Number(customer.balance || 0).toLocaleString()}
            </div>
          </div>
        </div>

        <div className="tabs" style={{ padding: 0, marginBottom: 16 }}>
          <button className={`tab ${tab === 'overview' ? 'active' : ''}`} onClick={() => setTab('overview')}>
            <i className="fas fa-info-circle" /> Overview
          </button>
          <button className={`tab ${tab === 'credits' ? 'active' : ''}`} onClick={() => setTab('credits')}>
            <i className="fas fa-file-invoice" /> Credits
          </button>
          <button className={`tab ${tab === 'payments' ? 'active' : ''}`} onClick={() => setTab('payments')}>
            <i className="fas fa-money-bill" /> Payments
          </button>
          {customer.card_number && (
            <button className={`tab ${tab === 'txns' ? 'active' : ''}`} onClick={() => setTab('txns')}>
              <i className="fas fa-credit-card" /> Card activity
            </button>
          )}
        </div>

        {loading ? (
          <div className="drops-empty">Loading…</div>
        ) : tab === 'overview' ? (
          <>
            <div className="result-row"><span className="lbl">Name</span><span className="val">{customer.name}</span></div>
            <div className="result-row"><span className="lbl">Phone</span><span className="val">{customer.phone || '—'}</span></div>
            <div className="result-row"><span className="lbl">Company</span><span className="val">{customer.company || '—'}</span></div>
            <div className="result-row"><span className="lbl">Type</span><span className="val">{customer.customer_type}</span></div>
            <div className="result-row"><span className="lbl">Card number</span><span className="val">{customer.card_number || '—'}</span></div>
            <div className="result-row"><span className="lbl">Credit limit</span><span className="val">UGX {Number(customer.credit_limit || 0).toLocaleString()}</span></div>
            <div className="result-row"><span className="lbl">Discount balance</span><span className="val">UGX {Number(customer.discount_balance || 0).toLocaleString()}</span></div>
            <div className="result-row"><span className="lbl">Points balance</span><span className="val">{Number(customer.points_balance || 0).toLocaleString()} pts</span></div>
            <div className="result-row"><span className="lbl">Portal access</span><span className="val">{customer.portal_enabled ? 'Enabled ✓' : 'Disabled'}</span></div>
            {customer.notes && <div className="result-row"><span className="lbl">Notes</span><span className="val">{customer.notes}</span></div>}
          </>
        ) : tab === 'credits' ? (
          credits.length === 0 ? (
            <div className="drops-empty" style={{ padding: 30 }}><h4>No credits recorded</h4></div>
          ) : (
            <div className="drops-table-wrap">
              <table className="drops-table">
                <thead><tr><th>Date</th><th>Amount</th><th>Reason</th><th>Status</th></tr></thead>
                <tbody>
                  {credits.map(cr => (
                    <tr key={cr.id}>
                      <td>{new Date(cr.created_at).toLocaleDateString('en-GB')}</td>
                      <td><strong>UGX {Number(cr.amount).toLocaleString()}</strong></td>
                      <td>{cr.reason || '—'}</td>
                      <td><span className={`pill ${cr.status === 'cleared' ? 'green' : 'amber'}`}>{cr.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : tab === 'payments' ? (
          payments.length === 0 ? (
            <div className="drops-empty" style={{ padding: 30 }}><h4>No payments recorded</h4></div>
          ) : (
            <div className="drops-table-wrap">
              <table className="drops-table">
                <thead><tr><th>Date</th><th>Amount</th><th>Note</th></tr></thead>
                <tbody>
                  {payments.map(p => (
                    <tr key={p.id}>
                      <td>{new Date(p.recorded_at).toLocaleDateString('en-GB')}</td>
                      <td><strong>UGX {Number(p.amount).toLocaleString()}</strong></td>
                      <td>{p.note || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          transactions.length === 0 ? (
            <div className="drops-empty" style={{ padding: 30 }}><h4>No card activity</h4></div>
          ) : (
            <div className="drops-table-wrap">
              <table className="drops-table">
                <thead><tr><th>Date</th><th>Kind</th><th>Product</th><th>Qty</th><th>Amount</th><th>By</th></tr></thead>
                <tbody>
                  {transactions.map((t, i) => (
                    <tr key={i}>
                      <td>{String(t.txn_at).slice(0, 16).replace('T', ' ')}</td>
                      <td><span className={`pill ${t.txn_kind === 'topup' ? 'green' : 'blue'}`}>{t.txn_kind}</span></td>
                      <td>{t.product || '—'}</td>
                      <td>{t.quantity ? Number(t.quantity).toLocaleString() : '—'}</td>
                      <td>UGX {Number(t.amount).toLocaleString()}</td>
                      <td>{t.staff_name || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}

        <div className="modal-actions" style={{ flexWrap: 'wrap' }}>
          <button className="btn-ghost-full" onClick={onClose}>Close</button>
          {canEdit && (
            <button className="btn-ghost-full" onClick={onAddCredit}>
              <i className="fas fa-plus" /> Add credit
            </button>
          )}
          {canPay && customer.balance > 0 && (
            <button className="btn-primary-full" onClick={onPay}>
              <i className="fas fa-money-bill" /> Record payment
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/* ============================================================
   PAYMENT MODAL
   ============================================================ */
function PaymentModal({ profile, customer, onClose, onSaved }) {
  const user = profile.user
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const balance = Number(customer.balance || 0)

  async function save() {
    if (!amount || Number(amount) <= 0) { setErr('Amount required'); return }
    setBusy(true); setErr('')

    const { error } = await supabase.from('credit_payments').insert({
      customer_id: customer.id,
      amount: Number(amount),
      method: 'cash',
      recorded_by: user.id,
      note: note.trim() || null,
    })
    setBusy(false)
    if (error) { setErr(error.message); return }
    onSaved()
  }

  return (
    <div className="modal-bg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <h3>Record Payment</h3>
        <div className="modal-sub">
          {customer.name} · Balance <strong>UGX {balance.toLocaleString()}</strong>
        </div>

        <label>Amount (UGX)</label>
        <input type="number" value={amount} onChange={e => setAmount(e.target.value)} />

        <div className="quick-amounts">
          <button onClick={() => setAmount(String(balance))}>Full balance</button>
          <button onClick={() => setAmount(String(Math.floor(balance / 2)))}>Half</button>
          <button onClick={() => setAmount('100000')}>100k</button>
        </div>

        <label>Note (optional)</label>
        <input value={note} onChange={e => setNote(e.target.value)} />

        {err && <div className="auth-err">{err}</div>}

        <div className="modal-actions">
          <button className="btn-ghost-full" onClick={onClose}>Cancel</button>
          <button className="btn-primary-full" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Record payment'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ============================================================
   ADD CREDIT MODAL
   ============================================================ */
function AddCreditModal({ profile, customer, onClose, onSaved }) {
  const user = profile.user
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function save() {
    if (!amount || Number(amount) <= 0) { setErr('Amount required'); return }
    setBusy(true); setErr('')

    const { error } = await supabase.from('shortages_credits').insert({
      station_id: user.station_id,
      kind: 'credit',
      category: 'credit',
      subject_type: 'customer',
      subject_id: customer.id,
      amount: Number(amount),
      reason: reason.trim() || 'Fuel on credit',
      status: 'pending',
      raised_by: user.id,
    })
    setBusy(false)
    if (error) { setErr(error.message); return }
    onSaved()
  }

  return (
    <div className="modal-bg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <h3>Add Credit</h3>
        <div className="modal-sub">Adds to {customer.name}'s credit balance</div>

        <label>Amount (UGX)</label>
        <input type="number" value={amount} onChange={e => setAmount(e.target.value)} />

        <label>Reason</label>
        <input value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Fuel on credit" />

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