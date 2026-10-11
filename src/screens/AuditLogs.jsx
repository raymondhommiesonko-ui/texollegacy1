import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabase'

const TABLE_OPTIONS = [
  'users', 'shifts', 'shift_roster', 'shift_balances', 'shift_line_items',
  'money_drops', 'attendance', 'transactions',
  'fuel_cards', 'card_transactions', 'card_sales', 'card_topups', 'card_uploads',
  'customers', 'shortages_credits', 'shortage_payments', 'credit_payments',
  'incidents', 'incident_approvals',
  'balance_entries', 'balance_expenses', 'balance_credits',
  'pumps', 'stations', 'stock_items', 'stock_deliveries',
  'notifications', 'theme_requests',
]

const ACTION_OPTIONS = ['insert', 'update', 'delete']

export default function AuditLogs({ profile }) {
  const user = profile.user
  const access = user.access_score ?? 30
  const canView = user.role === 'admin' || user.role === 'manager' || access >= 80

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [detail, setDetail] = useState(null)
  const [filters, setFilters] = useState({
    search: '', table: 'all', action: 'all', from: '', to: '',
  })

  async function load() {
    setLoading(true); setError('')

    let q = supabase
      .from('audit_log')
      .select(`
        *,
        actor:users!audit_log_actor_id_fkey(id, name, role, initials)
      `)
      .order('created_at', { ascending: false })
      .limit(500)

    if (filters.table !== 'all')  q = q.eq('table_name', filters.table)
    if (filters.action !== 'all') q = q.eq('action', filters.action)
    if (filters.from)             q = q.gte('created_at', filters.from + 'T00:00:00')
    if (filters.to)               q = q.lte('created_at', filters.to   + 'T23:59:59')

    const { data, error } = await q
    if (error) setError(error.message)
    setRows(data || [])
    setLoading(false)
  }

  useEffect(() => { if (canView) load() },
    [filters.table, filters.action, filters.from, filters.to, canView])

  const filtered = useMemo(() => {
    if (!filters.search) return rows
    const q = filters.search.toLowerCase()
    return rows.filter(r =>
      (r.actor?.name || '').toLowerCase().includes(q) ||
      (r.table_name  || '').toLowerCase().includes(q) ||
      (r.record_id   || '').toLowerCase().includes(q) ||
      (r.action      || '').toLowerCase().includes(q)
    )
  }, [rows, filters.search])

  if (!canView) {
    return (
      <div className="drops-empty">
        <i className="fas fa-lock" />
        <h4>Access denied</h4>
        <p>Audit logs require Manager or Admin access.</p>
      </div>
    )
  }

  return (
    <div className="drops-screen">
      <div className="drops-head">
        <div>
          <h3>Audit Logs</h3>
          <div className="sub">Every change · who · what · when · immutable</div>
        </div>
        <div className="drops-actions">
          <button className="btn-ghost" onClick={() => exportCSV(filtered)}>
            <i className="fas fa-file-csv" /> Export CSV
          </button>
          <button className="btn-ghost" onClick={load}>
            <i className="fas fa-rotate" /> Refresh
          </button>
        </div>
      </div>

      <div className="drops-filters">
        <input
          placeholder="Search name, table, id…"
          value={filters.search}
          onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
        />
        <select value={filters.table} onChange={e => setFilters(f => ({ ...f, table: e.target.value }))}>
          <option value="all">All tables</option>
          {TABLE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={filters.action} onChange={e => setFilters(f => ({ ...f, action: e.target.value }))}>
          <option value="all">All actions</option>
          {ACTION_OPTIONS.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <input type="date" value={filters.from} onChange={e => setFilters(f => ({ ...f, from: e.target.value }))} />
        <input type="date" value={filters.to}   onChange={e => setFilters(f => ({ ...f, to:   e.target.value }))} />
        <button className="btn-ghost btn-sm"
          onClick={() => setFilters({ search: '', table: 'all', action: 'all', from: '', to: '' })}>
          Clear
        </button>
      </div>

      {loading ? (
        <div className="drops-empty">Loading…</div>
      ) : error ? (
        <div className="drops-empty">
          <i className="fas fa-triangle-exclamation" />
          <h4>Error loading audit log</h4>
          <p>{error}</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="drops-empty">
          <i className="fas fa-history" />
          <h4>No audit entries</h4>
          <p>Actions appear here automatically as the team uses the portal.</p>
        </div>
      ) : (
        <div className="drops-table-wrap">
          <table className="drops-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>User</th>
                <th>Action</th>
                <th>Table</th>
                <th>Record</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.id}>
                  <td style={{ whiteSpace: 'nowrap', fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>
                    {new Date(r.created_at).toLocaleString('en-GB', {
                      day: '2-digit', month: 'short',
                      hour: '2-digit', minute: '2-digit', second: '2-digit'
                    })}
                  </td>
                  <td>
                    {r.actor?.name || <span style={{ color: '#8ba0b9' }}>system / SQL</span>}
                    {r.actor?.role && (
                      <div style={{ fontSize: 11, color: '#6b85a0', textTransform: 'capitalize' }}>
                        {r.actor.role}
                      </div>
                    )}
                  </td>
                  <td><span className={`pill ${actionClass(r.action)}`}>{r.action}</span></td>
                  <td><span className="code-pill">{r.table_name || '—'}</span></td>
                  <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>
                    {r.record_id ? String(r.record_id).slice(0, 8) + '…' : '—'}
                  </td>
                  <td>
                    <button className="btn-tiny" onClick={() => setDetail(r)}>
                      <i className="fas fa-eye" /> View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {detail && <DetailModal row={detail} onClose={() => setDetail(null)} />}
    </div>
  )
}

/* ============================================================
   DETAIL MODAL — old_data / new_data diff
   ============================================================ */
function DetailModal({ row, onClose }) {
  return (
    <div className="modal-bg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ maxWidth: 720 }}>
        <h3>Audit entry #{row.id}</h3>
        <div className="modal-sub">
          {new Date(row.created_at).toLocaleString('en-GB')}
        </div>

        <div className="result-row"><span className="lbl">User</span><span className="val">{row.actor?.name || 'system / SQL'}</span></div>
        <div className="result-row"><span className="lbl">Role</span><span className="val">{row.actor?.role || '—'}</span></div>
        <div className="result-row"><span className="lbl">Action</span><span className="val"><span className={`pill ${actionClass(row.action)}`}>{row.action}</span></span></div>
        <div className="result-row"><span className="lbl">Table</span><span className="val"><span className="code-pill">{row.table_name}</span></span></div>
        <div className="result-row"><span className="lbl">Record ID</span><span className="val" style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>{row.record_id || '—'}</span></div>

        {row.old_data && (
          <>
            <h4 style={{ marginTop: 18, marginBottom: 8, fontSize: 13, textTransform: 'uppercase', color: '#6b85a0' }}>
              Old data
            </h4>
            <pre style={preStyle}>{JSON.stringify(row.old_data, null, 2)}</pre>
          </>
        )}

        {row.new_data && (
          <>
            <h4 style={{ marginTop: 18, marginBottom: 8, fontSize: 13, textTransform: 'uppercase', color: '#6b85a0' }}>
              New data
            </h4>
            <pre style={preStyle}>{JSON.stringify(row.new_data, null, 2)}</pre>
          </>
        )}

        <div className="modal-actions">
          <button className="btn-ghost-full" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}

const preStyle = {
  background: '#f8fafc',
  border: '1px solid #e2e8f0',
  borderRadius: 10,
  padding: 12,
  fontSize: 12,
  fontFamily: 'ui-monospace, monospace',
  maxHeight: 260,
  overflow: 'auto',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
}

function actionClass(a) {
  switch ((a || '').toLowerCase()) {
    case 'insert': return 'green'
    case 'update': return 'amber'
    case 'delete': return 'red'
    default:       return 'gray'
  }
}

function exportCSV(rows) {
  const header = 'Time,User,Role,Action,Table,Record,OldData,NewData\n'
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`
  const body = rows.map(r => [
    new Date(r.created_at).toISOString(),
    esc(r.actor?.name), esc(r.actor?.role),
    esc(r.action), esc(r.table_name), esc(r.record_id),
    esc(JSON.stringify(r.old_data || '')),
    esc(JSON.stringify(r.new_data || '')),
  ].join(',')).join('\n')

  const blob = new Blob([header + body], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `texol-audit-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}