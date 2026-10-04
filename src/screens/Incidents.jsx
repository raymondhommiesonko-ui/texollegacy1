import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabase'

export default function Incidents({ profile }) {
  const user = profile.user
  const isManager = ['admin','manager'].includes(user.role)
  const isSupervisor = user.role === 'supervisor'
  const canCreate = isManager || isSupervisor

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [openCreate, setOpenCreate] = useState(false)
  const [openDetail, setOpenDetail] = useState(null)

  async function loadAll() {
    setLoading(true)
    const { data, error } = await supabase
      .from('v_incidents_full')
      .select('*')
      .eq('station_id', user.station_id)
      .order('created_at', { ascending: false })
    if (error) { console.error(error); setLoading(false); return }
    setRows(data || [])
    setLoading(false)
  }

  useEffect(() => { loadAll() }, [user.station_id])

  const filtered = useMemo(() => {
    let r = rows.slice()
    if (search) {
      const q = search.toLowerCase()
      r = r.filter(x =>
        (x.reference || '').toLowerCase().includes(q) ||
        (x.title || '').toLowerCase().includes(q) ||
        (x.subject?.name || '').toLowerCase().includes(q)
      )
    }
    if (typeFilter !== 'all') r = r.filter(x => x.incident_type === typeFilter)
    if (statusFilter !== 'all') r = r.filter(x => x.final_status === statusFilter)
    return r
  }, [rows, search, typeFilter, statusFilter])

  const stats = useMemo(() => ({
    total: rows.length,
    pending: rows.filter(r => r.final_status === 'pending').length,
    approved: rows.filter(r => r.final_status === 'approved').length,
    rejected: rows.filter(r => r.final_status === 'rejected').length,
  }), [rows])

  return (
    <div className="incidents-screen">
      <div className="incidents-head">
        <div>
          <h3>Warnings &amp; Incidents</h3>
          <div className="sub">
            {stats.total} total · {stats.pending} pending · {stats.approved} approved · {stats.rejected} rejected
          </div>
        </div>
        {canCreate && (
          <button className="btn-primary" onClick={() => setOpenCreate(true)}>
            <i className="fas fa-plus" /> New incident
          </button>
        )}
      </div>

      <div className="staff-filters">
        <input placeholder="Search reference, title, or name…" value={search} onChange={e => setSearch(e.target.value)} />
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          <option value="all">All types</option>
          <option value="warning">Warnings</option>
          <option value="incident">Incidents</option>
          <option value="commendation">Commendations</option>
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="all">All statuses</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
        <button className="btn-ghost btn-sm" onClick={() => { setSearch(''); setTypeFilter('all'); setStatusFilter('all') }}>Clear</button>
      </div>

      {loading ? (
        <div className="drops-empty">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="drops-empty">
          <i className="fas fa-exclamation-triangle" />
          <h4>No incidents yet</h4>
          <p>Create one to get started.</p>
        </div>
      ) : (
        <div className="drops-table-wrap">
          <table className="drops-table">
            <thead>
              <tr>
                <th>Ref</th>
                <th>Type</th>
                <th>Subject</th>
                <th>Title</th>
                <th>Raised by</th>
                <th>Approval</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.id}>
                  <td><span className="code-pill" style={{fontSize:11}}>{r.reference}</span></td>
                  <td>
                    <span className={`pill ${
                      r.incident_type === 'warning' ? 'amber' :
                      r.incident_type === 'incident' ? 'red' : 'green'
                    }`}>{r.incident_type}</span>
                  </td>
                  <td><strong>{r.subject?.name || '—'}</strong></td>
                  <td>{r.title}</td>
                  <td>{r.raiser?.name || '—'}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {[1,2,3].map(s => {
                        const done = s <= r.current_stage && r.final_status !== 'rejected'
                        const rejected = r.final_status === 'rejected' && s === r.current_stage + 1
                        return (
                          <span key={s} className={`pill ${rejected ? 'red' : done ? 'green' : 'gray'}`} style={{ fontSize: 10, padding: '2px 6px' }}>{s}</span>
                        )
                      })}
                    </div>
                  </td>
                  <td>
                    <span className={`pill ${
                      r.final_status === 'approved' ? 'green' :
                      r.final_status === 'rejected' ? 'red' : 'amber'
                    }`}>{r.final_status}</span>
                  </td>
                  <td>
                    <button className="btn-tiny" onClick={() => setOpenDetail(r)}>
                      <i className="fas fa-eye" /> View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {openCreate && (
        <CreateIncidentModal
          profile={profile}
          onClose={() => setOpenCreate(false)}
          onSaved={async () => { setOpenCreate(false); await loadAll() }}
        />
      )}

      {openDetail && (
        <IncidentDetailModal
          profile={profile}
          incident={openDetail}
          onClose={() => setOpenDetail(null)}
          onChanged={async () => { setOpenDetail(null); await loadAll() }}
        />
      )}
    </div>
  )
}

function CreateIncidentModal({ profile, onClose, onSaved }) {
  const user = profile.user
  const [staff, setStaff] = useState([])
  const [subjectId, setSubjectId] = useState('')
  const [type, setType] = useState('warning')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
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
    if (!title.trim()) { setErr('Title required'); return }
    setBusy(true); setErr('')
    const { error } = await supabase.from('incidents').insert({
      reference: '',
      station_id: user.station_id,
      incident_type: type,
      subject_user_id: subjectId,
      raised_by: user.id,
      title: title.trim(),
      description: description.trim() || null,
    })
    setBusy(false)
    if (error) { setErr(error.message); return }
    onSaved()
  }

  return (
    <div className="modal-bg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <h3>New Warning / Incident</h3>
        <div className="modal-sub">Needs 3 approvals: Supervisor → Manager → Admin</div>

        <label>Type</label>
        <select value={type} onChange={e => setType(e.target.value)}>
          <option value="warning">Warning</option>
          <option value="incident">Incident</option>
          <option value="commendation">Commendation</option>
        </select>

        <label>Employee (subject)</label>
        <select value={subjectId} onChange={e => setSubjectId(e.target.value)}>
          <option value="">— Pick —</option>
          {staff.map(s => <option key={s.id} value={s.id}>{s.name} ({s.role})</option>)}
        </select>

        <label>Title</label>
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Late coming × 3" />

        <label>Description</label>
        <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Full details…" />

        {err && <div className="auth-err">{err}</div>}

        <div className="modal-actions">
          <button className="btn-ghost-full" onClick={onClose}>Cancel</button>
          <button className="btn-primary-full" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}

function IncidentDetailModal({ profile, incident, onClose, onChanged }) {
  const user = profile.user
  const [approvals, setApprovals] = useState([])
  const [loading, setLoading] = useState(true)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function loadApprovals() {
    setLoading(true)
    const { data } = await supabase
      .from('incident_approvals')
      .select('*, approver:users!incident_approvals_approver_id_fkey(name)')
      .eq('incident_id', incident.id)
      .order('stage')
    setApprovals(data || [])
    setLoading(false)
  }

  useEffect(() => { loadApprovals() }, [incident.id])

  const canApprove = useMemo(() => {
    const role = user.role
    const nextStage = incident.current_stage + 1
    if (incident.final_status !== 'pending') return false
    if (nextStage === 1 && ['supervisor','manager','admin'].includes(role)) return true
    if (nextStage === 2 && ['manager','admin'].includes(role)) return true
    if (nextStage === 3 && role === 'admin') return true
    return false
  }, [incident, user.role])

  async function approve() {
    setBusy(true); setErr('')
    const { data, error } = await supabase.rpc('approve_incident', {
      p_incident: incident.id,
      p_comment: comment || null,
    })
    setBusy(false)
    if (error) { setErr(error.message); return }
    if (!data?.ok) { setErr(data?.error || 'Could not approve'); return }
    onChanged()
  }

  async function reject() {
    if (!confirm('Reject this incident?')) return
    setBusy(true); setErr('')
    const { data, error } = await supabase.rpc('reject_incident', {
      p_incident: incident.id,
      p_comment: comment || null,
    })
    setBusy(false)
    if (error) { setErr(error.message); return }
    if (!data?.ok) { setErr(data?.error || 'Could not reject'); return }
    onChanged()
  }

  return (
    <div className="modal-bg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal modal-wide">
        <h3>{incident.title}</h3>
        <div className="modal-sub">
          <span className="code-pill" style={{fontSize:11}}>{incident.reference}</span>
          {' · '}{incident.incident_type} · raised by {incident.raiser?.name}
        </div>

        <div className="result-row"><span className="lbl">Subject</span><span className="val">{incident.subject?.name}</span></div>
        <div className="result-row"><span className="lbl">Type</span><span className="val">{incident.incident_type}</span></div>
        <div className="result-row"><span className="lbl">Title</span><span className="val">{incident.title}</span></div>
        <div className="result-row"><span className="lbl">Description</span><span className="val">{incident.description || '—'}</span></div>
        <div className="result-row"><span className="lbl">Created</span><span className="val">{new Date(incident.created_at).toLocaleString('en-GB')}</span></div>
        <div className="result-row"><span className="lbl">Status</span><span className="val">{incident.final_status}</span></div>

        <h3 style={{ fontSize: 15, marginTop: 20, marginBottom: 10 }}>
          <i className="fas fa-clipboard-check" style={{ color: '#f0c94b' }} /> Approval chain
        </h3>

        {loading ? (
          <div className="drops-empty">Loading approvals…</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {approvals.map(a => (
              <div key={a.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '12px 16px', background: '#f8fafc', borderRadius: 10,
                border: '1px solid #e2e8f0',
              }}>
                <div>
                  <div style={{ fontWeight: 700, textTransform: 'capitalize' }}>Stage {a.stage} · {a.required_role}</div>
                  <div style={{ fontSize: 12, color: '#6b85a0', marginTop: 2 }}>
                    {a.approver?.name ? `by ${a.approver.name}` : 'waiting'}
                    {a.decided_at ? ' · ' + new Date(a.decided_at).toLocaleString('en-GB') : ''}
                  </div>
                  {a.comment && <div style={{ fontSize: 12, marginTop: 4 }}>"{a.comment}"</div>}
                </div>
                <span className={`pill ${
                  a.status === 'approved' ? 'green' :
                  a.status === 'rejected' ? 'red' : 'amber'
                }`}>{a.status}</span>
              </div>
            ))}
          </div>
        )}

        {canApprove && (
          <>
            <label style={{ marginTop: 20 }}>Comment (optional)</label>
            <textarea value={comment} onChange={e => setComment(e.target.value)} placeholder="Add a note for the next approver…" />

            {err && <div className="auth-err">{err}</div>}

            <div className="modal-actions">
              <button className="btn-ghost-full" style={{ background: '#fee2e2', color: '#991b1b' }} onClick={reject} disabled={busy}>
                <i className="fas fa-times" /> Reject
              </button>
              <button className="btn-primary-full" onClick={approve} disabled={busy}>
                <i className="fas fa-check" /> Approve stage {incident.current_stage + 1}
              </button>
            </div>
          </>
        )}

        {!canApprove && (
          <div className="modal-actions">
            <button className="btn-ghost-full" onClick={onClose}>Close</button>
          </div>
        )}
      </div>
    </div>
  )
}