import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabase'
import { timeEAT, dateShortEAT, todayEAT } from '../lib/time'

const DROP_UNIT = 300000

function unitsOf(amount) {
  const n = Number(amount) || 0
  return Math.floor(n / DROP_UNIT)
}
function unitsLabel(amount) {
  const u = unitsOf(amount)
  return `${u} drop${u === 1 ? '' : 's'}`
}

export default function Drops({ profile, onOpenCollect }) {
  const user = profile.user
  const isAttendant = user.role === 'attendant'
  const canRecord = !isAttendant && (user.access_score ?? 30) >= 60
  const canUndo = !isAttendant && (user.access_score ?? 30) >= 60
  const canApproveUndo = user.role === 'manager' || user.role === 'admin'
  const canViewAll = !isAttendant

  const [drops, setDrops] = useState([])
  const [attendants, setAttendants] = useState([])
  const [nameById, setNameById] = useState({})
  const [loading, setLoading] = useState(true)
  const [firstLoad, setFirstLoad] = useState(true)
  const [openRecord, setOpenRecord] = useState(false)
  const [openSearch, setOpenSearch] = useState(false)
  const [successDrop, setSuccessDrop] = useState(null)
  const [filters, setFilters] = useState({
    search: '', attendant: 'all', status: 'all', from: '', to: '',
  })

  const [debouncedSearch, setDebouncedSearch] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(filters.search), 300)
    return () => clearTimeout(t)
  }, [filters.search])

  async function loadAll() {
    setLoading(true)

    const { data: users } = await supabase
      .from('users')
      .select('id, name, role, initials')
      .eq('station_id', user.station_id)
      .eq('is_active', true)
    setAttendants(users || [])

    const map = {}
    ;(users || []).forEach(u => { map[u.id] = u.name })
    setNameById(map)

    const { data: shifts } = await supabase
      .from('shifts')
      .select('id')
      .eq('station_id', user.station_id)

    const shiftIds = (shifts || []).map(s => s.id)

    let rows = []
    if (shiftIds.length > 0) {
      let q = supabase
        .from('money_drops')
        .select('*')
        .in('shift_id', shiftIds)
        .order('created_at', { ascending: false })
        .limit(300)

      if (isAttendant) {
        q = q.eq('attendant_id', user.id)
      }

      const { data } = await q
      rows = data || []
    }

    setDrops(rows)
    setLoading(false)
    setFirstLoad(false)
  }

  useEffect(() => { loadAll() }, [user.id])

  const filtered = useMemo(() => {
    let rows = drops.slice()
    const f = filters

    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase()
      rows = rows.filter(d =>
        (d.code || '').toLowerCase().includes(q) ||
        (nameById[d.attendant_id] || '').toLowerCase().includes(q)
      )
    }
    if (f.attendant !== 'all') rows = rows.filter(d => d.attendant_id === f.attendant)
    if (f.status !== 'all') rows = rows.filter(d => d.status === f.status)
    if (f.from) rows = rows.filter(d => String(d.created_at).slice(0, 10) >= f.from)
    if (f.to) rows = rows.filter(d => String(d.created_at).slice(0, 10) <= f.to)
    return rows
  }, [drops, filters, debouncedSearch, nameById])

  const totals = useMemo(() => {
    const active = filtered.filter(d => d.status !== 'undone')
    const amount = active.reduce((s, d) => s + Number(d.amount), 0)
    const units = active.reduce((s, d) => s + unitsOf(d.amount), 0)
    return { amount, units, count: active.length }
  }, [filtered])

  return (
    <div className="drops-screen">
      <div className="drops-head">
        <div>
          <h3>{isAttendant ? 'My Drops' : 'Money Drops'}</h3>
          <div className="sub">
            {isAttendant
              ? 'Drops you have handed to your supervisor'
              : 'Cash handed by attendants during the shift'}
          </div>
        </div>
        <div className="drops-actions">
          <button className="btn-ghost" onClick={() => setOpenSearch(true)}>
            <i className="fas fa-search" /> Search code
          </button>
          {!isAttendant && (
            <button className="btn-ghost" onClick={() => exportCSV(filtered, nameById)}>
              <i className="fas fa-file-csv" /> Export CSV
            </button>
          )}
          {canRecord && (
            <button className="btn-primary" onClick={() => setOpenRecord(true)}>
              <i className="fas fa-plus" /> Record drop
            </button>
          )}
        </div>
      </div>

      <div className="dashboard-grid" style={{ padding: '0 32px 20px' }}>
        <Stat
          label={isAttendant ? 'My total' : 'Filtered total'}
          value={`UGX ${totals.amount.toLocaleString()}`}
          sub={`${totals.units} drop${totals.units === 1 ? '' : 's'} · 1 drop = UGX ${DROP_UNIT.toLocaleString()}`}
        />
        <Stat label="Undo pending" value={filtered.filter(d => d.status === 'pending_undo').length} sub="Waiting approval" />
        <Stat label="Undone" value={filtered.filter(d => d.status === 'undone').length} sub="Reversed" />
      </div>

      <div className="drops-filters">
        <input
          placeholder={isAttendant ? 'Search by code…' : 'Search by code or attendant…'}
          value={filters.search}
          onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
        />
        {!isAttendant && (
          <select value={filters.attendant} onChange={e => setFilters(f => ({ ...f, attendant: e.target.value }))}>
            <option value="all">All attendants</option>
            {attendants.filter(u => u.role === 'attendant').map(u => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        )}
        <select value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}>
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="pending_undo">Pending undo</option>
          <option value="undone">Undone</option>
        </select>
        <input type="date" value={filters.from} onChange={e => setFilters(f => ({ ...f, from: e.target.value }))} />
        <input type="date" value={filters.to} onChange={e => setFilters(f => ({ ...f, to: e.target.value }))} />
        <button className="btn-ghost btn-sm" onClick={() => setFilters({ search: '', attendant: 'all', status: 'all', from: '', to: '' })}>
          Clear
        </button>
      </div>

      {firstLoad && loading ? (
        <div className="drops-empty">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="drops-empty">
          <i className="fas fa-money-bill-wave" />
          <h4>{isAttendant ? 'No drops yet' : 'No drops match'}</h4>
          <p>{isAttendant ? 'Your recorded drops will appear here.' : 'Adjust filters or record a new drop.'}</p>
        </div>
      ) : (
        <div className="drops-table-wrap">
          <table className="drops-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Time</th>
                <th>Code</th>
                {!isAttendant && <th>Attendant</th>}
                <th>Drop #</th>
                <th>Amount</th>
                <th>Drops</th>
                <th>Status</th>
                {canUndo && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map(d => (
                <DropRow
                  key={d.id}
                  drop={d}
                  attendantName={nameById[d.attendant_id] || '—'}
                  canUndo={canUndo}
                  canApproveUndo={canApproveUndo}
                  showAttendant={!isAttendant}
                  onChanged={loadAll}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {openRecord && (
        <RecordDropModal
          profile={profile}
          attendants={attendants}
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
        <SearchCodeModal onClose={() => setOpenSearch(false)} nameById={nameById} />
      )}
    </div>
  )
}

function SuccessDropModal({ drop, onClose }) {
  const [copied, setCopied] = useState(false)
  const units = unitsOf(drop.amount)

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

function DropRow({ drop, attendantName, canUndo, canApproveUndo, showAttendant, onChanged }) {
  const created = new Date(drop.created_at)
  const ageMs = Date.now() - created.getTime()
  const within5Min = ageMs < 5 * 60 * 1000
  const [busy, setBusy] = useState(false)

  const statusClass =
    drop.status === 'active' ? 'green' :
    drop.status === 'pending_undo' ? 'amber' : 'red'

  const units = unitsOf(drop.amount)

  async function undoNow() {
    if (!confirm(`Undo drop ${drop.code}?`)) return
    setBusy(true)
    const u = (await supabase.auth.getUser()).data.user
    await supabase.from('money_drops').update({
      status: 'undone',
      undo_approved_at: new Date().toISOString(),
      undo_approved_by: u.id,
      undo_reason: 'within 5 min undo',
    }).eq('id', drop.id)
    setBusy(false); onChanged()
  }
  async function requestUndo() {
    const reason = prompt('Why should this drop be undone?')
    if (!reason) return
    setBusy(true)
    const u = (await supabase.auth.getUser()).data.user
    await supabase.from('money_drops').update({
      status: 'pending_undo',
      undo_requested_at: new Date().toISOString(),
      undo_requested_by: u.id,
      undo_reason: reason,
    }).eq('id', drop.id)
    setBusy(false); onChanged()
  }
  async function approveUndo() {
    if (!confirm(`Approve undo of ${drop.code}?`)) return
    setBusy(true)
    const u = (await supabase.auth.getUser()).data.user
    await supabase.from('money_drops').update({
      status: 'undone',
      undo_approved_at: new Date().toISOString(),
      undo_approved_by: u.id,
    }).eq('id', drop.id)
    setBusy(false); onChanged()
  }

  return (
    <tr className={drop.status === 'undone' ? 'row-undone' : ''}>
      <td>{dateShortEAT(drop.created_at)}</td>
      <td>{timeEAT(drop.created_at).slice(0, 5)}</td>
      <td><span className="code-pill">{drop.code}</span></td>
      {showAttendant && <td>{attendantName}</td>}
      <td>#{drop.drop_number}</td>
      <td className="amt">UGX {Number(drop.amount).toLocaleString()}</td>
      <td><span className="pill gold">{units} drop{units === 1 ? '' : 's'}</span></td>
      <td><span className={`pill ${statusClass}`}>{drop.status.replace('_', ' ')}</span></td>
      {canUndo && (
        <td>
          {drop.status === 'active' && within5Min && (
            <button className="btn-tiny danger" disabled={busy} onClick={undoNow}>
              <i className="fas fa-undo" /> Undo
            </button>
          )}
          {drop.status === 'active' && !within5Min && (
            <button className="btn-tiny warn" disabled={busy} onClick={requestUndo}>
              <i className="fas fa-paper-plane" /> Request undo
            </button>
          )}
          {drop.status === 'pending_undo' && canApproveUndo && (
            <button className="btn-tiny success" disabled={busy} onClick={approveUndo}>
              <i className="fas fa-check" /> Approve
            </button>
          )}
          {drop.status === 'pending_undo' && !canApproveUndo && (
            <span className="pill amber" style={{ fontSize: 10 }}>Waiting approval</span>
          )}
        </td>
      )}
    </tr>
  )
}

/* ============================================================
   RECORD DROP MODAL — uses ANY open shift at the station
   ============================================================ */
function RecordDropModal({ profile, attendants, onClose, onSaved }) {
  const user = profile.user
  const list = attendants.filter(u => u.role === 'attendant')
  const [attendantId, setAttendantId] = useState(list[0]?.id || '')
  const [amount, setAmount] = useState(300000)
  const [isFinal, setIsFinal] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [shiftInfo, setShiftInfo] = useState(null)
  const [shiftId, setShiftId] = useState(null)

  // Find ANY open shift at this station — no date restriction
  useEffect(() => {
    async function getShift() {
      const { data } = await supabase
        .from('shifts')
        .select('id, shift_date, shift_type, opened_at')
        .eq('station_id', user.station_id)
        .eq('status', 'open')
        .order('opened_at', { ascending: false })
        .limit(1)
      if (data?.[0]) {
        setShiftId(data[0].id)
        setShiftInfo(data[0])
      } else {
        setShiftId(null)
        setShiftInfo(null)
      }
    }
    getShift()
  }, [user.station_id])

  const units = unitsOf(amount)

  async function save() {
    if (!shiftId) { setErr('No open shift at this station. Ask a manager to open one.'); return }
    if (Number(amount) <= 0) { setErr('Enter an amount'); return }
    setBusy(true); setErr('')
    const { data, error } = await supabase
      .from('money_drops')
      .insert({
        shift_id: shiftId,
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
        <div className="modal-sub">Cash handed by attendant to supervisor</div>

        {shiftInfo ? (
          <div className="field-hint" style={{ marginBottom: 12, background: '#d1fae5', color: '#065f46' }}>
            <i className="fas fa-check-circle" /> Recording on open shift ·{' '}
            {shiftInfo.shift_date} · {shiftInfo.shift_type}
          </div>
        ) : (
          <div className="field-hint" style={{ marginBottom: 12, background: '#fee2e2', color: '#991b1b' }}>
            <i className="fas fa-lock" /> No open shift at this station. Ask a manager to open one.
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
          <button onClick={() => setAmount(300000)}>300k · 1 drop</button>
          <button onClick={() => setAmount(600000)}>600k · 2 drops</button>
          <button onClick={() => setAmount(900000)}>900k · 3 drops</button>
        </div>

        <label className="check-row">
          <input type="checkbox" checked={isFinal} onChange={e => setIsFinal(e.target.checked)} />
          <span>Final drop for this attendant</span>
        </label>

        {err && <div className="auth-err">{err}</div>}

        <div className="modal-actions">
          <button className="btn-ghost-full" onClick={onClose}>Cancel</button>
          <button className="btn-primary-full" onClick={save} disabled={busy || !shiftId}>
            {busy ? 'Saving…' : <><i className="fas fa-check" /> Record</>}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ============================================================
   SEARCH BY CODE MODAL
   ============================================================ */
function SearchCodeModal({ onClose, nameById }) {
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

  return (
    <div className="modal-bg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <h3><i className="fas fa-search" /> Search by Drop Code</h3>
        <div className="modal-sub">Enter the full code</div>
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
              <span className={`pill ${result.status === 'active' ? 'green' : result.status === 'pending_undo' ? 'amber' : 'red'}`}>
                {result.status}
              </span>
            </div>
            <div className="result-row"><span className="lbl">Date</span><span className="val">{dateShortEAT(result.created_at)}</span></div>
            <div className="result-row"><span className="lbl">Time</span><span className="val">{timeEAT(result.created_at)}</span></div>
            <div className="result-row"><span className="lbl">Amount</span><span className="val">UGX {Number(result.amount).toLocaleString()}</span></div>
            <div className="result-row"><span className="lbl">Drops</span><span className="val">{unitsLabel(result.amount)}</span></div>
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

function exportCSV(rows, nameById) {
  const header = 'Date,Time,Code,Attendant,Drop #,Amount,Drops,Status,Final\n'
  const body = rows.map(d => {
    const date = new Date(d.created_at).toLocaleDateString('en-CA', { timeZone: 'Africa/Kampala' })
    const time = timeEAT(d.created_at).slice(0, 5)
    const name = (nameById[d.attendant_id] || '').replace(/,/g, '')
    return [date, time, d.code, name, d.drop_number, d.amount, unitsOf(d.amount), d.status, d.is_final].join(',')
  }).join('\n')
  const blob = new Blob([header + body], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `texol-drops-${todayEAT()}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function Stat({ label, value, sub }) {
  return (
    <div className="stat-card">
      <div className="stat-title">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  )
}