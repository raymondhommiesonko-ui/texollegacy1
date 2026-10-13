import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabase'
import { timeEAT, dateShortEAT, todayEAT } from '../lib/time'

// Business rule: 300,000 UGX = 1 drop unit
const DROP_UNIT = 300000
const unitsOf = amount => Math.floor((Number(amount) || 0) / DROP_UNIT)

export default function Collect({ profile, onExit }) {
  const user = profile.user
  const station = profile.station

  const [tab, setTab] = useState('record')
  const [drops, setDrops] = useState([])
  const [attendants, setAttendants] = useState([])
  const [nameById, setNameById] = useState({})
  const [loading, setLoading] = useState(true)
  const [openRecord, setOpenRecord] = useState(false)
  const [openSearch, setOpenSearch] = useState(false)
  const [successDrop, setSuccessDrop] = useState(null)
  const [openShift, setOpenShift] = useState(null)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  async function loadAll() {
    setLoading(true)

    const { data: users } = await supabase
      .from('users')
      .select('id, name, role')
      .eq('station_id', user.station_id)
      .eq('is_active', true)
    setAttendants(users || [])
    const map = {}
    ;(users || []).forEach(u => { map[u.id] = u.name })
    setNameById(map)

    // Find the CURRENT OPEN shift — no date restriction
    const { data: shifts } = await supabase
      .from('shifts')
      .select('id, shift_date, shift_type, opened_at')
      .eq('station_id', user.station_id)
      .eq('status', 'open')
      .order('opened_at', { ascending: false })
      .limit(1)

    const current = shifts?.[0] || null
    setOpenShift(current)

    let rows = []
    if (current) {
      const { data } = await supabase
        .from('money_drops')
        .select('*')
        .eq('shift_id', current.id)
        .order('created_at', { ascending: false })
        .limit(200)
      rows = data || []
    }
    setDrops(rows)
    setLoading(false)
  }

  useEffect(() => { loadAll() }, [user.id])

  const shiftStats = useMemo(() => {
    const active = drops.filter(d => d.status !== 'undone')
    const total = active.reduce((s, d) => s + Number(d.amount), 0)
    const units = active.reduce((s, d) => s + unitsOf(d.amount), 0)
    return {
      total,
      units,
      count: active.length,
      attendants: new Set(active.map(d => d.attendant_id)).size,
    }
  }, [drops])

  const pendingFinal = useMemo(() => {
    const grouped = {}
    drops.forEach(d => {
      if (d.status === 'undone') return
      if (!grouped[d.attendant_id]) grouped[d.attendant_id] = { hasFinal: false }
      if (d.is_final) grouped[d.attendant_id].hasFinal = true
    })
    return Object.entries(grouped)
      .filter(([_, v]) => !v.hasFinal)
      .map(([id]) => nameById[id] || 'Unknown')
  }, [drops, nameById])

  const history = useMemo(() => {
    let rows = drops.slice()
    if (from) rows = rows.filter(d => String(d.created_at).slice(0, 10) >= from)
    if (to) rows = rows.filter(d => String(d.created_at).slice(0, 10) <= to)
    return rows
  }, [drops, from, to])

  const canRecord = (user.access_score ?? 30) >= 60

  return (
    <div className="collect-mode">
      <header className="collect-topbar">
        <div className="brand">
          <i className="fas fa-money-bill-wave" />
          TEXOL COLLECT
        </div>
        <div className="collect-actions">
          <button className="collect-icon-btn" onClick={() => setOpenSearch(true)} title="Search code">
            <i className="fas fa-search" />
          </button>
          <button className="collect-exit-btn" onClick={onExit}>
            <i className="fas fa-times" /> Exit
          </button>
        </div>
      </header>

      <div className="collect-content">
        {tab === 'record' && (
          <>
            <div className="collect-title">
              {openShift
                ? <>Open shift · {dateShortEAT(openShift.opened_at)} · {String(openShift.shift_type).toUpperCase()}</>
                : <>No open shift · {station?.name || 'STATION'}</>}
            </div>

            {!openShift && (
              <div className="field-hint" style={{
                margin: '0 0 16px', background: '#fee2e2', color: '#991b1b',
                padding: '12px 16px', borderRadius: 12,
              }}>
                <i className="fas fa-lock" /> No shift is currently open.
                Ask a manager to open one before recording drops.
              </div>
            )}

            {canRecord && openShift && (
              <button className="collect-record-btn" onClick={() => setOpenRecord(true)}>
                <i className="fas fa-plus-circle" />
                RECORD MONEY DROP
              </button>
            )}

            <div className="collect-stats">
              <div className="collect-stat">
                <div className="label">Collected this shift</div>
                <div className="value">UGX {shiftStats.total.toLocaleString()}</div>
                <div className="sub">
                  {shiftStats.units} drop{shiftStats.units === 1 ? '' : 's'} · 1 = UGX {DROP_UNIT.toLocaleString()}
                </div>
              </div>
              <div className="collect-stat">
                <div className="label">Attendants on shift</div>
                <div className="value">{shiftStats.attendants}</div>
                <div className="sub">Unique</div>
              </div>
              <div className="collect-stat">
                <div className="label">Pending final</div>
                <div className="value" style={{ color: '#f59e0b' }}>{pendingFinal.length}</div>
                <div className="sub">{pendingFinal.slice(0, 3).join(', ') || 'All balanced'}</div>
              </div>
              <div className="collect-stat">
                <div className="label">Undo pending</div>
                <div className="value" style={{ color: '#dc2626' }}>
                  {drops.filter(d => d.status === 'pending_undo').length}
                </div>
                <div className="sub">Awaiting approval</div>
              </div>
            </div>

            <div className="collect-section-title">Recent drops this shift</div>
            {loading ? (
              <div className="collect-empty">Loading…</div>
            ) : drops.length === 0 ? (
              <div className="collect-empty">
                <i className="fas fa-inbox" />
                <h4>{openShift ? 'No drops yet this shift' : 'No open shift'}</h4>
                <p>{openShift ? 'Tap the button above to record one' : 'Drops will appear once a manager opens a shift'}</p>
              </div>
            ) : (
              drops.slice(0, 8).map(d => (
                <CollectDropItem key={d.id} drop={d} attendantName={nameById[d.attendant_id] || '—'} />
              ))
            )}
          </>
        )}

        {tab === 'history' && (
          <>
            <div className="collect-title">All drops</div>
            <div className="collect-date-row">
              <input type="date" value={from} onChange={e => setFrom(e.target.value)} />
              <input type="date" value={to} onChange={e => setTo(e.target.value)} />
            </div>
            {history.length === 0 ? (
              <div className="collect-empty">
                <i className="fas fa-inbox" />
                <h4>No drops</h4>
              </div>
            ) : (
              history.map(d => (
                <CollectDropItem key={d.id} drop={d} attendantName={nameById[d.attendant_id] || '—'} />
              ))
            )}
          </>
        )}
      </div>

      <nav className="collect-bottomnav">
        <button className={`collect-nav-btn ${tab === 'record' ? 'active' : ''}`} onClick={() => setTab('record')}>
          <span className="icon">💰</span> Record
        </button>
        <button className={`collect-nav-btn ${tab === 'history' ? 'active' : ''}`} onClick={() => setTab('history')}>
          <span className="icon">📋</span> History
        </button>
        <button className="collect-nav-btn" onClick={onExit}>
          <span className="icon">🏠</span> Portal
        </button>
      </nav>

      {openRecord && (
        <RecordDropModal
          profile={profile}
          attendants={attendants}
          openShift={openShift}
          onClose={() => setOpenRecord(false)}
          onSaved={async (newDrop) => {
            setOpenRecord(false)
            setSuccessDrop(newDrop)
            await loadAll()
          }}
        />
      )}

      {successDrop && (
        <SuccessDropModal drop={successDrop} onClose={() => setSuccessDrop(null)} />
      )}

      {openSearch && (
        <CollectSearchModal onClose={() => setOpenSearch(false)} nameById={nameById} />
      )}
    </div>
  )
}

