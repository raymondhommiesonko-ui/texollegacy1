import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabase'

export default function Shifts({ profile, onOpenShift }) {
  const user = profile.user
  // All three roles can open and close shifts directly
  const canManageShift = ['manager','admin','supervisor'].includes(user.role)
  const canEdit = ['manager','admin','supervisor'].includes(user.role)
  const canViewAll = ['manager','admin','supervisor'].includes(user.role)

  const [shifts, setShifts] = useState([])
  const [usersById, setUsersById] = useState({})
  const [allUsers, setAllUsers] = useState([])
  const [roster, setRoster] = useState({})
  const [loading, setLoading] = useState(true)

  const [openNew, setOpenNew] = useState(false)
  const [openImport, setOpenImport] = useState(false)
  const [openRecurring, setOpenRecurring] = useState(false)
  const [openEditShift, setOpenEditShift] = useState(null)

  const [search, setSearch] = useState('')
  const [shiftFilter, setShiftFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [expanded, setExpanded] = useState(null)

  async function loadAll() {
    setLoading(true)

    const { data: us } = await supabase
      .from('users')
      .select('id, name, email, role, initials, station_id')
      .eq('station_id', user.station_id)
    setAllUsers(us || [])
    const map = {}
    ;(us || []).forEach(u => { map[u.id] = u })
    setUsersById(map)

    let q = supabase.from('shifts').select('*').eq('station_id', user.station_id)
    if (!canViewAll) q = q.eq('supervisor_id', user.id)
    q = q.order('shift_date', { ascending: false }).limit(80)
    const { data: sh } = await q
    setShifts(sh || [])

    if (sh && sh.length > 0) {
      const ids = sh.map(s => s.id)
      const { data: r } = await supabase
        .from('shift_roster')
        .select('shift_id, user_id, role_on_shift')
        .in('shift_id', ids)
      const grouped = {}
      ;(r || []).forEach(x => {
        if (!grouped[x.shift_id]) grouped[x.shift_id] = []
        grouped[x.shift_id].push({ user_id: x.user_id, role_on_shift: x.role_on_shift })
      })
      setRoster(grouped)
    } else {
      setRoster({})
    }

    setLoading(false)
  }

  useEffect(() => { loadAll() }, [user.id])

  const filtered = useMemo(() => {
    let rows = shifts.slice()
    if (search) {
      const q = search.toLowerCase()
      rows = rows.filter(s =>
        s.shift_date.includes(q) ||
        String(s.shift_type).toLowerCase().includes(q)
      )
    }
    if (shiftFilter !== 'all') rows = rows.filter(s => s.shift_type === shiftFilter)
    if (dateFrom) rows = rows.filter(s => s.shift_date >= dateFrom)
    if (dateTo) rows = rows.filter(s => s.shift_date <= dateTo)
    return rows
  }, [shifts, search, shiftFilter, dateFrom, dateTo])

  function exportCSV() {
    const header = 'date,shift_type,supervisor,manager,ambassador,attendants,status\n'
    const body = filtered.map(s => {
      const r = roster[s.id] || []
      const findRole = role => {
        const entry = r.find(x => x.role_on_shift === role)
        return entry ? (usersById[entry.user_id]?.name || '') : ''
      }
      const attendants = r.filter(x => x.role_on_shift === 'attendant')
        .map(x => usersById[x.user_id]?.name || '').join(';')
      return [
        s.shift_date,
        s.shift_type,
        findRole('supervisor'),
        findRole('manager'),
        findRole('ambassador'),
        `"${attendants}"`,
        s.status,
      ].join(',')
    }).join('\n')
    downloadFile('texol-timetable.csv', header + body, 'text/csv')
  }

  return (
    <div className="shifts-screen">
      <div className="shifts-head">
        <div>
          <h3>Timetable</h3>
          <div className="sub">
            {canEdit
              ? 'Create, assign, edit, import, export'
              : 'View, filter, and download the schedule'}
          </div>
        </div>
        <div className="shifts-actions">
          <button className="btn-ghost" onClick={exportCSV}>
            <i className="fas fa-file-csv" /> Export
          </button>
          {canEdit && (
            <>
              <button className="btn-ghost" onClick={() => setOpenImport(true)}>
                <i className="fas fa-upload" /> Import
              </button>
              <button className="btn-ghost" onClick={() => setOpenRecurring(true)}>
                <i className="fas fa-redo" /> Recurring
              </button>
              <button className="btn-primary" onClick={() => setOpenNew(true)}>
                <i className="fas fa-plus" /> New shift
              </button>
            </>
          )}
        </div>
      </div>

      <div className="staff-filters">
        <input
          placeholder="Search date or shift type…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select value={shiftFilter} onChange={e => setShiftFilter(e.target.value)}>
          <option value="all">All shifts</option>
          <option value="day">Day</option>
          <option value="night">Night</option>
        </select>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
        <button className="btn-ghost btn-sm" onClick={() => {
          setSearch(''); setShiftFilter('all'); setDateFrom(''); setDateTo('')
        }}>Clear</button>
      </div>

      {loading ? (
        <div className="staff-empty">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="staff-empty">
          <i className="fas fa-calendar" />
          <h4>No shifts</h4>
          <p>{canEdit ? 'Create one or import a CSV.' : 'Nothing scheduled yet.'}</p>
        </div>
      ) : (
        <div className="shift-list">
          {filtered.map(s => (
            <ShiftRow
              key={s.id}
              shift={s}
              roster={roster[s.id] || []}
              usersById={usersById}
              canManageShift={canManageShift}
              canEdit={canEdit}
              expanded={expanded === s.id}
              onToggle={() => setExpanded(expanded === s.id ? null : s.id)}
              onChanged={loadAll}
              onOpenBalance={() => onOpenShift && onOpenShift(s)}
              onEdit={() => setOpenEditShift(s)}
            />
          ))}
        </div>
      )}

      {openNew && (
        <NewShiftModal
          profile={profile}
          users={allUsers}
          onClose={() => setOpenNew(false)}
          onSaved={async () => { setOpenNew(false); await loadAll() }}
        />
      )}

      {openImport && (
        <ImportModal
          profile={profile}
          users={allUsers}
          onClose={() => setOpenImport(false)}
          onSaved={async () => { setOpenImport(false); await loadAll() }}
        />
      )}

      {openRecurring && (
        <RecurringModal
          profile={profile}
          users={allUsers}
          onClose={() => setOpenRecurring(false)}
          onSaved={async () => { setOpenRecurring(false); await loadAll() }}
        />
      )}

      {openEditShift && (
        <EditShiftModal
          profile={profile}
          users={allUsers}
          shift={openEditShift}
          roster={roster[openEditShift.id] || []}
          onClose={() => setOpenEditShift(null)}
          onSaved={async () => { setOpenEditShift(null); await loadAll() }}
        />
      )}
    </div>
  )
}

/* ============================================================
   SHIFT ROW
   ============================================================ */
function ShiftRow({ shift, roster, usersById, canManageShift, canEdit, expanded, onToggle, onChanged, onOpenBalance, onEdit }) {
  const [busy, setBusy] = useState(false)
  const supervisorEntry = roster.find(r => r.role_on_shift === 'supervisor')
  const managerEntry = roster.find(r => r.role_on_shift === 'manager')
  const ambassadorEntry = roster.find(r => r.role_on_shift === 'ambassador')
  const attendants = roster.filter(r => r.role_on_shift === 'attendant')

  const statusPill = {
    open: { text: 'Open', cls: 'green' },
    pending_open: { text: 'Pending open', cls: 'amber' },
    pending_close: { text: 'Pending close', cls: 'amber' },
    closed: { text: 'Closed', cls: 'gray' },
  }[shift.status] || { text: shift.status, cls: 'gray' }

  async function openShift() {
    if (!confirm('Open this shift now?')) return
    setBusy(true)
    await supabase.from('shifts').update({
      status: 'open',
      opened_at: new Date().toISOString(),
    }).eq('id', shift.id)
    setBusy(false)
    onChanged()
  }

  async function closeShift() {
    if (!confirm('Close this shift now?')) return
    setBusy(true)
    await supabase.from('shifts').update({ status: 'closed' }).eq('id', shift.id)
    setBusy(false)
    onChanged()
  }

  return (
    <div className="shift-card">
      <div className="shift-top" onClick={onToggle} style={{ cursor: 'pointer' }}>
        <div>
          <div className="shift-title">
            {shift.shift_date} · {String(shift.shift_type).toUpperCase()}
          </div>
          <div className="shift-meta">
            Supervisor: <strong>{supervisorEntry ? usersById[supervisorEntry.user_id]?.name : '—'}</strong>
            {' · '}Attendants: <strong>{attendants.length}</strong>
            {ambassadorEntry && <> · Ambassador: <strong>{usersById[ambassadorEntry.user_id]?.name}</strong></>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <span className={`pill ${statusPill.cls}`}>{statusPill.text}</span>
          <i className={`fas fa-chevron-${expanded ? 'up' : 'down'}`} style={{ color: '#6b85a0' }} />
        </div>
      </div>

      {expanded && (
        <div className="shift-details">
          <div className="roster-section">
            <div className="roster-title">Supervisor</div>
            <div className="roster-chips">
              {supervisorEntry ? (
                <span className="chip supervisor">{usersById[supervisorEntry.user_id]?.name || '—'}</span>
              ) : <span className="empty-chip">Not assigned</span>}
            </div>

            <div className="roster-title">Manager</div>
            <div className="roster-chips">
              {managerEntry ? (
                <span className="chip manager">{usersById[managerEntry.user_id]?.name || '—'}</span>
              ) : <span className="empty-chip">Not assigned</span>}
            </div>

            <div className="roster-title">Ambassador</div>
            <div className="roster-chips">
              {ambassadorEntry ? (
                <span className="chip ambassador">{usersById[ambassadorEntry.user_id]?.name || '—'}</span>
              ) : <span className="empty-chip">Not assigned</span>}
            </div>

            <div className="roster-title">Attendants ({attendants.length})</div>
            <div className="roster-chips">
              {attendants.length === 0
                ? <span className="empty-chip">None assigned</span>
                : attendants.map(a => (
                  <span key={a.user_id} className="chip attendant">
                    {usersById[a.user_id]?.name || '—'}
                  </span>
                ))}
            </div>
          </div>

          <div className="shift-actions" style={{ marginTop: 14 }}>
            <button className="btn-ghost btn-sm" onClick={onOpenBalance}>
              <i className="fas fa-chart-bar" /> Balance
            </button>

            {canEdit && (
              <button className="btn-ghost btn-sm" onClick={onEdit}>
                <i className="fas fa-edit" /> Edit shift
              </button>
            )}

            {/* Open a pending_open shift */}
            {canManageShift && shift.status === 'pending_open' && (
              <button className="btn-tiny success" onClick={openShift} disabled={busy}>
                <i className="fas fa-play" /> Open shift
              </button>
            )}

            {/* Close an open shift directly */}
            {canManageShift && shift.status === 'open' && (
              <button className="btn-tiny danger" onClick={closeShift} disabled={busy}>
                <i className="fas fa-lock" /> Close shift
              </button>
            )}

            {/* Close a pending_close shift (rare path) */}
            {canManageShift && shift.status === 'pending_close' && (
              <button className="btn-tiny success" onClick={closeShift} disabled={busy}>
                <i className="fas fa-check" /> Close shift
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/* ============================================================
   NEW SHIFT MODAL
   ============================================================ */
function NewShiftModal({ profile, users, onClose, onSaved }) {
  const user = profile.user
  // Anyone who can reach this modal can open directly
  const canOpenDirectly = ['manager','admin','supervisor'].includes(user.role)

  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [type, setType] = useState('day')
  const [supervisorId, setSupervisorId] = useState('')
  const [managerId, setManagerId] = useState('')
  const [ambassadorId, setAmbassadorId] = useState('')
  const [attendants, setAttendants] = useState([])
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    const sup = users.find(u => u.role === 'supervisor')
    const mgr = users.find(u => u.role === 'manager')
    if (sup) setSupervisorId(sup.id)
    if (mgr) setManagerId(mgr.id)
  }, [users])

  function toggleAttendant(id) {
    setAttendants(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  async function save() {
    if (!supervisorId) { setErr('Pick a supervisor'); return }
    setBusy(true); setErr('')

    try {
      const initialStatus = canOpenDirectly ? 'open' : 'pending_open'

      const { data: shiftData, error: sErr } = await supabase
        .from('shifts')
        .insert({
          station_id: user.station_id,
          shift_date: date,
          shift_type: type,
          supervisor_id: supervisorId,
          manager_id: managerId || null,
          ambassador_id: ambassadorId || null,
          status: initialStatus,
          open_requested_by: user.id,
          open_requested_at: new Date().toISOString(),
          opened_at: canOpenDirectly ? new Date().toISOString() : null,
          open_approved_by: canOpenDirectly ? user.id : null,
          open_approved_at: canOpenDirectly ? new Date().toISOString() : null,
          notes,
        })
        .select('id')
        .single()
      if (sErr) throw sErr

      const rows = []
      if (supervisorId) rows.push({ shift_id: shiftData.id, user_id: supervisorId, role_on_shift: 'supervisor', assigned_by: user.id })
      if (managerId)    rows.push({ shift_id: shiftData.id, user_id: managerId,    role_on_shift: 'manager',    assigned_by: user.id })
      if (ambassadorId) rows.push({ shift_id: shiftData.id, user_id: ambassadorId, role_on_shift: 'ambassador', assigned_by: user.id })
      attendants.forEach(a => rows.push({ shift_id: shiftData.id, user_id: a, role_on_shift: 'attendant', assigned_by: user.id }))

      if (rows.length > 0) {
        const { error: rErr } = await supabase.from('shift_roster').insert(rows)
        if (rErr) throw rErr
      }

      onSaved()
    } catch (e) {
      setErr(e.message || 'Save failed')
      setBusy(false)
    }
  }

  const supers = users.filter(u => u.role === 'supervisor')
  const mgrs = users.filter(u => u.role === 'manager')
  const ambs = users.filter(u => u.role === 'ambassador')
  const atts = users.filter(u => u.role === 'attendant')

  return (
    <div className="modal-bg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal modal-wide">
        <h3>{canOpenDirectly ? 'Create & Open Shift' : 'Request Shift'}</h3>
        <div className="modal-sub">
          {canOpenDirectly
            ? 'The shift opens immediately when you save.'
            : 'Assign everyone who works this shift'}
        </div>

        <div className="row-2">
          <div>
            <label>Date</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <div>
            <label>Shift type</label>
            <select value={type} onChange={e => setType(e.target.value)}>
              <option value="day">Day</option>
              <option value="night">Night</option>
            </select>
          </div>
        </div>

        <label>Supervisor</label>
        <select value={supervisorId} onChange={e => setSupervisorId(e.target.value)}>
          <option value="">— Choose —</option>
          {supers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>

        <label>Manager on shift</label>
        <select value={managerId} onChange={e => setManagerId(e.target.value)}>
          <option value="">— None —</option>
          {mgrs.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>

        <label>Ambassador</label>
        <select value={ambassadorId} onChange={e => setAmbassadorId(e.target.value)}>
          <option value="">— None —</option>
          {ambs.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>

        <label>Attendants ({attendants.length} selected)</label>
        <div className="attendant-picker">
          {atts.length === 0 && <div className="empty-chip">No attendants in this station</div>}
          {atts.map(u => (
            <label key={u.id} className={`power-item ${attendants.includes(u.id) ? 'checked' : ''}`}>
              <input type="checkbox" checked={attendants.includes(u.id)} onChange={() => toggleAttendant(u.id)} />
              <span>{u.name}</span>
            </label>
          ))}
        </div>

        <label>Notes (optional)</label>
        <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. delivery expected at noon" />

        {err && <div className="auth-err">{err}</div>}

        <div className="modal-actions">
          <button className="btn-ghost-full" onClick={onClose}>Cancel</button>
          <button className="btn-primary-full" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : canOpenDirectly ? 'Create & open' : 'Request shift'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ============================================================
   EDIT SHIFT MODAL
   ============================================================ */
function EditShiftModal({ profile, users, shift, roster, onClose, onSaved }) {
  const user = profile.user

  const [date, setDate] = useState(shift.shift_date)
  const [type, setType] = useState(shift.shift_type)
  const [notes, setNotes] = useState(shift.notes || '')

  const findRoster = role => roster.find(r => r.role_on_shift === role)?.user_id || ''

  const [supervisorId, setSupervisorId] = useState(findRoster('supervisor'))
  const [managerId, setManagerId] = useState(findRoster('manager'))
  const [ambassadorId, setAmbassadorId] = useState(findRoster('ambassador'))
  const [attendants, setAttendants] = useState(
    roster.filter(r => r.role_on_shift === 'attendant').map(r => r.user_id)
  )

  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  function toggleAttendant(id) {
    setAttendants(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  async function save() {
    if (!supervisorId) { setErr('Pick a supervisor'); return }
    setBusy(true); setErr('')

    try {
      const { error: sErr } = await supabase
        .from('shifts')
        .update({
          shift_date: date,
          shift_type: type,
          supervisor_id: supervisorId,
          manager_id: managerId || null,
          ambassador_id: ambassadorId || null,
          notes,
        })
        .eq('id', shift.id)
      if (sErr) throw sErr

      await supabase.from('shift_roster').delete().eq('shift_id', shift.id)

      const rows = []
      if (supervisorId) rows.push({ shift_id: shift.id, user_id: supervisorId, role_on_shift: 'supervisor', assigned_by: user.id })
      if (managerId)    rows.push({ shift_id: shift.id, user_id: managerId,    role_on_shift: 'manager',    assigned_by: user.id })
      if (ambassadorId) rows.push({ shift_id: shift.id, user_id: ambassadorId, role_on_shift: 'ambassador', assigned_by: user.id })
      attendants.forEach(a => rows.push({ shift_id: shift.id, user_id: a, role_on_shift: 'attendant', assigned_by: user.id }))

      if (rows.length > 0) {
        const { error: rErr } = await supabase.from('shift_roster').insert(rows)
        if (rErr) throw rErr
      }

      onSaved()
    } catch (e) {
      setErr(e.message || 'Save failed')
      setBusy(false)
    }
  }

  const supers = users.filter(u => u.role === 'supervisor')
  const mgrs = users.filter(u => u.role === 'manager')
  const ambs = users.filter(u => u.role === 'ambassador')
  const atts = users.filter(u => u.role === 'attendant')

  return (
    <div className="modal-bg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal modal-wide">
        <h3>Edit Shift — {shift.shift_date}</h3>
        <div className="modal-sub">Change any field including date, type, and full roster</div>

        <div className="row-2">
          <div>
            <label>Date</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <div>
            <label>Shift type</label>
            <select value={type} onChange={e => setType(e.target.value)}>
              <option value="day">Day</option>
              <option value="night">Night</option>
            </select>
          </div>
        </div>

        <label>Supervisor</label>
        <select value={supervisorId} onChange={e => setSupervisorId(e.target.value)}>
          <option value="">— Choose —</option>
          {supers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>

        <label>Manager on shift</label>
        <select value={managerId} onChange={e => setManagerId(e.target.value)}>
          <option value="">— None —</option>
          {mgrs.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>

        <label>Ambassador</label>
        <select value={ambassadorId} onChange={e => setAmbassadorId(e.target.value)}>
          <option value="">— None —</option>
          {ambs.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>

        <label>Attendants ({attendants.length} selected)</label>
        <div className="attendant-picker">
          {atts.map(u => (
            <label key={u.id} className={`power-item ${attendants.includes(u.id) ? 'checked' : ''}`}>
              <input type="checkbox" checked={attendants.includes(u.id)} onChange={() => toggleAttendant(u.id)} />
              <span>{u.name}</span>
            </label>
          ))}
        </div>

        <label>Notes</label>
        <input value={notes} onChange={e => setNotes(e.target.value)} />

        {err && <div className="auth-err">{err}</div>}

        <div className="modal-actions">
          <button className="btn-ghost-full" onClick={onClose}>Cancel</button>
          <button className="btn-primary-full" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ============================================================
   IMPORT MODAL
   ============================================================ */
function ImportModal({ profile, users, onClose, onSaved }) {
  const user = profile.user
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [preview, setPreview] = useState([])

  function downloadTemplate() {
    const tpl = `date,shift_type,supervisor_email,manager_email,ambassador_email,attendant_emails,notes
2026-09-22,day,supervisor@texol.ug,manager@texol.ug,ambassador@texol.ug,"attendant1@texol.ug;attendant2@texol.ug",
`
    downloadFile('texol-timetable-template.csv', tpl, 'text/csv')
  }

  async function handleFile(file) {
    if (!file) return
    setErr('')
    const text = await file.text()
    const rows = text.split('\n').map(r => r.trim()).filter(r => r && !r.startsWith('date,'))
    const parsed = rows.map(r => {
      const matches = r.match(/("([^"]*)"|[^,]+)(,|$)/g) || []
      const cells = matches.map(m => m.replace(/,$/,'').replace(/^"|"$/g,'').trim())
      return {
        date: cells[0] || '',
        shift_type: cells[1] || 'day',
        supervisor_email: cells[2] || '',
        manager_email: cells[3] || '',
        ambassador_email: cells[4] || '',
        attendant_emails: (cells[5] || '').split(';').map(x => x.trim()).filter(Boolean),
        notes: cells[6] || '',
      }
    }).filter(r => r.date && r.supervisor_email)
    setPreview(parsed)
  }

  async function importAll() {
    if (preview.length === 0) return
    setBusy(true); setErr('')

    try {
      for (const row of preview) {
        const sup = users.find(u => u.email === row.supervisor_email)
        const mgr = users.find(u => u.email === row.manager_email)
        const amb = users.find(u => u.email === row.ambassador_email)
        const atts = row.attendant_emails.map(e => users.find(u => u.email === e)).filter(Boolean)

        if (!sup) continue

        const { data: shiftData, error: sErr } = await supabase
          .from('shifts')
          .insert({
            station_id: user.station_id,
            shift_date: row.date,
            shift_type: row.shift_type,
            supervisor_id: sup.id,
            manager_id: mgr?.id || null,
            ambassador_id: amb?.id || null,
            status: 'pending_open',
            open_requested_by: user.id,
            open_requested_at: new Date().toISOString(),
            notes: row.notes,
          })
          .select('id')
          .single()
        if (sErr) throw sErr

        const rosterRows = []
        rosterRows.push({ shift_id: shiftData.id, user_id: sup.id, role_on_shift: 'supervisor', assigned_by: user.id })
        if (mgr) rosterRows.push({ shift_id: shiftData.id, user_id: mgr.id, role_on_shift: 'manager', assigned_by: user.id })
        if (amb) rosterRows.push({ shift_id: shiftData.id, user_id: amb.id, role_on_shift: 'ambassador', assigned_by: user.id })
        atts.forEach(a => rosterRows.push({ shift_id: shiftData.id, user_id: a.id, role_on_shift: 'attendant', assigned_by: user.id }))

        if (rosterRows.length > 0) {
          const { error: rErr } = await supabase.from('shift_roster').insert(rosterRows)
          if (rErr) throw rErr
        }
      }
      onSaved()
    } catch (e) {
      setErr(e.message || 'Import failed')
      setBusy(false)
    }
  }

  return (
    <div className="modal-bg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal modal-wide">
        <h3>Import Timetable</h3>
        <div className="modal-sub">Upload a CSV file (opens in Excel and Word)</div>

        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          <button className="btn-ghost" onClick={downloadTemplate}>
            <i className="fas fa-download" /> Download CSV template
          </button>
        </div>

        <label>Upload file</label>
        <input
          type="file"
          accept=".csv,.txt,.xlsx,.xls,.doc,.docx"
          onChange={e => handleFile(e.target.files?.[0])}
        />

        {preview.length > 0 && (
          <>
            <div className="section-title" style={{ padding: '20px 0 10px' }}>
              Preview · {preview.length} shifts
            </div>
            <div className="import-preview">
              {preview.map((r, i) => (
                <div key={i} className="import-row">
                  <strong>{r.date} · {r.shift_type}</strong>
                  <div className="import-detail">
                    Supervisor: {r.supervisor_email}<br />
                    Manager: {r.manager_email || '—'}<br />
                    Ambassador: {r.ambassador_email || '—'}<br />
                    Attendants: {r.attendant_emails.join(', ') || '—'}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {err && <div className="auth-err">{err}</div>}

        <div className="modal-actions">
          <button className="btn-ghost-full" onClick={onClose}>Cancel</button>
          <button
            className="btn-primary-full"
            onClick={importAll}
            disabled={busy || preview.length === 0}
          >
            {busy ? 'Importing…' : `Import ${preview.length} shifts`}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ============================================================
   RECURRING MODAL
   ============================================================ */
function RecurringModal({ profile, users, onClose, onSaved }) {
  const user = profile.user
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [patterns, setPatterns] = useState([])
  const [staffId, setStaffId] = useState('')
  const [dow, setDow] = useState(1)
  const [shiftType, setShiftType] = useState('day')
  const [roleOnShift, setRoleOnShift] = useState('attendant')

  async function loadPatterns() {
    const { data } = await supabase
      .from('recurring_schedules')
      .select('*, user:users(name, role)')
      .eq('station_id', user.station_id)
      .eq('is_active', true)
    setPatterns(data || [])
  }

  useEffect(() => { loadPatterns() }, [])

  async function addPattern() {
    if (!staffId) { setErr('Pick a staff member'); return }
    setBusy(true); setErr('')

    const { error } = await supabase.from('recurring_schedules').insert({
      station_id: user.station_id,
      user_id: staffId,
      day_of_week: dow,
      shift_type: shiftType,
      role_on_shift: roleOnShift,
      created_by: user.id,
    })
    setBusy(false)
    if (error) { setErr(error.message); return }
    setStaffId('')
    await loadPatterns()
  }

  async function removePattern(id) {
    await supabase.from('recurring_schedules').update({ is_active: false }).eq('id', id)
    await loadPatterns()
  }

  const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']

  return (
    <div className="modal-bg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal modal-wide">
        <h3>Recurring Schedule</h3>
        <div className="modal-sub">"Nathan works every Monday day shift"</div>

        <div className="row-2">
          <div>
            <label>Staff</label>
            <select value={staffId} onChange={e => setStaffId(e.target.value)}>
              <option value="">— Choose —</option>
              {users.filter(u => u.role !== 'admin').map(u => (
                <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
              ))}
            </select>
          </div>
          <div>
            <label>Day of week</label>
            <select value={dow} onChange={e => setDow(Number(e.target.value))}>
              {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
            </select>
          </div>
        </div>

        <div className="row-2">
          <div>
            <label>Shift type</label>
            <select value={shiftType} onChange={e => setShiftType(e.target.value)}>
              <option value="day">Day</option>
              <option value="night">Night</option>
            </select>
          </div>
          <div>
            <label>Role on shift</label>
            <select value={roleOnShift} onChange={e => setRoleOnShift(e.target.value)}>
              <option value="attendant">Attendant</option>
              <option value="ambassador">Ambassador</option>
              <option value="supervisor">Supervisor</option>
              <option value="manager">Manager</option>
            </select>
          </div>
        </div>

        <button className="btn-primary" onClick={addPattern} disabled={busy}>
          <i className="fas fa-plus" /> Add pattern
        </button>

        <div className="section-title" style={{ padding: '20px 0 10px' }}>Active patterns</div>
        {patterns.length === 0 ? (
          <div className="empty-chip">No recurring patterns yet</div>
        ) : (
          <div className="pattern-list">
            {patterns.map(p => (
              <div key={p.id} className="pattern-row">
                <div>
                  <strong>{p.user?.name}</strong> · {DAYS[p.day_of_week]} · {p.shift_type} · {p.role_on_shift}
                </div>
                <button className="btn-tiny danger" onClick={() => removePattern(p.id)}>
                  <i className="fas fa-trash" />
                </button>
              </div>
            ))}
          </div>
        )}

        {err && <div className="auth-err">{err}</div>}

        <div className="modal-actions">
          <button className="btn-ghost-full" onClick={onClose}>Close</button>
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