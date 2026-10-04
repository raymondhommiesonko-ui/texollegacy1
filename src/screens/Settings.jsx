import { useEffect, useState } from 'react'
import { supabase } from '../supabase'

export default function Settings({ profile }) {
  const user = profile.user
  const isManager = ['admin','manager'].includes(user.role)

  return (
    <div className="settings-screen">
      <div className="screen-head">
        <div>
          <h3>Settings</h3>
          <div className="sub">Company phones, integration, and preferences</div>
        </div>
      </div>

      <div className="card-panel" style={{ gridTemplateColumns: '1fr' }}>
        <CompanyPhones profile={profile} canManage={isManager} />
      </div>

      <div className="card-panel" style={{ gridTemplateColumns: '1fr' }}>
        <SMSIntegration profile={profile} />
      </div>
    </div>
  )
}

/* ============================================================
   COMPANY PHONES
   ============================================================ */
function CompanyPhones({ profile, canManage }) {
  const user = profile.user
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [newLabel, setNewLabel] = useState('')
  const [newFingerprint, setNewFingerprint] = useState('')
  const [busy, setBusy] = useState(false)

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('company_devices')
      .select('*')
      .eq('station_id', user.station_id)
      .order('added_at', { ascending: false })
    setRows(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [user.station_id])

  async function add() {
    if (!newLabel.trim()) return
    setBusy(true)
    const { error } = await supabase.from('company_devices').insert({
      station_id: user.station_id,
      device_label: newLabel.trim(),
      device_fingerprint: newFingerprint.trim() || null,
      added_by: user.id,
    })
    setBusy(false)
    if (error) { alert(error.message); return }
    setNewLabel(''); setNewFingerprint('')
    await load()
  }

  async function toggleActive(d) {
    await supabase.from('company_devices').update({ is_active: !d.is_active }).eq('id', d.id)
    await load()
  }

  async function remove(d) {
    if (!confirm(`Remove "${d.device_label}"?`)) return
    await supabase.from('company_devices').delete().eq('id', d.id)
    await load()
  }

  return (
    <div className="card">
      <h3><i className="fas fa-mobile-alt" /> Company phones</h3>
      <div className="sub" style={{ color: '#6b85a0', fontSize: 13, marginBottom: 14 }}>
        Only these devices show the real-time transaction popup. Others can view the log but won't be interrupted.
      </div>

      {canManage && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
          <input
            placeholder="Device label (e.g. Airtel phone, Supervisor phone)"
            value={newLabel}
            onChange={e => setNewLabel(e.target.value)}
            style={{ flex: 1, minWidth: 200, padding: '10px 14px', borderRadius: 10, border: '1px solid #e2e8f0', fontFamily: 'inherit' }}
          />
          <input
            placeholder="Device fingerprint (optional)"
            value={newFingerprint}
            onChange={e => setNewFingerprint(e.target.value)}
            style={{ flex: 1, minWidth: 200, padding: '10px 14px', borderRadius: 10, border: '1px solid #e2e8f0', fontFamily: 'inherit' }}
          />
          <button className="btn-primary" onClick={add} disabled={busy || !newLabel.trim()}>
            <i className="fas fa-plus" /> Add device
          </button>
        </div>
      )}

      {loading ? (
        <div className="drops-empty">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="drops-empty">
          <i className="fas fa-mobile-alt" />
          <h4>No company phones registered</h4>
          <p>Add phones that should receive popups. Others won't be disturbed.</p>
        </div>
      ) : (
        <div className="drops-table-wrap">
          <table className="drops-table">
            <thead>
              <tr>
                <th>Label</th>
                <th>Fingerprint</th>
                <th>Added</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(d => (
                <tr key={d.id}>
                  <td><strong>{d.device_label}</strong></td>
                  <td><span style={{ fontFamily: 'monospace', fontSize: 12 }}>{d.device_fingerprint || '—'}</span></td>
                  <td>{new Date(d.added_at).toLocaleDateString('en-GB')}</td>
                  <td>
                    <span className={`pill ${d.is_active ? 'green' : 'red'}`}>
                      {d.is_active ? 'active' : 'inactive'}
                    </span>
                  </td>
                  <td>
                    {canManage && (
                      <>
                        <button className="btn-tiny" onClick={() => toggleActive(d)}>
                          {d.is_active ? 'Deactivate' : 'Activate'}
                        </button>
                        <button className="btn-tiny danger" onClick={() => remove(d)}>
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
    </div>
  )
}

/* ============================================================
   SMS INTEGRATION SETUP GUIDE
   ============================================================ */
function SMSIntegration({ profile }) {
  const [copied, setCopied] = useState(false)

  const projectRef = 'tofrboakpcmjvrixxxtl'
  const fnUrl = `https://${projectRef}.supabase.co/functions/v1/ingest-sms`

  function copyUrl() {
    navigator.clipboard.writeText(fnUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="card">
      <h3><i className="fas fa-satellite-dish" /> SMS Integration — Setup Guide</h3>

      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, color: '#6b85a0', fontWeight: 700, marginBottom: 6 }}>
          Ingest URL (paste into forwarder app)
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <code style={{ background: '#f1f5f9', padding: '10px 14px', borderRadius: 10, fontSize: 12, flex: 1, minWidth: 260 }}>
            {fnUrl}
          </code>
          <button className="btn-ghost btn-sm" onClick={copyUrl}>
            <i className="fas fa-copy" /> {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>

      <div style={{ background: '#fffbeb', padding: 16, borderRadius: 12, marginBottom: 20 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>⚙️ Step-by-step setup on the company phone</div>
        <ol style={{ paddingLeft: 20, lineHeight: 1.9, fontSize: 14 }}>
          <li>Install <strong>SMS Forwarder</strong> from Play Store (free)</li>
          <li>Open the app → tap <strong>"Add Rule"</strong></li>
          <li>Set <strong>Sender filter</strong>: <code>Airtel Money</code> and <code>MTN MoMo</code> (add both)</li>
          <li>Set <strong>Forward to</strong>: <strong>Webhook</strong> → paste the Ingest URL above</li>
          <li>Method: <strong>POST</strong>, Content-Type: <strong>application/json</strong></li>
          <li>Body template:</li>
        </ol>
        <pre style={{ background: '#0b1a2e', color: '#f0c94b', padding: 14, borderRadius: 10, fontSize: 12, overflow: 'auto', marginTop: 8 }}>
{`{
  "sender": "{{sender}}",
  "body": "{{body}}",
  "station_code": "LEGACY",
  "secret": "YOUR_INGEST_SECRET"
}`}
        </pre>
        <ol start="7" style={{ paddingLeft: 20, lineHeight: 1.9, fontSize: 14, marginTop: 8 }}>
          <li>Save the rule</li>
          <li>Grant the app SMS permission and disable battery optimization for it</li>
          <li>Send a test SMS — you should see the popup on this portal within 2 seconds</li>
        </ol>
      </div>

      <div style={{ background: '#f0f4fa', padding: 16, borderRadius: 12 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>📝 Test with Hoppscotch</div>
        <div style={{ fontSize: 13, color: '#4b637c', marginBottom: 8 }}>
          Paste this into Hoppscotch to simulate an incoming SMS (change the TID for each test).
        </div>
        <pre style={{ background: '#fff', padding: 14, borderRadius: 10, fontSize: 12, overflow: 'auto', border: '1px solid #e2e8f0' }}>
{`{
  "sender": "AirtelMoney",
  "station_code": "LEGACY",
  "secret": "YOUR_INGEST_SECRET",
  "body": "RECEIVED.\\nTID999988887777\\nUGX 45,000\\nfrom 700123456\\nreferenceTEST2026.\\nBalUGX\\n100,000"
}`}
        </pre>
      </div>
    </div>
  )
}