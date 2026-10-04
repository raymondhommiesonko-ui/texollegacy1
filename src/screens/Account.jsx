import { useEffect, useState } from 'react';
import { supabase } from '../supabase';

export default function Account({ profile }) {
  const user = profile.user;

  const [pwd, setPwd] = useState('');
  const [pwd2, setPwd2] = useState('');
  const [phone, setPhone] = useState(user.phone || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [success, setSuccess] = useState('');

  async function changePassword() {
    setErr('');
    setSuccess('');
    if (pwd.length < 6) {
      setErr('Password must be at least 6 characters');
      return;
    }
    if (pwd !== pwd2) {
      setErr('Passwords do not match');
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pwd });
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    setPwd('');
    setPwd2('');
    setSuccess('Password updated. Use it next time you log in.');
  }

  async function savePhone() {
    setErr('');
    setSuccess('');
    setBusy(true);
    const { error } = await supabase
      .from('users')
      .update({ phone: phone.trim() || null })
      .eq('id', user.id);
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    setSuccess('Phone number updated');
  }

  return (
    <div className="account-screen">
      <div className="account-head">
        <h3>My Account</h3>
        <div className="sub">
          Manage your profile, password, and preferences
        </div>
      </div>

      <div className="card-panel" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div className="card">
          <h3>
            <i className="fas fa-lock" /> Change password
          </h3>
          <label>New password</label>
          <input
            type="password"
            value={pwd}
            onChange={(e) => setPwd(e.target.value)}
            placeholder="At least 6 characters"
          />
          <label>Confirm new password</label>
          <input
            type="password"
            value={pwd2}
            onChange={(e) => setPwd2(e.target.value)}
            placeholder="Type it again"
          />
          <div style={{ marginTop: 16 }}>
            <button
              className="btn-primary"
              onClick={changePassword}
              disabled={busy}
            >
              {busy ? (
                'Saving…'
              ) : (
                <>
                  <i className="fas fa-check" /> Update password
                </>
              )}
            </button>
          </div>
        </div>

        <div className="card">
          <h3>
            <i className="fas fa-phone" /> Contact
          </h3>
          <label>Phone number</label>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+256…"
          />
          <div style={{ marginTop: 16 }}>
            <button className="btn-primary" onClick={savePhone} disabled={busy}>
              {busy ? (
                'Saving…'
              ) : (
                <>
                  <i className="fas fa-check" /> Save phone
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      <div className="card-panel" style={{ gridTemplateColumns: '1fr' }}>
        <div className="card">
          <h3>
            <i className="fas fa-user" /> Your profile
          </h3>
          <div className="fuel-row">
            <span className="label">Name</span>
            <span className="value">{user.name}</span>
          </div>
          <div className="fuel-row">
            <span className="label">Email</span>
            <span className="value">{user.email}</span>
          </div>
          <div className="fuel-row">
            <span className="label">Role</span>
            <span className="value">{user.role}</span>
          </div>
          <div className="fuel-row">
            <span className="label">Access score</span>
            <span className="value">{user.access_score}%</span>
          </div>
          <div className="fuel-row">
            <span className="label">Station</span>
            <span className="value">{profile.station?.name || '—'}</span>
          </div>
        </div>
      </div>

      {err && (
        <div className="auth-err" style={{ margin: '0 32px 20px' }}>
          {err}
        </div>
      )}
      {success && (
        <div className="auth-success" style={{ margin: '0 32px 20px' }}>
          <i className="fas fa-check-circle" /> {success}
        </div>
      )}
    </div>
  );
}
