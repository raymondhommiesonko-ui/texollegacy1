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
  const [openNew, setOpenNew] = useState(false)
  const [createdInfo, setCreatedInfo] = useState(null)

  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('company_phone_accounts')
      .select('*, users(id, name, email, is_active, last_login_at)')
      .eq('station_id', user.station_id)
      .order('created_at', { ascending: false })
    if (error) console.error('load phones:', error)
    setRows(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [user.station_id])

  async function toggleActive(row) {
    await supabase
      .from('users')
      .update({ is_active: !row.users?.is_active })
      .eq('id', row.user_id)
    await load()
  }

  async function removePhone(row) {
    if (!confirm(`Delete "${row.label}"? The phone will be logged out and blocked.`)) return
    await supabase.from('users').update({ is_active: false }).eq('id', row.user_id)
    await load()
  }

  return (
    <div className="card">
      <h3><i className="fas fa-mobile-alt" /> Company phones</h3>
      <div className="sub" style={{ color: '#6b85a0', fontSize: 13, marginBottom: 14 }}>
        Each company phone gets its own account. Company phones see only Home, Transactions, and Money Drops.
        Extra access is granted by Admin via Manage Staff → Access Control.
      </div>

      {canManage && (
        <div style={{ marginBottom: 20 }}>
          <button className="btn-primary" onClick={() => setOpenNew(true)}>
            <i className="fas fa-plus" /> Register a new phone
          </button>
        </div>
      )}

      {loading ? (
        <div className="drops-empty">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="drops-empty">
          <i className="fas fa-mobile-alt" />
          <h4>No phones registered</h4>
          <p>Register a phone account for each company device.</p>
        </div>
      ) : (
        <div className="drops-table-wrap">
          <table className="drops-table">
            <thead>
              <tr>
                <th>Label</th>
                <th>Login email</th>
                <th>Last login</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.user_id}>
                  <td><strong>{r.label}</strong></td>
                  <td>
                    <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>
                      {r.users?.email || '—'}
                    </span>
                  </td>
                  <td style={{ fontSize: 12, color: '#6b85a0' }}>
                    {r.users?.last_login_at
                      ? new Date(r.users.last_login_at).toLocaleString('en-GB', {
                          day: '2-digit', month: 'short',
                          hour: '2-digit', minute: '2-digit',
                        })
                      : 'never'}
                  </td>
                  <td>
                    <span className={`pill ${r.users?.is_active ? 'green' : 'red'}`}>
                      {r.users?.is_active ? 'active' : 'disabled'}
                    </span>
                  </td>
                  <td>
                    {canManage && (
                      <>
                        <button className="btn-tiny" onClick={() => toggleActive(r)}>
                          {r.users?.is_active ? 'Disable' : 'Enable'}
                        </button>
                        <button className="btn-tiny danger" onClick={() => removePhone(r)}>
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

      {openNew && (
        <RegisterPhoneModal
          profile={profile}
          onClose={() => setOpenNew(false)}
          onSaved={async (info) => {
            setOpenNew(false)
            setCreatedInfo(info)
            await load()
          }}
        />
      )}

      {createdInfo && (
        <div className="modal-bg" onClick={() => setCreatedInfo(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>
              <i className="fas fa-check-circle" style={{ color: '#10b981' }} /> Phone registered
            </h3>
            <div className="modal-sub">
              Give these credentials to the phone. Write them down — the password can't be shown again.
            </div>

            <div style={{ padding: 14, background: '#f8fafc', borderRadius: 10 }}>
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, textTransform: 'uppercase', color: '#6b85a0', fontWeight: 700 }}>Label</div>
                <div style={{ fontWeight: 700 }}>{createdInfo.label}</div>
              </div>
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, textTransform: 'uppercase', color: '#6b85a0', fontWeight: 700 }}>Login email</div>
                <div style={{ fontFamily: 'ui-monospace, monospace' }}>{createdInfo.email}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, textTransform: 'uppercase', color: '#6b85a0', fontWeight: 700 }}>Password</div>
                <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 16, fontWeight: 700 }}>{createdInfo.password}</div>
              </div>
            </div>

            <div className="modal-actions">
              <button className="btn-primary-full" onClick={() => setCreatedInfo(null)}>Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ============================================================
   REGISTER PHONE MODAL
   ============================================================ */
function RegisterPhoneModal({ profile, onClose, onSaved }) {
  const user = profile.user
  const [label, setLabel] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState(() => generatePassword())
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  function generatePassword() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
    return Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
  }

  async function save() {
    if (!label.trim()) { setErr('Label required'); return }
    if (!email.trim()) { setErr('Email required'); return }
    if (password.length < 6) { setErr('Password must be at least 6 characters'); return }
    setBusy(true); setErr('')

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Not signed in')

      const SUPABASE_URL =
        import.meta.env.VITE_SUPABASE_URL ||
        'https://tofrboakpcmjvrixxxtl.supabase.co'

      const url = `${SUPABASE_URL}/functions/v1/register-phone`

      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          password,
          label: label.trim(),
          station_id: user.station_id,
        }),
      })

      const data = await resp.json()
      if (!resp.ok || !data.ok) {
        throw new Error(data.error || 'Failed to create account')
      }

      onSaved({
        label: label.trim(),
        email: email.trim().toLowerCase(),
        password,
      })
    } catch (e) {
      setErr(e.message || 'Could not register phone')
      setBusy(false)
    }
  }

  return (
    <div className="modal-bg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <h3>Register a phone</h3>
        <div className="modal-sub">Creates a dedicated login for a company device</div>

        <label>Label</label>
        <input
          value={label}
          onChange={e => setLabel(e.target.value)}
          placeholder="e.g. Airtel phone 1, Reception"
          autoFocus
        />

        <label>Login email</label>
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="airtel-phone-1@texol.ug"
        />

        <label>Password</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={password}
            onChange={e => setPassword(e.target.value)}
            style={{ flex: 1, fontFamily: 'ui-monospace, monospace' }}
          />
          <button className="btn-ghost btn-sm" onClick={() => setPassword(generatePassword())} title="Generate new password">
            <i className="fas fa-redo" />
          </button>
        </div>

        {err && <div className="auth-err">{err}</div>}

        <div className="modal-actions">
          <button className="btn-ghost-full" onClick={onClose}>Cancel</button>
          <button className="btn-primary-full" onClick={save} disabled={busy}>
            {busy ? 'Creating…' : 'Register phone'}
          </button>
        </div>
      </div>
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
          <li>Send a test SMS — the popup should appear on all company phones within 2 seconds</li>
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