/* ============================================================
   DROP ITEM
   ============================================================ */
function CollectDropItem({ drop, attendantName }) {
  const units = unitsOf(drop.amount)
  return (
    <div className={`collect-drop-item ${drop.status === 'undone' ? 'undone' : ''}`}>
      <div className="left">
        <span className="code">{drop.code}</span>
        <span className="meta">
          {timeEAT(drop.created_at).slice(0, 5)} · {attendantName} · drop #{drop.drop_number}
        </span>
      </div>
      <div className="right">
        <div className="amount">UGX {Number(drop.amount).toLocaleString()}</div>
        <div style={{ fontSize: 11, color: '#8ba0b9', marginTop: 2 }}>
          {units} drop{units === 1 ? '' : 's'}
        </div>
        {drop.is_final && <div className="final">🏁 final</div>}
        {drop.status === 'pending_undo' && <div className="badge-warn">undo pending</div>}
        {drop.status === 'undone' && <div className="badge-red">undone</div>}
      </div>
    </div>
  )
}

/* ============================================================
   SUCCESS MODAL
   ============================================================ */
function SuccessDropModal({ drop, onClose }) {
  const units = unitsOf(drop.amount)
  const [copied, setCopied] = useState(false)

  function copy() {
    navigator.clipboard.writeText(drop.code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="modal-bg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal success-modal">
        <div className="success-check">✓</div>
        <h3>Recorded!</h3>

        <div className="big-code-box" onClick={copy} title="Click to copy">
          <div className="code-label">Drop Code</div>
          <div className="code-big">{drop.code}</div>
          <div className="code-hint">
            {copied ? '✓ Copied to clipboard' : 'Tap to copy · Show this to the attendant'}
          </div>
        </div>

        <div className="success-details">
          <div className="result-row">
            <span className="lbl">Amount</span>
            <span className="val">UGX {Number(drop.amount).toLocaleString()}</span>
          </div>
          <div className="result-row">
            <span className="lbl">Drops</span>
            <span className="val">
              {units} drop{units === 1 ? '' : 's'}
              <span style={{ color: '#8ba0b9', fontSize: 12 }}> (1 drop = UGX {DROP_UNIT.toLocaleString()})</span>
            </span>
          </div>
          <div className="result-row">
            <span className="lbl">Drop #</span>
            <span className="val">#{drop.drop_number}{drop.is_final ? ' (final)' : ''}</span>
          </div>
          <div className="result-row">
            <span className="lbl">Time</span>
            <span className="val">{timeEAT(drop.created_at)}</span>
          </div>
        </div>

        <div className="modal-actions">
          <button className="btn-ghost-full" onClick={copy}>
            <i className="fas fa-copy" /> {copied ? 'Copied' : 'Copy code'}
          </button>
          <button className="btn-primary-full" onClick={onClose}>
            <i className="fas fa-check" /> Done
          </button>
        </div>
      </div>
    </div>
  )
}

/* ============================================================
   RECORD MODAL — uses the open shift passed from parent
   ============================================================ */
function RecordDropModal({ profile, attendants, openShift, onClose, onSaved }) {
  const user = profile.user
  const list = attendants.filter(u => u.role === 'attendant')
  const [attendantId, setAttendantId] = useState(list[0]?.id || '')
  const [amount, setAmount] = useState(300000)
  const [isFinal, setIsFinal] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const units = unitsOf(amount)

  async function save() {
    if (!openShift) { setErr('No open shift. Ask a manager to open one.'); return }
    if (Number(amount) <= 0) { setErr('Enter an amount'); return }
    setBusy(true); setErr('')
    const { data, error } = await supabase
      .from('money_drops')
      .insert({
        shift_id: openShift.id,
        attendant_id: attendantId,
        amount: Number(amount),
        is_final: isFinal,
        recorded_by: user.id,
        code: 'TEMP',
      })
      .select()
      .single()
    setBusy(false)
    if (error) { setErr(error.message); return }
    onSaved(data)
  }

  return (
    <div className="modal-bg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <h3>Record Money Drop</h3>
        <div className="modal-sub">Cash handed to supervisor</div>

        {openShift && (
          <div className="field-hint" style={{
            marginBottom: 12, background: '#d1fae5', color: '#065f46',
          }}>
            <i className="fas fa-check-circle" /> Recording on open shift ·{' '}
            {openShift.shift_date} · {openShift.shift_type}
          </div>
        )}

        <label>Attendant</label>
        <select value={attendantId} onChange={e => setAttendantId(e.target.value)}>
          {list.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>

        <label>Amount (UGX)</label>
        <input type="number" value={amount} onChange={e => setAmount(e.target.value)} />

        <div className="field-hint" style={{ marginTop: 8 }}>
          <i className="fas fa-coins" /> {units} drop{units === 1 ? '' : 's'}{' '}
          <span style={{ color: '#8ba0b9' }}>(1 drop = UGX {DROP_UNIT.toLocaleString()})</span>
        </div>

        <div className="quick-amounts">
          <button onClick={() => setAmount(300000)}>300k · 1</button>
          <button onClick={() => setAmount(600000)}>600k · 2</button>
          <button onClick={() => setAmount(900000)}>900k · 3</button>
        </div>

        <label className="check-row">
          <input type="checkbox" checked={isFinal} onChange={e => setIsFinal(e.target.checked)} />
          <span>Final drop for this attendant</span>
        </label>

        {err && <div className="auth-err">{err}</div>}

        <div className="modal-actions">
          <button className="btn-ghost-full" onClick={onClose}>Cancel</button>
          <button className="btn-primary-full" onClick={save} disabled={busy || !openShift}>
            {busy ? 'Saving…' : <><i className="fas fa-check" /> Record</>}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ============================================================
   SEARCH MODAL
   ============================================================ */
function CollectSearchModal({ onClose, nameById }) {
  const [code, setCode] = useState('')
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  async function search() {
    if (!code.trim()) return
    setLoading(true); setErr(''); setResult(null)
    const { data, error } = await supabase
      .from('money_drops')
      .select(`
        *,
        shift:shifts!money_drops_shift_id_fkey(
          id, shift_type, shift_date,
          supervisor:users!shifts_supervisor_id_fkey(name),
          manager:users!shifts_manager_id_fkey(name)
        )
      `)
      .eq('code', code.trim().toUpperCase())
      .maybeSingle()
    setLoading(false)
    if (error) { setErr(error.message); return }
    if (!data) { setErr('No drop found with that code'); return }
    setResult(data)
  }

  const units = result ? unitsOf(result.amount) : 0

  return (
    <div className="modal-bg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <h3><i className="fas fa-search" /> Search by Drop Code</h3>
        <input
          autoFocus
          placeholder="e.g. AB71023CN42"
          value={code}
          onChange={e => setCode(e.target.value.toUpperCase())}
          onKeyDown={e => { if (e.key === 'Enter') search() }}
          style={{ fontFamily: 'ui-monospace, monospace', letterSpacing: '2px', fontSize: 18, textAlign: 'center' }}
        />
        <button className="btn-primary-full" onClick={search} disabled={loading} style={{ marginTop: 12 }}>
          {loading ? 'Searching…' : <><i className="fas fa-search" /> Search</>}
        </button>

        {err && <div className="auth-err" style={{ marginTop: 16 }}>{err}</div>}

        {result && (
          <div className="search-result">
            <div className="result-header">
              <span className="code-pill big">{result.code}</span>
              <span className={`pill ${result.status === 'active' ? 'green' : result.status === 'pending_undo' ? 'amber' : 'red'}`}>{result.status}</span>
            </div>
            <div className="result-row"><span className="lbl">Date</span><span className="val">{dateShortEAT(result.created_at)}</span></div>
            <div className="result-row"><span className="lbl">Time</span><span className="val">{timeEAT(result.created_at)}</span></div>
            <div className="result-row"><span className="lbl">Amount</span><span className="val">UGX {Number(result.amount).toLocaleString()}</span></div>
            <div className="result-row">
              <span className="lbl">Drops</span>
              <span className="val">{units} drop{units === 1 ? '' : 's'}</span>
            </div>
            <div className="result-row"><span className="lbl">Attendant</span><span className="val">{nameById[result.attendant_id] || '—'}</span></div>
            <div className="result-row"><span className="lbl">Supervisor</span><span className="val">{result.shift?.supervisor?.name || '—'}</span></div>
            <div className="result-row"><span className="lbl">Manager</span><span className="val">{result.shift?.manager?.name || '—'}</span></div>
          </div>
        )}

        <div className="modal-actions">
          <button className="btn-ghost-full" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}