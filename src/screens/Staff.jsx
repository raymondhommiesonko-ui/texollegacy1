import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabase'

export default function Staff({ profile }) {
  const user = profile.user
  const isAdmin = user.role === 'admin'
  const isManager = user.role === 'manager' || isAdmin
  const canCreate = isManager
  const canEdit = isManager
  const canDelete = isAdmin

  const [staff, setStaff] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('active')
  const [stationFilter, setStationFilter] = useState(user.station_id)
  const [stations, setStations] = useState([])
  const [openEdit, setOpenEdit] = useState(null)
  const [openReset, setOpenReset] = useState(null)
  const [openAccess, setOpenAccess] = useState(null)

  async function loadAll() {
    setLoading(true)

    const { data: stns } = await supabase.from('stations').select('*')
    setStations(stns || [])

    let query = supabase
      .from('users')
      .select('id, name, email, phone, role, access_score, station_id, is_active, initials, staff_number, created_at, deactivated_at, deactivation_reason')
      .order('name', { ascending: true })

    if (user.role !== 'admin' && stationFilter !== 'all') {
      query = query.eq('station_id', stationFilter)
    }

    const { data, error } = await query
    if (!error) setStaff(data || [])
    setLoading(false)
  }

  useEffect(() => { loadAll() }, [stationFilter, user.id])

  const filtered = useMemo(() => {
    let rows = staff.slice()
    if (statusFilter === 'active') rows = rows.filter(s => s.is_active)
    if (statusFilter === 'inactive') rows = rows.filter(s => !s.is_active)
    if (search) {
      const q = search.toLowerCase()
      rows = rows.filter(s =>
        (s.name || '').toLowerCase().includes(q) ||
        (s.email || '').toLowerCase().includes(q) ||
        (s.phone || '').toLowerCase().includes(q)
      )
    }
    if (roleFilter !== 'all') rows = rows.filter(s => s.role === roleFilter)
    return rows
  }, [staff, search, roleFilter, statusFilter])

  function exportCSV() {
    const header = 'Name,Email,Phone,Role,Access,Station,Status\n'
    const body = filtered.map(s => {
      const station = stations.find(st => st.id === s.station_id)
      return [
        (s.name || '').replace(/,/g, ''),
        s.email || '',
        s.phone || '',
        s.role,
        s.access_score,
        station?.name || '',
        s.is_active ? 'active' : 'inactive',
      ].join(',')
    }).join('\n')
    const blob = new Blob([header + body], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `texol-staff-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function deactivate(s) {
    const reason = prompt(`Why are you deactivating ${s.name}? (optional)`) || ''
    if (!confirm(`Deactivate ${s.name}? They will be locked out immediately.`)) return

    await supabase
      .from('users')
      .update({
        is_active: false,
        deactivated_at: new Date().toISOString(),
        deactivated_by: user.id,
        deactivation_reason: reason,
      })
      .eq('id', s.id)

    loadAll()
  }

  async function reactivate(s) {
    if (!confirm(`Reactivate ${s.name}?`)) return
    await supabase
      .from('users')
      .update({
        is_active: true,
        deactivated_at: null,
        deactivated_by: null,
        deactivation_reason: null,
      })
      .eq('id', s.id)
    loadAll()
  }

  return (
    <div className="staff-screen">
      <div className="staff-head">
        <div>
          <h3>Manage Staff</h3>
          <div className="sub">
            {staff.filter(s => s.is_active).length} active · {staff.filter(s => !s.is_active).length} inactive
          </div>
        </div>
        <div className="staff-actions">
          <button className="btn-ghost" onClick={exportCSV}>
            <i className="fas fa-file-csv" /> Export CSV
          </button>
          {canCreate && (
            <button className="btn-primary" onClick={() => setOpenEdit('new')}>
              <i className="fas fa-plus" /> Add staff
            </button>
          )}
        </div>
      </div>

      <div className="staff-filters">
        <input
          placeholder="Search name, email, phone…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)}>
          <option value="all">All roles</option>
          <option value="attendant">Attendants</option>
          <option value="ambassador">Ambassadors</option>
          <option value="supervisor">Supervisors</option>
          <option value="manager">Managers</option>
          <option value="admin">Admins</option>
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="all">All status</option>
          <option value="active">Active only</option>
          <option value="inactive">Inactive only</option>
        </select>
        {user.role === 'admin' && (
          <select value={stationFilter} onChange={e => setStationFilter(e.target.value)}>
            <option value="all">All stations</option>
            {stations.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        )}
      </div>

      {loading ? (
        <div className="staff-empty">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="staff-empty">
          <i className="fas fa-user-tie" />
          <h4>No staff found</h4>
          <p>Try adjusting filters or add a new staff member.</p>
        </div>
      ) : (
        <div className="staff-table-wrap">
          <table className="staff-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Code</th>
                <th>Role</th>
                <th>Access</th>
                <th>Phone</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(s => {
                const station = stations.find(st => st.id === s.station_id)
                return (
                  <tr key={s.id} className={!s.is_active ? 'row-inactive' : ''}>
                    <td>
                      <div className="staff-name-cell">
                        <div className="staff-avatar">
                          {s.initials || (s.name || '??').split(' ').map(n => n[0]).join('').slice(0, 2)}
                        </div>
                        <div>
                          <div className="staff-name">{s.name}</div>
                          <div className="staff-email">{s.email}</div>
                          {user.role === 'admin' && (
                            <div className="staff-station">{station?.name || '—'}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td>
                      <CodeCell staff={s} profile={profile} onChanged={loadAll} />
                    </td>
                    <td><span className={`pill ${rolePillClass(s.role)}`}>{s.role}</span></td>
                    <td><span className="pill gold">{s.access_score}%</span></td>
                    <td>{s.phone || '—'}</td>
                    <td>
                      <span className={`pill ${s.is_active ? 'green' : 'red'}`}>
                        {s.is_active ? 'active' : 'inactive'}
                      </span>
                    </td>
                    <td>
                      {canEdit && s.is_active && (
                        <button className="btn-tiny" onClick={() => setOpenEdit(s)} title="Edit">
                          <i className="fas fa-edit" />
                        </button>
                      )}
                      {canEdit && s.is_active && (
                        <button className="btn-tiny" onClick={() => setOpenAccess(s)} title="Access control">
                          <i className="fas fa-user-shield" />
                        </button>
                      )}
                      {canEdit && s.is_active && (
                        <button className="btn-tiny warn" onClick={() => setOpenReset(s)} title="Send password reset">
                          <i className="fas fa-key" />
                        </button>
                      )}
                      {canDelete && s.is_active && s.id !== user.id && (
                        <button className="btn-tiny danger" onClick={() => deactivate(s)} title="Deactivate">
                          <i className="fas fa-user-slash" />
                        </button>
                      )}
                      {canEdit && !s.is_active && (
                        <button className="btn-tiny success" onClick={() => reactivate(s)} title="Reactivate">
                          <i className="fas fa-user-check" /> Reactivate
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {openEdit && (
        <EditStaffModal
          profile={profile}
          staff={openEdit === 'new' ? null : openEdit}
          stations={stations}
          onClose={() => setOpenEdit(null)}
          onSaved={async () => { setOpenEdit(null); await loadAll() }}
        />
      )}
      {openReset && (
        <ResetPasswordModal staff={openReset} onClose={() => setOpenReset(null)} />
      )}
      {openAccess && (
        <AccessModal
          staff={openAccess}
          onClose={() => setOpenAccess(null)}
          onSaved={async () => { setOpenAccess(null); await loadAll() }}
        />
      )}
    </div>
  )
}

/* ============================================================
   CODE CELL — 2-digit code + color chip
   ============================================================ */
function CodeCell({ staff, profile, onChanged }) {
  const user = profile.user
  const canEdit = ['admin','manager','supervisor'].includes(user.role)
  const [code, setCode] = useState('')
  const [color, setColor] = useState('')
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('staff_codes')
        .select('*')
        .eq('user_id', staff.id)
        .maybeSingle()
      if (data) {
        setCode(data.code || '')
        setColor(data.color || '')
      }
      setLoaded(true)
    }
    load()
  }, [staff.id])

  async function save(newCode, newColor) {
    if (!newCode || newCode.length !== 2) {
      alert('Code must be 2 digits')
      return
    }
    setBusy(true)
    const { error } = await supabase.from('staff_codes').upsert({
      user_id: staff.id,
      station_id: staff.station_id,
      code: newCode,
      color: newColor,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })
    setBusy(false)
    if (error) { alert(error.message); return }
    onChanged && onChanged()
  }

  if (!loaded) return <span style={{ color: '#8ba0b9' }}>…</span>

  const display = code || '—'
  const chipColor = color || '#e2e8f0'

  if (!canEdit) {
    return (
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <span
          style={{
            display: 'inline-block', width: 12, height: 12, borderRadius: '50%',
            background: chipColor,
          }}
        />
        <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700 }}>{display}</span>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <span
        style={{
          display: 'inline-block', width: 12, height: 12, borderRadius: '50%',
          background: chipColor, flexShrink: 0,
        }}
      />
      <input
        type="text"
        inputMode="numeric"
        maxLength={2}
        value={code}
        onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 2))}
        onBlur={e => save(e.target.value, color)}
        style={{
          width: 44, padding: '4px 6px', textAlign: 'center',
          fontFamily: 'ui-monospace, monospace', fontWeight: 700,
          border: '1px solid #e2e8f0', borderRadius: 6, outline: 'none',
        }}
        placeholder="00"
        disabled={busy}
      />
      <input
        type="color"
        value={color || '#EF4444'}
        onChange={e => { setColor(e.target.value); save(code, e.target.value) }}
        style={{
          width: 26, height: 26, borderRadius: 6,
          border: '1px solid #e2e8f0', cursor: 'pointer', padding: 0,
        }}
      />
    </div>
  )
}

/* ============================================================
   EDIT STAFF MODAL
   ============================================================ */
function EditStaffModal({ profile, staff, stations, onClose, onSaved }) {
  const isNew = !staff
  const user = profile.user

  const [name, setName] = useState(staff?.name || '')
  const [phone, setPhone] = useState(staff?.phone || '')
  const [role, setRole] = useState(staff?.role || 'attendant')
  const [access, setAccess] = useState(staff?.access_score ?? 30)
  const [stationId, setStationId] = useState(staff?.station_id || user.station_id)
  const [email, setEmail] = useState(staff?.email || '')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  function onRoleChange(newRole) {
    setRole(newRole)
    const map = { attendant: 30, ambassador: 40, supervisor: 60, manager: 80, admin: 100 }
    setAccess(map[newRole] ?? 30)
  }

  async function save() {
    if (!name.trim()) { setErr('Name required'); return }
    if (isNew && !email.trim()) { setErr('Email required'); return }
    if (isNew && password.length < 6) { setErr('Password must be at least 6 characters'); return }

    setBusy(true); setErr('')

    try {
      if (isNew) {
        const { data: authData, error: authErr } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { name: name.trim() } },
        })
        if (authErr) throw authErr
        if (!authData.user) throw new Error('Signup failed — email may already be in use')

        await new Promise(r => setTimeout(r, 800))

        const { error: updErr } = await supabase
          .from('users')
          .update({
            name: name.trim(),
            phone: phone.trim() || null,
            role,
            access_score: access,
            station_id: stationId,
            initials: initialsOf(name),
          })
          .eq('id', authData.user.id)
        if (updErr) throw updErr
      } else {
        const { error } = await supabase
          .from('users')
          .update({
            name: name.trim(),
            phone: phone.trim() || null,
            role,
            access_score: access,
            station_id: stationId,
            initials: initialsOf(name),
          })
          .eq('id', staff.id)
        if (error) throw error
      }

      onSaved()
    } catch (e) {
      setErr(e.message || 'Something went wrong')
      setBusy(false)
    }
  }

  return (
    <div className="modal-bg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <h3>{isNew ? 'Add Staff' : 'Edit ' + staff.name}</h3>
        <div className="modal-sub">
          {isNew ? 'Creates a new login account' : 'Update profile details'}
        </div>

        <label>Full name</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Nathan Otim" />

        {isNew ? (
          <>
            <label>Email (used to log in)</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="nathan@texol.ug" />

            <label>Temporary password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 6 chars" />
          </>
        ) : (
          <>
            <label>Email (cannot be changed here)</label>
            <input value={staff.email || '—'} disabled />
            <div className="field-hint">
              <i className="fas fa-info-circle" /> Email is tied to the login account. To change it, deactivate this account and create a new one.
            </div>
          </>
        )}

        <label>Phone</label>
        <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+256…" />

        <label>Role</label>
        <select value={role} onChange={e => onRoleChange(e.target.value)}>
          <option value="attendant">Attendant</option>
          <option value="ambassador">Ambassador</option>
          <option value="supervisor">Supervisor</option>
          <option value="manager">Manager</option>
          {user.role === 'admin' && <option value="admin">Admin</option>}
        </select>

        <label>Access score (%)</label>
        <input type="number" value={access} onChange={e => setAccess(Number(e.target.value))} />

        {user.role === 'admin' && (
          <>
            <label>Station</label>
            <select value={stationId} onChange={e => setStationId(e.target.value)}>
              {stations.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </>
        )}

        {err && <div className="auth-err">{err}</div>}

        <div className="modal-actions">
          <button className="btn-ghost-full" onClick={onClose}>Cancel</button>
          <button className="btn-primary-full" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : isNew ? 'Create staff' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ============================================================
   RESET PASSWORD MODAL
   ============================================================ */
function ResetPasswordModal({ staff, onClose }) {
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [err, setErr] = useState('')

  async function sendReset() {
    if (!staff.email) { setErr('No email on file'); return }
    setBusy(true); setErr('')
    const { error } = await supabase.auth.resetPasswordForEmail(staff.email, {
      redirectTo: window.location.origin + '/?reset=1',
    })
    setBusy(false)
    if (error) { setErr(error.message); return }
    setSent(true)
  }

  return (
    <div className="modal-bg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <h3>Reset password</h3>
        <div className="modal-sub">
          A reset link will be sent to <strong>{staff.email}</strong>
        </div>

        {sent ? (
          <div className="reset-success">
            <i className="fas fa-check-circle" />
            <div>
              <strong>Reset link sent</strong>
              <p>Staff will receive an email with instructions.</p>
            </div>
          </div>
        ) : (
          <>
            {err && <div className="auth-err">{err}</div>}
            <div className="modal-actions">
              <button className="btn-ghost-full" onClick={onClose}>Cancel</button>
              <button className="btn-primary-full" onClick={sendReset} disabled={busy}>
                {busy ? 'Sending…' : <><i className="fas fa-paper-plane" /> Send reset link</>}
              </button>
            </div>
          </>
        )}

        {sent && (
          <div className="modal-actions">
            <button className="btn-primary-full" onClick={onClose}>Done</button>
          </div>
        )}
      </div>
    </div>
  )
}

/* ============================================================
   ACCESS CONTROL MODAL
   ============================================================ */
function AccessModal({ staff, onClose, onSaved }) {
  const [access, setAccess] = useState(staff.access_score ?? 30)
  const [powers, setPowers] = useState({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    async function loadPowers() {
      const { data } = await supabase
        .from('user_powers')
        .select('power_id, granted')
        .eq('user_id', staff.id)
      const map = {}
      ;(data || []).forEach(p => { map[p.power_id] = p.granted })
      setPowers(map)
    }
    loadPowers()
  }, [staff.id])

  function toggle(powerId) {
    setPowers(prev => ({ ...prev, [powerId]: !prev[powerId] }))
  }

  async function save() {
    setBusy(true); setErr('')
    try {
      await supabase.from('users').update({ access_score: access }).eq('id', staff.id)
      const rows = Object.entries(powers).map(([power_id, granted]) => ({
        user_id: staff.id,
        power_id,
        granted: !!granted,
      }))
      if (rows.length > 0) {
        await supabase.from('user_powers').upsert(rows, { onConflict: 'user_id,power_id' })
      }
      onSaved()
    } catch (e) {
      setErr(e.message || 'Save failed')
      setBusy(false)
    }
  }

  return (
    <div className="modal-bg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ maxWidth: 640 }}>
        <h3>Access control</h3>
        <div className="modal-sub"><strong>{staff.name}</strong> · {staff.role}</div>

        <label>Access score (%)</label>
        <input type="number" value={access} onChange={e => setAccess(Number(e.target.value))} />

        <div className="power-groups">
          {POWER_GROUPS.map(group => (
            <div key={group.name} className="power-group">
              <div className="power-group-title">{group.name}</div>
              <div className="power-grid">
                {group.powers.map(p => (
                  <label key={p.id} className={`power-item ${powers[p.id] ? 'checked' : ''}`}>
                    <input type="checkbox" checked={!!powers[p.id]} onChange={() => toggle(p.id)} />
                    <span>{p.label}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>

        {err && <div className="auth-err">{err}</div>}

        <div className="modal-actions">
          <button className="btn-ghost-full" onClick={onClose}>Cancel</button>
          <button className="btn-primary-full" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save access'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ============================================================
   POWER GROUPS
   ============================================================ */
const POWER_GROUPS = [
  { name: 'Viewing', powers: [
    { id: 'view_all_attendants', label: 'View all attendants performance' },
    { id: 'view_all_ambassadors', label: 'View all ambassadors performance' },
    { id: 'view_other_shifts', label: 'View other shifts & attendance' },
    { id: 'view_audit_logs', label: 'View audit logs' },
    { id: 'view_staff_list', label: 'View staff list' },
    { id: 'view_fuelcards', label: 'View uploaded fuel card files' },
    { id: 'view_customers', label: 'View customer records' },
  ]},
  { name: 'Clock In/Out', powers: [
    { id: 'clock_self', label: 'Clock in / out for self' },
    { id: 'clock_others', label: 'Clock in / out for others' },
    { id: 'approve_clockin', label: 'Approve clock-ins' },
    { id: 'view_gps', label: 'View GPS coordinates' },
    { id: 'view_photos', label: 'View clock-in selfies' },
  ]},
  { name: 'Uploads', powers: [
    { id: 'upload_targets', label: 'Upload targets' },
    { id: 'upload_timetable', label: 'Upload timetable' },
    { id: 'upload_sales_reports', label: 'Upload sales reports' },
    { id: 'upload_stock', label: 'Upload stock' },
    { id: 'upload_incidents', label: 'Upload incidents' },
    { id: 'upload_motivation', label: 'Edit motivation' },
    { id: 'upload_fuelcards', label: 'Upload fuel card data' },
    { id: 'upload_attendant_cards', label: 'Upload attendant card work' },
    { id: 'upload_staff_data', label: 'Upload staff data' },
    { id: 'upload_home_edits', label: 'Edit home content' },
    { id: 'upload_theme', label: 'Change theme' },
  ]},
  { name: 'Exports', powers: [
    { id: 'export_staff', label: 'Export staff' },
    { id: 'export_customers', label: 'Export customers' },
    { id: 'export_shortages', label: 'Export shortages' },
    { id: 'export_performance', label: 'Export performance' },
    { id: 'export_drops', label: 'Export drops' },
    { id: 'export_balance', label: 'Export balance' },
    { id: 'export_incidents', label: 'Export incidents' },
    { id: 'export_audit', label: 'Export audit' },
    { id: 'export_transactions', label: 'Export transactions to Excel' },
  ]},
  { name: 'Approvals', powers: [
    { id: 'approve_warnings', label: 'Approve warnings stage 1' },
    { id: 'approve_warnings_stage2', label: 'Approve warnings stage 2' },
    { id: 'approve_warnings_stage3', label: 'Approve warnings stage 3' },
    { id: 'approve_shortages', label: 'Approve shortages' },
    { id: 'approve_access', label: 'Approve access changes' },
    { id: 'approve_fc_uploads', label: 'Approve card uploads' },
    { id: 'approve_customers', label: 'Approve customers' },
    { id: 'approve_theme', label: 'Approve theme' },
    { id: 'approve_home_edits', label: 'Approve home edits' },
    { id: 'approve_staff_data', label: 'Approve staff data' },
    { id: 'approve_station_switch', label: 'Approve station switch' },
    { id: 'approve_balance', label: 'Approve shift close' },
  ]},
  { name: 'Money', powers: [
    { id: 'record_drops', label: 'Record money drops' },
    { id: 'close_shift', label: 'Close / balance shifts' },
    { id: 'give_discount', label: 'Give discounts' },
    { id: 'issue_cards', label: 'Issue fuel cards' },
    { id: 'topup_cards', label: 'Top up fuel cards' },
    { id: 'record_expenses', label: 'Record expenses' },
    { id: 'claim_transactions', label: 'Claim transactions' },
  ]},
  { name: 'Collect Mode', powers: [
    { id: 'use_collect_mode', label: 'Access Collect mode' },
    { id: 'link_collect_pwa', label: 'Install Collect as app' },
  ]},
  { name: 'Admin', powers: [
    { id: 'reset_passwords', label: 'Reset passwords' },
    { id: 'create_accounts', label: 'Create accounts' },
    { id: 'edit_access', label: 'Edit access control' },
    { id: 'edit_sidebar', label: 'Change sidebar color' },
    { id: 'switch_station', label: 'Switch station' },
    { id: 'send_to_hq', label: 'Send to HQ' },
  ]},
]

function initialsOf(name = '') {
  return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || '??'
}
function rolePillClass(role) {
  return {
    admin: 'red', manager: 'gold', supervisor: 'amber',
    ambassador: 'blue', attendant: 'gray',
  }[role] || 'gray'
}