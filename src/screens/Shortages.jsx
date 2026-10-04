import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabase'

export default function Shortages({ profile }) {
  const user = profile.user
  const isManager = ['admin','manager'].includes(user.role)
  const isSupervisor = user.role === 'supervisor'
  const canSeeAll = isManager || isSupervisor || (profile.powers?.view_all_shortages)

  const [tab, setTab] = useState(canSeeAll ? 'staff' : 'me')
  const [staffRows, setStaffRows] = useState([])
  const [customerRows, setCustomerRows] = useState([])
  const [myStaff, setMyStaff] = useState(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [openAddShortage, setOpenAddShortage] = useState(false)
  const [openAddCredit, setOpenAddCredit] = useState(false)
  const [openPayment, setOpenPayment] = useState(null)

  async function loadAll() {
    setLoading(true)

    if (canSeeAll) {
      const { data: s } = await supabase
        .from('v_staff_shortages')
        .select('*')
        .eq('station_id', user.station_id)
        .order('balance', { ascending: false })
      setStaffRows(s || [])

      const { data: c } = await supabase
        .from('v_customer_credits')
        .select('*')
        .eq('station_id', user.station_id)
        .order('balance', { ascending: false })
      setCustomerRows(c || [])
    } else {
      const { data: s } = await supabase
        .from('v_staff_shortages')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle()
      setMyStaff(s || null)
    }

    setLoading(false)
  }

  useEffect(() => { loadAll() }, [user.id, user.role])

  const filteredStaff = useMemo(() => {
    let r = staffRows.slice()
    if (search) {
      const q = search.toLowerCase()
      r = r.filter(x => (x.name || '').toLowerCase().includes(q))
    }
    return r
  }, [staffRows, search])

  const filteredCustomers = useMemo(() => {
    let r = customerRows.slice()
    if (search) {
      const q = search.toLowerCase()
      r = r.filter(x =>
        (x.name || '').toLowerCase().includes(q) ||
        (x.phone || '').toLowerCase().includes(q) ||
        (x.card_number || '').toLowerCase().includes(q)
      )
    }
    return r
  }, [customerRows, search])

  function downloadStaffCSV() {
    const header = 'Name,Role,Total Owed,Total Paid,Unpaid,Entries\n'
    const body = filteredStaff.map(s => [
      (s.name || '').replace(/,/g,''), s.role,
      Number(s.total_owed || 0), Number(s.total_paid || 0),
      Number(s.balance || 0), s.entries || 0,
    ].join(',')).join('\n')
    downloadFile(`staff-shortages-${new Date().toISOString().slice(0,10)}.csv`, header + body, 'text/csv')
  }

  function downloadCustomerCSV() {
    const header = 'Customer,Phone,Company,Card,Total Credit,Total Paid,Balance\n'
    const body = filteredCustomers.map(c => [
      (c.name || '').replace(/,/g,''), c.phone || '', (c.company || '').replace(/,/g,''),
      c.card_number || '',
      Number(c.total_credit || 0), Number(c.total_paid || 0), Number(c.balance || 0),
    ].join(',')).join('\n')
    downloadFile(`customer-credits-${new Date().toISOString().slice(0,10)}.csv`, header + body, 'text/csv')
  }

  return (
    <div className="shortages-screen">
      <div className="shortages-head">
        <div>
          <h3>Shortages &amp; Credits</h3>
          <div className="sub">
            {canSeeAll
              ? 'Per-person shortages · customer credits · payments'
              : 'Your shortage balance and payment history'}
          </div>
        </div>
        <div className="shortages-actions">
          {canSeeAll && tab === 'staff' && (
            <button className="btn-ghost" onClick={downloadStaffCSV}>
              <i className="fas fa-file-csv" /> Download list
            </button>
          )}
          {canSeeAll && tab === 'customers' && (
            <button className="btn-ghost" onClick={downloadCustomerCSV}>
              <i className="fas fa-file-csv" /> Download list
            </button>
          )}
          {canSeeAll && (
            <>
              <button className="btn-ghost" onClick={() => setOpenAddCredit(true)}>
                <i className="fas fa-plus" /> Add credit
              </button>
              <button className="btn-primary" onClick={() => setOpenAddShortage(true)}>
                <i className="fas fa-plus" /> Add shortage
              </button>
            </>
          )}
          {!canSeeAll && (
            <button className="btn-primary" onClick={() => setOpenPayment({ type: 'staff', row: myStaff })}>
              <i className="fas fa-money-bill" /> I paid
            </button>
          )}
        </div>
      </div>

      {canSeeAll && (
        <div className="tabs" style={{ paddingTop: 0 }}>
          <button className={`tab ${tab === 'staff' ? 'active' : ''}`} onClick={() => setTab('staff')}>
            <i className="fas fa-user-tie" /> Staff shortages
          </button>
          <button className={`tab ${tab === 'customers' ? 'active' : ''}`} onClick={() => setTab('customers')}>
            <i className="fas fa-users" /> Customer credits
          </button>
        </div>
      )}

      {canSeeAll && (
        <div className="staff-filters">
          <input
            placeholder="Search name, phone, or card…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <button className="btn-ghost btn-sm" onClick={() => setSearch('')}>Clear</button>
        </div>
      )}

      {loading ? (
        <div className="drops-empty">Loading…</div>
      ) : !canSeeAll ? (
        <MyShortageView myStaff={myStaff} onPaid={() => setOpenPayment({ type: 'staff', row: myStaff })} />
      ) : tab === 'staff' ? (
        <StaffTable rows={filteredStaff} onPay={row => setOpenPayment({ type: 'staff', row })} />
      ) : (
        <CustomerTable rows={filteredCustomers} onPay={row => setOpenPayment({ type: 'credit', row })} />
      )}

      {openAddShortage && (
        <AddShortageModal
          profile={profile}
          onClose={() => setOpenAddShortage(false)}
          onSaved={async () => { setOpenAddShortage(false); await loadAll() }}
        />
      )}
      {openAddCredit && (
        <AddCreditModal
          profile={profile}
          onClose={() => setOpenAddCredit(false)}
          onSaved={async () => { setOpenAddCredit(false); await loadAll() }}
        />
      )}
      {openPayment && (
        <PaymentModal
          profile={profile}
          payment={openPayment}
          onClose={() => setOpenPayment(null)}
          onSaved={async () => { setOpenPayment(null); await loadAll() }}
        />
      )}
    </div>
  )
}

/* ============================================================
   MY SHORTAGE VIEW (attendant/ambassador)
   ============================================================ */
function MyShortageView({ myStaff, onPaid }) {
  const [entries, setEntries] = useState([])
  const [payments, setPayments] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      if (!myStaff?.user_id) { setLoading(false); return }
      const { data: e } = await supabase
        .from('shortages_credits')
        .select('*')
        .eq('category','shortage')
        .eq('subject_id', myStaff.user_id)
        .order('created_at', { ascending: false })
      setEntries(e || [])

      const { data: p } = await supabase
        .from('shortage_payments')
        .select('*')
        .eq('subject_user_id', myStaff.user_id)
        .order('submitted_at', { ascending: false })
      setPayments(p || [])
      setLoading(false)
    }
    load()
  }, [myStaff?.user_id])

  return (
    <>
      <div className="dashboard-grid">
        <Stat label="Your total owed" value={`UGX ${Number(myStaff?.total_owed || 0).toLocaleString()}`} sub={`${myStaff?.entries || 0} entries`} />
        <Stat label="You have paid" value={`UGX ${Number(myStaff?.total_paid || 0).toLocaleString()}`} sub="Approved payments" />
        <Stat label="Current balance" value={`UGX ${Number(myStaff?.balance || 0).toLocaleString()}`} sub={myStaff?.balance > 0 ? 'Still owed' : 'All clear ✓'} />
      </div>

      <div className="section-title">Your shortage entries</div>
      {loading ? (
        <div className="drops-empty">Loading…</div>
      ) : entries.length === 0 ? (
        <div className="drops-empty"><i className="fas fa-check-circle" /><h4>No shortages recorded</h4><p>Keep it that way!</p></div>
      ) : (
        <div className="drops-table-wrap">
          <table className="drops-table">
            <thead><tr><th>Date</th><th>Amount</th><th>Reason</th><th>Status</th></tr></thead>
            <tbody>
              {entries.map(e => (
                <tr key={e.id}>
                  <td>{new Date(e.created_at).toLocaleDateString('en-GB')}</td>
                  <td><strong>UGX {Number(e.amount).toLocaleString()}</strong></td>
                  <td>{e.reason || '—'}</td>
                  <td><span className={`pill ${e.status === 'cleared' ? 'green' : 'amber'}`}>{e.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="section-title">Your payments</div>
      {payments.length === 0 ? (
        <div className="drops-empty"><i className="fas fa-receipt" /><h4>No payments yet</h4></div>
      ) : (
        <div className="drops-table-wrap">
          <table className="drops-table">
            <thead><tr><th>Date</th><th>Amount</th><th>Status</th><th>Note</th></tr></thead>
            <tbody>
              {payments.map(p => (
                <tr key={p.id}>
                  <td>{new Date(p.submitted_at).toLocaleDateString('en-GB')}</td>
                  <td><strong>UGX {Number(p.amount).toLocaleString()}</strong></td>
                  <td><span className={`pill ${
                    p.status === 'approved' ? 'green' : p.status === 'rejected' ? 'red' : 'amber'
                  }`}>{p.status}</span></td>
                  <td>{p.note || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

/* ============================================================
   STAFF TABLE
   ============================================================ */
function StaffTable({ rows, onPay }) {
  if (rows.length === 0) return <div className="drops-empty"><i className="fas fa-user-tie" /><h4>No shortages</h4></div>

  return (
    <div className="drops-table-wrap">
      <table className="drops-table">
        <thead>
          <tr>
            <th>Staff</th>
            <th>Role</th>
            <th>Total owed</th>
            <th>Total paid</th>
            <th>Balance</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.user_id}>
              <td><strong>{r.name}</strong></td>
              <td><span className={`pill ${
                r.role === 'attendant' ? 'blue' :
                r.role === 'ambassador' ? 'green' :
                r.role === 'supervisor' ? 'amber' : 'gold'
              }`}>{r.role}</span></td>
              <td>UGX {Number(r.total_owed || 0).toLocaleString()}</td>
              <td>UGX {Number(r.total_paid || 0).toLocaleString()}</td>
              <td>
                <span className={`pill ${Number(r.balance || 0) === 0 ? 'green' : 'red'}`}>
                  UGX {Number(r.balance || 0).toLocaleString()}
                </span>
              </td>
              <td>
                {Number(r.balance || 0) > 0 && (
                  <button className="btn-tiny success" onClick={() => onPay(r)}>
                    <i className="fas fa-money-bill" /> Record payment
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ============================================================
   CUSTOMER TABLE
   ============================================================ */
function CustomerTable({ rows, onPay }) {
  if (rows.length === 0) return <div className="drops-empty"><i className="fas fa-users" /><h4>No customer credits</h4></div>

  return (
    <div className="drops-table-wrap">
      <table className="drops-table">
        <thead>
          <tr>
            <th>Customer</th>
            <th>Phone</th>
            <th>Card</th>
            <th>Credit given</th>
            <th>Paid</th>
            <th>Balance</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(c => (
            <tr key={c.customer_id}>
              <td><strong>{c.name}</strong><br /><span style={{fontSize:11,color:'#8ba0b9'}}>{c.company || ''}</span></td>
              <td>{c.phone || '—'}</td>
              <td>{c.card_number ? <span className="code-pill" style={{fontSize:11}}>{c.card_number}</span> : '—'}</td>
              <td>UGX {Number(c.total_credit || 0).toLocaleString()}</td>
              <td>UGX {Number(c.total_paid || 0).toLocaleString()}</td>
              <td>
                <span className={`pill ${Number(c.balance || 0) === 0 ? 'green' : 'red'}`}>
                  UGX {Number(c.balance || 0).toLocaleString()}
                </span>
              </td>
              <td>
                {Number(c.balance || 0) > 0 && (
                  <button className="btn-tiny success" onClick={() => onPay(c)}>
                    <i className="fas fa-money-bill" /> Payment
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ============================================================
   ADD SHORTAGE
   ============================================================ */
function AddShortageModal({ profile, onClose, onSaved }) {
  const user = profile.user
  const [staff, setStaff] = useState([])
  const [subjectId, setSubjectId] = useState('')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('users')
        .select('id, name, role')
        .eq('station_id', user.station_id)
        .neq('role','admin')
        .eq('is_active', true)
        .order('name')
      setStaff(data || [])
    }
    load()
  }, [user.station_id])

  async function save() {
    if (!subjectId) { setErr('Pick a staff member'); return }
    if (!amount || Number(amount) <= 0) { setErr('Amount required'); return }
    setBusy(true); setErr('')

    const { error } = await supabase.from('shortages_credits').insert({
      station_id: user.station_id,
      kind: 'shortage',
      category: 'shortage',
      subject_type: 'attendant',
      subject_id: subjectId,
      amount: Number(amount),
      reason: reason.trim() || 'Shortage recorded',
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
        <h3>Add Shortage</h3>
        <div className="modal-sub">Assigns a shortage to a staff member</div>

        <label>Staff member</label>
        <select value={subjectId} onChange={e => setSubjectId(e.target.value)}>
          <option value="">— Pick —</option>
          {staff.map(s => <option key={s.id} value={s.id}>{s.name} ({s.role})</option>)}
        </select>

        <label>Amount (UGX)</label>
        <input type="number" value={amount} onChange={e => setAmount(e.target.value)} />

        <label>Reason</label>
        <input value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Cash short at balance" />

        {err && <div className="auth-err">{err}</div>}

        <div className="modal-actions">
          <button className="btn-ghost-full" onClick={onClose}>Cancel</button>
          <button className="btn-primary-full" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Add shortage'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ============================================================
   ADD CREDIT
   ============================================================ */
function AddCreditModal({ profile, onClose, onSaved }) {
  const user = profile.user
  const [customers, setCustomers] = useState([])
  const [customerId, setCustomerId] = useState('')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('customers')
        .select('id, name, phone, card_number')
        .eq('station_id', user.station_id)
        .eq('is_active', true)
        .order('name')
      setCustomers(data || [])
    }
    load()
  }, [user.station_id])

  async function save() {
    if (!customerId) { setErr('Pick a customer'); return }
    if (!amount || Number(amount) <= 0) { setErr('Amount required'); return }
    setBusy(true); setErr('')

    const { error } = await supabase.from('shortages_credits').insert({
      station_id: user.station_id,
      kind: 'credit',
      category: 'credit',
      subject_type: 'customer',
      subject_id: customerId,
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
        <div className="modal-sub">Adds to a customer's credit balance</div>

        <label>Customer</label>
        <select value={customerId} onChange={e => setCustomerId(e.target.value)}>
          <option value="">— Pick —</option>
          {customers.map(c => <option key={c.id} value={c.id}>{c.name} · {c.phone || ''}</option>)}
        </select>

        <label>Amount (UGX)</label>
        <input type="number" value={amount} onChange={e => setAmount(e.target.value)} />

        <label>Reason</label>
        <input value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Fuel on credit · Sept" />

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
   PAYMENT MODAL
   ============================================================ */
function PaymentModal({ profile, payment, onClose, onSaved }) {
  const user = profile.user
  const { type, row } = payment
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const name = row?.name || '—'
  const balance = Number(row?.balance || 0)
  const autoApprove = ['admin','manager','supervisor'].includes(user.role)

  async function save() {
    if (!amount || Number(amount) <= 0) { setErr('Amount required'); return }
    setBusy(true); setErr('')

    if (type === 'staff') {
      const { error } = await supabase.from('shortage_payments').insert({
        subject_user_id: row.user_id,
        amount: Number(amount),
        method: 'cash',
        submitted_by: user.id,
        approved_by: autoApprove ? user.id : null,
        approved_at: autoApprove ? new Date().toISOString() : null,
        status: autoApprove ? 'approved' : 'pending',
        note: note.trim() || null,
      })
      if (error) { setErr(error.message); setBusy(false); return }
    } else {
      const { error } = await supabase.from('credit_payments').insert({
        customer_id: row.customer_id,
        amount: Number(amount),
        method: 'cash',
        recorded_by: user.id,
        note: note.trim() || null,
      })
      if (error) { setErr(error.message); setBusy(false); return }
    }

    setBusy(false)
    onSaved()
  }

  return (
    <div className="modal-bg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <h3>Record Payment</h3>
        <div className="modal-sub">
          {name} · Current balance: <strong>UGX {balance.toLocaleString()}</strong>
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

        {!autoApprove && (
          <div className="field-hint" style={{ marginTop: 12 }}>
            <i className="fas fa-info-circle" /> Your payment will be sent to a supervisor for approval.
          </div>
        )}

        {err && <div className="auth-err">{err}</div>}

        <div className="modal-actions">
          <button className="btn-ghost-full" onClick={onClose}>Cancel</button>
          <button className="btn-primary-full" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : autoApprove ? 'Record payment' : 'Submit for approval'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ============================================================
   HELPERS
   ============================================================ */
function downloadFile(name, content, type) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

function Stat({ label, value, sub }) {
  return (
    <div className="stat-card">
      <div className="stat-title">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  )
}