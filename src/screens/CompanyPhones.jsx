import { useEffect, useState } from 'react'
import { supabase } from '../supabase'

export default function CompanyPhones({ profile }) {
  const user = profile.user
  const canEdit = ['admin','manager'].includes(user.role)

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [openAdd, setOpenAdd] = useState(false)

  async function loadAll() {
    setLoading(true)
    const { data } = await supabase
      .from('company_devices')
      .select('*, users(name)')
      .eq('station_id', user.station_id)
      .order('added_at', { ascending: false })
    setRows(data || [])
    setLoading(false)
  }

  useEffect(() => { loadAll() }, [user.station_id])

  async function toggleActive(id, current) {
    await supabase.from('company_devices').update({ is_active: !current }).eq('id', id)
    loadAll()
  }

  async function remove(id) {
    if (!confirm('Remove this device?')) return
    await supabase.from('company_devices').delete().eq('id', id)
    loadAll()
  }

  return (
    <div className="phones-screen">
      <div className="phones-head">
        <div>
          <h3>Company Phones</h3>
          <div className="sub">
            Only whitelisted devices show the transaction popup · {rows.filter(r => r.is_active).length} active
          </div>
        </div>
        {canEdit && (
          <button className="btn-primary" onClick={() => setOpenAdd(true)}>
            <i className="fas fa-plus" /> Add phone
          </button>
        )}
      </div>

      <div className="card-panel" style={{ gridTemplateColumns: '1fr', paddingBottom: 20 }}>
        <div className="card">
          <h3><i className="fas fa-mobile-alt" /> This device's fingerprint</h3>
          <div className="field-hint">
            <i className="fas fa-info-circle" />
            <div>
              <div>Device fingerprint identifies this specific phone.</div>
              <div style={{ marginTop: 8, fontFamily: 'ui-monospace, monospace', fontSize: 13, wordBreak: 'break-all' }}>
                <strong>{getFingerprint()}</strong>
              </div>
              <div style={{ marginTop: 8, fontSize: 12 }}>
                Copy this and paste it when adding a new company phone from any admin phone.
              </div>
            </div>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="drops-empty">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="drops-empty">
          <i className="fas fa-mobile-alt" />
          <h4>No company phones yet</h4>
          <p>Add one to enable transaction popups.</p>
        </div>
      ) : (
        <div className="drops-table-wrap">
          <table className="drops-table">
            <thead>
              <tr>
                <th>Label</th>
                <th>Fingerprint</th>
                <th>Status</th>
                <th>Added by</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td><strong>{r.device_label}</strong></td>
                  <td><span className="code-pill" style={{ fontSize: 11 }}>{r.device_fingerprint}</span></td>
                  <td>
                    <span className={`pill ${r.is_active ? 'green' : 'gray'}`}>
                      {r.is_active ? 'active' : 'inactive'}
                    </span>
                  </td>
                  <td>{r.users?.name || '—'}</td>
                  <td>
                    {canEdit && (
                      <>
                        <button className="btn-tiny" onClick={() => toggleActive(r.id, r.is_active)}>
                          <i className={`fas ${r.is_active ? 'fa-pause' : 'fa-play'}`} />
                        </button>
                        <button className="btn-tiny danger" onClick={() => remove(r.id)}>
                          <i className="fas fa-trash" />
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {openAdd && (
        <AddPhoneModal
          profile={profile}
          onClose={() => setOpenAdd(false)}
          onSaved={async () => { setOpenAdd(false); await loadAll() }}
        />
      )}
    </div>
  )
}

function AddPhoneModal({ profile, onClose, onSaved }) {
  const user = profile.user
  const [label, setLabel] = useState('')
  const [fingerprint, setFingerprint] = useState(getFingerprint())
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function save() {
    if (!label.trim()) { setErr('Label required'); return }
    if (!fingerprint.trim()) { setErr('Fingerprint required'); return }
    setBusy(true); setErr('')
    const { error } = await supabase.from('company_devices').insert({
      station_id: user.station_id,
      device_label: label.trim(),
      device_fingerprint: fingerprint.trim(),
      is_active: true,
      added_by: user.id,
    })
    setBusy(false)
    if (error) { setErr(error.message); return }
    onSaved()
  }

  return (
    <div className="modal-bg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <h3>Add Company Phone</h3>
        <div className="modal-sub">Whitelists a device to receive popups</div>

        <label>Label</label>
        <input value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Front-desk phone, Supervisor's phone" />

        <label>Fingerprint</label>
        <input
          value={fingerprint}
          onChange={e => setFingerprint(e.target.value)}
          style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13 }}
        />
        <div className="field-hint" style={{ marginTop: 8 }}>
          <i className="fas fa-info-circle" />
          <div>
            Leave this as is to whitelist <strong>this</strong> phone. To whitelist another phone,
            open the app there, copy its fingerprint from the same page, and paste it here.
          </div>
        </div>

        {err && <div className="auth-err">{err}</div>}

        <div className="modal-actions">
          <button className="btn-ghost-full" onClick={onClose}>Cancel</button>
          <button className="btn-primary-full" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Add phone'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* Generate and cache a stable fingerprint in localStorage */
function getFingerprint() {
  const key = 'texol_device_fingerprint'
  let fp = localStorage.getItem(key)
  if (!fp) {
    fp = 'dev-' + Math.random().toString(36).slice(2, 10) + '-' + Date.now().toString(36)
    localStorage.setItem(key, fp)
  }
  return fp
}