import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabase';

export default function Balance({ profile, activeShift }) {
  const user = profile.user;
  const canManageShift = ['manager', 'admin', 'supervisor'].includes(user.role);
  const canAdd = (user.access_score ?? 30) >= 60;

  const [shift, setShift] = useState(activeShift || null);
  const [drops, setDrops] = useState([]);
  const [lineItems, setLineItems] = useState([]);
  const [attendants, setAttendants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openLine, setOpenLine] = useState(false);

  useEffect(() => {
    if (shift) return;
    async function pickShift() {
      const today = new Date().toISOString().slice(0, 10);
      const { data } = await supabase
        .from('shifts')
        .select('*')
        .eq('station_id', user.station_id)
        .eq('shift_date', today)
        .order('shift_type', { ascending: true })
        .limit(1);
      if (data?.[0]) setShift(data[0]);
    }
    pickShift();
  }, [user.station_id]);

  async function loadShiftData() {
    if (!shift) return;
    setLoading(true);

    const { data: staff } = await supabase
      .from('users')
      .select('id, name, role')
      .eq('station_id', user.station_id);
    setAttendants((staff || []).filter((u) => u.role === 'attendant'));

    const { data: ds } = await supabase
      .from('money_drops')
      .select('*')
      .eq('shift_id', shift.id)
      .eq('status', 'active');
    setDrops(ds || []);

    const { data: li } = await supabase
      .from('shift_line_items')
      .select('*')
      .eq('shift_id', shift.id)
      .order('created_at', { ascending: true });
    setLineItems(li || []);

    setLoading(false);
  }

  useEffect(() => {
    if (shift) loadShiftData();
  }, [shift?.id]);

  const attendantsBalance = useMemo(() => {
    return attendants.map((a) => {
      const myDrops = drops.filter((d) => d.attendant_id === a.id);
      const dropped = myDrops.reduce((s, d) => s + Number(d.amount), 0);
      const expected = dropped;
      return {
        id: a.id,
        name: a.name,
        drops: myDrops.length,
        expected,
        dropped,
        variance: expected - dropped,
        hasFinal: myDrops.some((d) => d.is_final),
      };
    });
  }, [attendants, drops]);

  const totals = useMemo(() => {
    const totalDrops = drops.reduce((s, d) => s + Number(d.amount), 0);
    const transactions = lineItems
      .filter((l) => l.kind === 'transaction')
      .reduce((s, l) => s + Number(l.amount), 0);
    const expenses = lineItems
      .filter((l) => l.kind === 'expense')
      .reduce((s, l) => s + Number(l.amount), 0);
    return {
      totalDrops,
      transactions,
      expenses,
      net: transactions - expenses,
    };
  }, [drops, lineItems]);

  async function closeShiftNow() {
    if (!confirm('Close this shift now?')) return;
    const { error } = await supabase
      .from('shifts')
      .update({ status: 'closed' })
      .eq('id', shift.id);
    if (error) {
      alert(error.message);
      return;
    }
    alert('Shift closed.');
    loadShiftData();
  }

  if (!shift) {
    return (
      <div className="balance-screen">
        <div className="balance-empty">
          <i className="fas fa-cash-register" />
          <h4>No shift to balance</h4>
          <p>Create a shift first on the Timetable screen.</p>
        </div>
      </div>
    );
  }

  const statusPill = {
    open: { text: 'Open', cls: 'green' },
    pending_open: { text: 'Pending open', cls: 'amber' },
    pending_close: { text: 'Pending close', cls: 'amber' },
    closed: { text: 'Closed', cls: 'gray' },
  }[shift.status] || { text: shift.status, cls: 'gray' };

  return (
    <div className="balance-screen">
      <div className="balance-head">
        <div>
          <h3>Shift Balance</h3>
          <div className="sub">
            {shift.shift_date} · {String(shift.shift_type).toUpperCase()} ·{' '}
            <span className={`pill ${statusPill.cls}`}>{statusPill.text}</span>
          </div>
        </div>
        {canAdd && (
          <button className="btn-primary" onClick={() => setOpenLine(true)}>
            <i className="fas fa-plus" /> Add line item
          </button>
        )}
      </div>

      <div className="dashboard-grid">
        <Stat
          label="Drops total"
          value={`UGX ${totals.totalDrops.toLocaleString()}`}
          sub={`${drops.length} drops`}
        />
        <Stat
          label="Transactions in"
          value={`UGX ${totals.transactions.toLocaleString()}`}
          sub="Line items"
        />
        <Stat
          label="Expenses"
          value={`UGX ${totals.expenses.toLocaleString()}`}
          sub="Line items"
        />
        <Stat
          label="Net (in − out)"
          value={`UGX ${totals.net.toLocaleString()}`}
        />
      </div>

      <div className="section-title">Attendant balance</div>
      {loading ? (
        <div className="balance-empty">Loading…</div>
      ) : attendantsBalance.length === 0 ? (
        <div className="balance-empty">
          <i className="fas fa-users" />
          <h4>No attendants to balance</h4>
        </div>
      ) : (
        <div className="balance-table-wrap">
          <table className="balance-table">
            <thead>
              <tr>
                <th>Attendant</th>
                <th>Drops</th>
                <th>Expected</th>
                <th>Dropped</th>
                <th>Variance</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {attendantsBalance.map((a) => (
                <tr key={a.id}>
                  <td>
                    <strong>{a.name}</strong>
                  </td>
                  <td>{a.drops}</td>
                  <td>UGX {a.expected.toLocaleString()}</td>
                  <td>UGX {a.dropped.toLocaleString()}</td>
                  <td>
                    <span
                      className={`pill ${a.variance === 0 ? 'green' : 'red'}`}
                    >
                      {a.variance === 0
                        ? '0 ✓'
                        : `UGX ${a.variance.toLocaleString()}`}
                    </span>
                  </td>
                  <td>
                    <span className={`pill ${a.hasFinal ? 'green' : 'amber'}`}>
                      {a.hasFinal ? 'final recorded' : 'pending final'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="section-title">Line items · transactions & expenses</div>
      {lineItems.length === 0 ? (
        <div className="balance-empty">
          <i className="fas fa-list" />
          <h4>No line items</h4>
          <p>Add a transaction or expense to track cash in / cash out.</p>
        </div>
      ) : (
        <div className="line-items-list">
          {lineItems.map((li) => (
            <div key={li.id} className="line-item-row">
              <span className="desc">{li.description}</span>
              <span
                className={`pill ${li.kind === 'expense' ? 'red' : 'blue'}`}
              >
                {li.kind || 'item'}
              </span>
              <span className={`amt ${li.kind === 'expense' ? 'out' : 'in'}`}>
                {li.kind === 'expense' ? '−' : '+'} UGX{' '}
                {Number(li.amount).toLocaleString()}
              </span>
              <span
                className={`pill ${
                  li.status === 'approved' ? 'green' : 'amber'
                }`}
              >
                {li.status || 'approved'}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Close shift — available to supervisor, manager, admin */}
      {canManageShift &&
        (shift.status === 'open' || shift.status === 'pending_close') && (
          <div style={{ padding: '24px 32px' }}>
            <button
              className="btn-primary-full"
              style={{ background: '#dc2626', color: '#fff' }}
              onClick={closeShiftNow}
            >
              <i className="fas fa-lock" /> Close shift
            </button>
          </div>
        )}

      {openLine && (
        <AddLineItemModal
          shiftId={shift.id}
          profile={profile}
          onClose={() => setOpenLine(false)}
          onSaved={async () => {
            setOpenLine(false);
            await loadShiftData();
          }}
        />
      )}
    </div>
  );
}

/* ============================================================
   ADD LINE ITEM MODAL
   ============================================================ */
function AddLineItemModal({ shiftId, profile, onClose, onSaved }) {
  const user = profile.user;
  const isManager = user.role === 'manager' || user.role === 'admin';
  const [kind, setKind] = useState('transaction');
  const [desc, setDesc] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function save() {
    if (!desc.trim()) {
      setErr('Description required');
      return;
    }
    if (!amount || Number(amount) <= 0) {
      setErr('Amount must be positive');
      return;
    }
    setBusy(true);
    setErr('');

    const { error } = await supabase.from('shift_line_items').insert({
      shift_id: shiftId,
      kind,
      item_type: kind,
      description: desc.trim(),
      amount: Number(amount),
      requested_by: user.id,
      approved_by: isManager ? user.id : null,
      status: isManager ? 'approved' : 'pending',
    });
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    onSaved();
  }

  return (
    <div
      className="modal-bg"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal">
        <h3>Add Line Item</h3>
        <div className="modal-sub">
          {isManager ? 'Added as approved' : 'Sent to manager for approval'}
        </div>

        <label>Kind</label>
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="transaction">Transaction (cash in)</option>
          <option value="expense">Expense (cash out)</option>
        </select>

        <label>Description</label>
        <input
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          placeholder="e.g. Opening float"
        />

        <label>Amount (UGX)</label>
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />

        {err && <div className="auth-err">{err}</div>}

        <div className="modal-actions">
          <button className="btn-ghost-full" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary-full" onClick={save} disabled={busy}>
            {busy ? (
              'Saving…'
            ) : (
              <>
                <i className="fas fa-check" /> Add
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   STAT
   ============================================================ */
function Stat({ label, value, sub }) {
  return (
    <div className="stat-card">
      <div className="stat-title">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}
