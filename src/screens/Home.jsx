import { useEffect, useState } from 'react'
import { supabase } from '../supabase'

export default function Home({ profile, onNavigate }) {
  const user = profile.user
  const canEdit = ['admin','manager','supervisor'].includes(user.role)

  return (
    <div className="home">
      <MotivationBanner stationId={user.station_id} canEdit={canEdit} />
      <WinnerStrip profile={profile} />
      <WinnerCards profile={profile} />
      <ThanksList profile={profile} />
      <LiveStats profile={profile} onNavigate={onNavigate} />
    </div>
  )
}

/* ============================================================
   MOTIVATION BANNER
   ============================================================ */
function MotivationBanner({ stationId, canEdit }) {
  const [messages, setMessages] = useState([])
  const [index, setIndex] = useState(0)
  const [fading, setFading] = useState(false)
  const [editing, setEditing] = useState(false)

  async function load() {
    const { data } = await supabase
      .from('motivation_messages')
      .select('*')
      .eq('station_id', stationId)
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
    setMessages(data || [])
  }

  useEffect(() => { load() }, [stationId])

  useEffect(() => {
    if (messages.length < 2) return
    const t = setInterval(() => {
      setFading(true)
      setTimeout(() => {
        setIndex(i => (i + 1) % messages.length)
        setFading(false)
      }, 400)
    }, 6000)
    return () => clearInterval(t)
  }, [messages.length])

  if (messages.length === 0) return null

  const current = messages[index % messages.length]
  const isGold = current.head.length % 2 === 0

  return (
    <div className={`motivation ${isGold ? 'gold' : ''} ${fading ? 'fade-out' : ''}`}>
      <div className="icon">🏆</div>
      <div className="text">
        <div className="headline">{current.head}</div>
        <div className="body">{current.body}</div>
      </div>
      {canEdit && (
        <button className="motivation-edit" onClick={() => setEditing(true)} title="Edit messages">
          <i className="fas fa-pen" />
        </button>
      )}
      <div className="motivation-dots">
        {messages.map((_, i) => (
          <div key={i} className={`dot ${i === (index % messages.length) ? 'active' : ''}`} />
        ))}
      </div>
      {editing && (
        <MotivationEditor
          stationId={stationId}
          messages={messages}
          onClose={() => setEditing(false)}
          onSaved={async () => { setEditing(false); setIndex(0); await load() }}
        />
      )}
    </div>
  )
}

function MotivationEditor({ stationId, messages, onClose, onSaved }) {
  const [list, setList] = useState(messages.map(m => ({ ...m })))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  function update(i, field, value) {
    setList(prev => prev.map((m, idx) => idx === i ? { ...m, [field]: value } : m))
  }
  function remove(i) {
    setList(prev => prev.filter((_, idx) => idx !== i))
  }
  function add() {
    setList(prev => [...prev, {
      id: 'new-' + Date.now(),
      head: 'New message',
      body: 'Write something inspiring…',
      is_active: true,
      sort_order: prev.length + 1,
    }])
  }

  async function save() {
    setBusy(true); setErr('')
    try {
      for (const m of list) {
        if (m.id.startsWith('new-')) {
          await supabase.from('motivation_messages').insert({
            station_id: stationId, head: m.head, body: m.body,
            is_active: true, sort_order: m.sort_order,
          })
        } else {
          await supabase.from('motivation_messages').update({
            head: m.head, body: m.body, sort_order: m.sort_order,
          }).eq('id', m.id)
        }
      }
      onSaved()
    } catch (e) {
      setErr(e.message || 'Save failed')
      setBusy(false)
    }
  }

  async function removeDeleted() {
    const originalIds = messages.map(m => m.id)
    const keptIds = list.map(m => m.id).filter(id => !id.startsWith('new-'))
    const deleted = originalIds.filter(id => !keptIds.includes(id))
    for (const id of deleted) {
      await supabase.from('motivation_messages').update({ is_active: false }).eq('id', id)
    }
  }

  return (
    <div className="modal-bg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal modal-wide">
        <h3>Edit Motivation Messages</h3>
        <div className="modal-sub">These rotate on the Home screen every 6 seconds</div>

        {list.map((m, i) => (
          <div key={m.id} className="motiv-edit-block">
            <label>Headline</label>
            <input value={m.head} onChange={e => update(i, 'head', e.target.value)} />
            <label>Body</label>
            <textarea value={m.body || ''} onChange={e => update(i, 'body', e.target.value)} />
            <button className="btn-tiny danger" onClick={() => remove(i)}>
              <i className="fas fa-trash" /> Remove
            </button>
          </div>
        ))}

        <button className="btn-ghost" style={{ width: '100%', justifyContent: 'center' }} onClick={add}>
          <i className="fas fa-plus" /> Add message
        </button>

        {err && <div className="auth-err">{err}</div>}

        <div className="modal-actions">
          <button className="btn-ghost-full" onClick={onClose}>Cancel</button>
          <button className="btn-primary-full" onClick={async () => { await removeDeleted(); await save() }} disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ============================================================
   WINNER STRIP — now includes Transactions
   ============================================================ */
function WinnerStrip({ profile }) {
  const user = profile.user
  const [tiles, setTiles] = useState([])
  const [index, setIndex] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const today = new Date().toISOString().slice(0, 10)
      const computed = []

      // Today's drops
      const { data: shifts } = await supabase
        .from('shifts')
        .select('id')
        .eq('station_id', user.station_id)
        .eq('shift_date', today)
      const shiftIds = (shifts || []).map(s => s.id)

      let todayDrops = []
      if (shiftIds.length > 0) {
        const { data } = await supabase
          .from('money_drops')
          .select('attendant_id, amount')
          .in('shift_id', shiftIds)
          .eq('status', 'active')
        todayDrops = data || []
      }

      const { data: users } = await supabase
        .from('users')
        .select('id, name')
        .eq('station_id', user.station_id)
      const nameById = {}
      ;(users || []).forEach(u => { nameById[u.id] = u.name })

      const totals = {}
      todayDrops.forEach(d => {
        totals[d.attendant_id] = (totals[d.attendant_id] || 0) + Number(d.amount)
      })
      const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1])

      if (sorted[0]) {
        computed.push({
          type: 'liters', icon: 'fa-money-bill-wave', label: 'Top collector · today',
          name: nameById[sorted[0][0]] || '—',
          reason: `UGX ${sorted[0][1].toLocaleString()} collected`,
          crown: '👑',
        })
      }
      if (sorted[1]) {
        computed.push({
          type: 'cards', icon: 'fa-credit-card', label: 'Runner-up · today',
          name: nameById[sorted[1][0]] || '—',
          reason: `UGX ${sorted[1][1].toLocaleString()} collected`,
          crown: '🏆',
        })
      }

      // Fuel card champions
      const weekStart = getMondayISO()
      const { data: champs } = await supabase
        .from('card_champions')
        .select('*, user:users(name)')
        .eq('station_id', user.station_id)
        .eq('week_start', weekStart)
      const kindMeta = {
        best_cards:     { icon: 'fa-credit-card',    label: 'Best cards worked' },
        best_sales:     { icon: 'fa-money-bill-wave', label: 'Best card sales' },
        best_liters:    { icon: 'fa-gas-pump',       label: 'Best fuel card liters' },
        best_app_users: { icon: 'fa-mobile-alt',     label: 'Best app users' },
        best_topups:    { icon: 'fa-arrow-up',       label: 'Best top-ups' },
      }
      ;(champs || []).forEach(c => {
        const meta = kindMeta[c.kind] || { icon: 'fa-star', label: c.kind }
        computed.push({
          type: 'cards', icon: meta.icon, label: meta.label,
          name: c.user?.name || '—',
          reason: c.reason || 'Champion this week',
          crown: '👑',
        })
      })

      // Top card worker today
      const { data: staffCards } = await supabase
        .from('v_staff_daily_cards')
        .select('*')
        .eq('station_id', user.station_id)
        .eq('day', today)
        .order('cards_worked', { ascending: false })
        .limit(1)
      if (staffCards && staffCards[0]) {
        const top = staffCards[0]
        computed.push({
          type: 'cards', icon: 'fa-id-card', label: 'Top card worker · today',
          name: top.staff_name || '—',
          reason: `${top.cards_worked} cards worked · ${Number(top.card_sales_liters || 0).toLocaleString()} L`,
          crown: '🎖',
        })
      }

      // Top transaction claimant today
      const { data: txns } = await supabase
        .from('transactions')
        .select('claimed_by, amount')
        .eq('station_id', user.station_id)
        .eq('status', 'claimed')
        .gte('received_at', today + 'T00:00:00')
        .lte('received_at', today + 'T23:59:59')
      const txnTotals = {}
      ;(txns || []).forEach(t => {
        if (!t.claimed_by) return
        txnTotals[t.claimed_by] = (txnTotals[t.claimed_by] || 0) + Number(t.amount || 0)
      })
      const txnSorted = Object.entries(txnTotals).sort((a,b) => b[1] - a[1])
      if (txnSorted[0]) {
        computed.push({
          type: 'cards', icon: 'fa-receipt', label: 'Top transactions · today',
          name: nameById[txnSorted[0][0]] || '—',
          reason: `UGX ${txnSorted[0][1].toLocaleString()} claimed`,
          crown: '💎',
        })
      }

      if (computed.length === 0) {
        computed.push({
          type: 'liters', icon: 'fa-gas-pump', label: 'Waiting for first activity',
          name: 'No data yet',
          reason: 'Winners will appear here once the team starts working',
          crown: '👑',
        })
      }

      const fillers = [
        { type:'cards', icon:'fa-credit-card', label:'Top on cards', name:'—', reason:'Card leaders appear here', crown:'🏆' },
        { type:'gas',   icon:'fa-fire',        label:'Top on gas',   name:'—', reason:'LPG leaders appear here',   crown:'🥇' },
        { type:'lub',   icon:'fa-oil-can',     label:'Top on lubricants', name:'—', reason:'Lubricant leaders appear here', crown:'🥈' },
      ]
      let fi = 0
      while (computed.length < 4 && fi < fillers.length) computed.push(fillers[fi++])

      setTiles(computed)
      setLoading(false)
    }
    load()
  }, [user.station_id])

  useEffect(() => {
    if (tiles.length < 2) return
    const t = setInterval(() => setIndex(i => (i + 1) % tiles.length), 5000)
    return () => clearInterval(t)
  }, [tiles.length])

  if (loading || tiles.length === 0) return null

  return (
    <div className="winner-strip">
      <div className="title">
        <i className="fas fa-trophy" /> Top performers · rotating
      </div>
      <div className="winner-slides">
        {tiles.map((w, i) => (
          <div key={i} className={`winner-slide ${i === (index % tiles.length) ? 'active' : ''}`}>
            <div className={`icon ${w.type}`}>
              <i className={`fas ${w.icon}`} />
            </div>
            <div className="info">
              <div className="name">{w.name} — {w.label}</div>
              <div className="reason">{w.reason}</div>
            </div>
            <div className="crown">{w.crown}</div>
          </div>
        ))}
      </div>
      <div className="winner-strip-dots">
        {tiles.map((_, i) => (
          <div
            key={i}
            className={`dot ${i === (index % tiles.length) ? 'active' : ''}`}
            onClick={() => setIndex(i)}
          />
        ))}
      </div>
    </div>
  )
}

/* ============================================================
   WINNER CARDS — 3 cards now
   ============================================================ */
function WinnerCards({ profile }) {
  const user = profile.user
  const canEdit = ['admin','manager','supervisor'].includes(user.role)

  const [today, setToday] = useState(null)
  const [week, setWeek] = useState(null)
  const [txnTop, setTxnTop] = useState(null)
  const [openPicker, setOpenPicker] = useState(false)

  async function load() {
    const today_iso = new Date().toISOString().slice(0, 10)

    // Today's drops
    const { data: todayShifts } = await supabase
      .from('shifts')
      .select('id')
      .eq('station_id', user.station_id)
      .eq('shift_date', today_iso)
    const tIds = (todayShifts || []).map(s => s.id)

    let todayDrops = []
    if (tIds.length > 0) {
      const { data } = await supabase
        .from('money_drops')
        .select('attendant_id, amount')
        .in('shift_id', tIds)
        .eq('status', 'active')
      todayDrops = data || []
    }

    const { data: users } = await supabase
      .from('users')
      .select('id, name, initials')
      .eq('station_id', user.station_id)
    const nameById = {}
    ;(users || []).forEach(u => { nameById[u.id] = u.name })

    const totals = {}
    todayDrops.forEach(d => {
      totals[d.attendant_id] = (totals[d.attendant_id] || 0) + Number(d.amount)
    })
    const sorted = Object.entries(totals).sort((a,b) => b[1] - a[1])
    if (sorted[0]) {
      setToday({ name: nameById[sorted[0][0]] || '—', total: sorted[0][1] })
    } else {
      setToday(null)
    }

    // Week champion (manual)
    const weekStart = getMondayISO()
    const { data: champ } = await supabase
      .from('champion_selections')
      .select('*')
      .eq('station_id', user.station_id)
      .eq('kind', 'week_champion')
      .eq('week_start', weekStart)
      .maybeSingle()

    if (champ) {
      setWeek({
        name: nameById[champ.user_id] || '—',
        reason: champ.reason || 'Champion this week',
      })
    } else {
      setWeek(null)
    }

    // Today's transaction top claimant
    const { data: txns } = await supabase
      .from('transactions')
      .select('claimed_by, amount')
      .eq('station_id', user.station_id)
      .eq('status', 'claimed')
      .gte('received_at', today_iso + 'T00:00:00')
      .lte('received_at', today_iso + 'T23:59:59')

    const txnTotals = {}
    ;(txns || []).forEach(t => {
      if (!t.claimed_by) return
      txnTotals[t.claimed_by] = (txnTotals[t.claimed_by] || 0) + Number(t.amount || 0)
    })
    const txnSorted = Object.entries(txnTotals).sort((a,b) => b[1] - a[1])
    if (txnSorted[0]) {
      setTxnTop({ name: nameById[txnSorted[0][0]] || '—', total: txnSorted[0][1] })
    } else {
      setTxnTop(null)
    }
  }

  useEffect(() => { load() }, [user.station_id])

  return (
    <div className="winners">
      <div className="winner-card">
        <div className="label"><i className="fas fa-sun" /> Today's Top Attendant</div>
        <div className="crown">👑</div>
        <div className="name">{today?.name || '—'}</div>
        <div className="role">Attendant · Day shift</div>
        <div className="metric">
          <i className="fas fa-money-bill-wave" />
          {today ? `UGX ${today.total.toLocaleString()} collected today` : 'No drops yet today'}
        </div>
      </div>

      <div className="winner-card week">
        <div className="label"><i className="fas fa-calendar-week" /> This Week's Champion</div>
        {canEdit && (
          <button className="champion-edit" onClick={() => setOpenPicker(true)} title="Choose this week's champion">
            <i className="fas fa-pen" />
          </button>
        )}
        <div className="crown">🏆</div>
        <div className="name">{week?.name || '—'}</div>
        <div className="role">{week ? 'Selected by manager' : 'Not chosen yet'}</div>
        <div className="metric">
          <i className="fas fa-fire" />
          {week ? week.reason : 'Waiting for manager to pick'}
        </div>
      </div>

      <div className="winner-card txn">
        <div className="label"><i className="fas fa-receipt" /> Top Transaction Attendant</div>
        <div className="crown">💎</div>
        <div className="name">{txnTop?.name || '—'}</div>
        <div className="role">Most confirmed transactions today</div>
        <div className="metric">
          <i className="fas fa-money-bill-wave" />
          {txnTop ? `UGX ${txnTop.total.toLocaleString()} claimed` : 'No transactions claimed yet'}
        </div>
      </div>

      {openPicker && (
        <ChampionPicker
          profile={profile}
          onClose={() => setOpenPicker(false)}
          onSaved={async () => { setOpenPicker(false); await load() }}
        />
      )}
    </div>
  )
}

/* ============================================================
   CHAMPION PICKER
   ============================================================ */
function ChampionPicker({ profile, onClose, onSaved }) {
  const user = profile.user
  const [staff, setStaff] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('users')
        .select('id, name, role')
        .eq('station_id', user.station_id)
        .in('role', ['attendant','ambassador'])
        .eq('is_active', true)
        .order('name')
      setStaff(data || [])
    }
    load()
  }, [user.station_id])

  async function save() {
    if (!selectedId) { setErr('Pick someone'); return }
    setBusy(true); setErr('')

    const weekStart = getMondayISO()
    const reasonText = reason.trim() || 'Champion this week'

    const { error } = await supabase
      .from('champion_selections')
      .upsert({
        station_id: user.station_id,
        kind: 'week_champion',
        week_start: weekStart,
        user_id: selectedId,
        reason: reasonText,
        selected_by: user.id,
        selected_at: new Date().toISOString(),
      }, { onConflict: 'station_id,kind,week_start' })

    setBusy(false)
    if (error) { setErr(error.message); return }
    onSaved()
  }

  return (
    <div className="modal-bg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <h3>Choose This Week's Champion</h3>
        <div className="modal-sub">Week starting {formatWeekStart()}</div>

        <label>Champion</label>
        <select value={selectedId} onChange={e => setSelectedId(e.target.value)}>
          <option value="">— Pick —</option>
          {staff.map(s => (
            <option key={s.id} value={s.id}>{s.name} ({s.role})</option>
          ))}
        </select>

        <label>Reason (shown on Home)</label>
        <input
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder='e.g. "3,420 L this week · #1 of 22"'
        />

        {err && <div className="auth-err">{err}</div>}

        <div className="modal-actions">
          <button className="btn-ghost-full" onClick={onClose}>Cancel</button>
          <button className="btn-primary-full" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save champion'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ============================================================
   THANKS LIST
   ============================================================ */
function ThanksList({ profile }) {
  const user = profile.user
  const [items, setItems] = useState([])

  useEffect(() => {
    async function load() {
      const today = new Date().toISOString().slice(0, 10)
      const { data: shifts } = await supabase
        .from('shifts')
        .select('id')
        .eq('station_id', user.station_id)
        .eq('shift_date', today)
      const ids = (shifts || []).map(s => s.id)

      let drops = []
      if (ids.length > 0) {
        const { data } = await supabase
          .from('money_drops')
          .select('attendant_id, amount')
          .in('shift_id', ids)
          .eq('status', 'active')
        drops = data || []
      }

      const { data: users } = await supabase
        .from('users')
        .select('id, name, initials')
        .eq('station_id', user.station_id)
      const map = {}
      ;(users || []).forEach(u => { map[u.id] = u })

      const totals = {}
      drops.forEach(d => {
        totals[d.attendant_id] = (totals[d.attendant_id] || 0) + Number(d.amount)
      })
      const top = Object.entries(totals).sort((a,b) => b[1] - a[1]).slice(0, 3)

      const built = top.map(([id, total]) => ({
        initials: map[id]?.initials || '??',
        name: `Thanks ${map[id]?.name || '—'} 🙏`,
        reason: `UGX ${total.toLocaleString()} collected today`,
      }))

      if (built.length === 0) {
        built.push({ initials: 'TX', name: 'TEXOL LEGACY team', reason: 'Ready for another great shift' })
      }

      setItems(built)
    }
    load()
  }, [user.station_id])

  if (items.length === 0) return null

  return (
    <div className="thanks-list">
      {items.map((item, i) => (
        <div key={i} className="thanks-row">
          <div className="avatar">{item.initials}</div>
          <div className="info">
            <div className="name">{item.name}</div>
            <div className="reason">{item.reason}</div>
          </div>
          <div className="heart">❤️</div>
        </div>
      ))}
    </div>
  )
}

/* ============================================================
   LIVE STATS
   ============================================================ */
function LiveStats({ profile, onNavigate }) {
  const user = profile.user
  const station = profile.station
  const [stats, setStats] = useState({
    staffCount: null, dropTotal: null, dropCount: null,
    openShifts: null, pendingAttendance: null, txnCount: null,
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const stationId = user.station_id
      const today = new Date().toISOString().slice(0, 10)

      const [staffRes, shiftsRes, attRes, txnRes] = await Promise.all([
        supabase.from('users').select('id', { count: 'exact', head: true })
          .eq('station_id', stationId).eq('is_active', true),
        supabase.from('shifts').select('id, status')
          .eq('station_id', stationId).eq('shift_date', today),
        supabase.from('attendance').select('id', { count: 'exact', head: true })
          .eq('status', 'pending'),
        supabase.from('transactions').select('id', { count: 'exact', head: true })
          .eq('station_id', stationId).eq('status', 'claimed')
          .gte('received_at', today + 'T00:00:00'),
      ])

      if (cancelled) return

      const shiftIds = (shiftsRes.data || []).map(s => s.id)
      let drops = []
      if (shiftIds.length > 0) {
        const { data } = await supabase.from('money_drops').select('amount').in('shift_id', shiftIds)
        drops = data || []
      }

      setStats({
        staffCount: staffRes.count ?? 0,
        openShifts: (shiftsRes.data || []).filter(s => s.status === 'open').length,
        dropTotal: drops.reduce((s, d) => s + Number(d.amount), 0),
        dropCount: drops.length,
        pendingAttendance: attRes.count ?? 0,
        txnCount: txnRes.count ?? 0,
      })
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [user.station_id])

  return (
    <>
      <div className="card-panel" style={{ gridTemplateColumns: '1fr', paddingBottom: 20 }}>
        <div className="card" style={{
          background: 'linear-gradient(135deg, #d4a91e 0%, #f0c94b 100%)',
          border: 'none', color: '#0b1a2e',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
            <div style={{
              width: 64, height: 64, borderRadius: 20,
              background: 'rgba(11,26,46,.15)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 32, flexShrink: 0,
            }}>💰</div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '1.4px', fontWeight: 800, opacity: .75, marginBottom: 4 }}>
                Quick Access
              </div>
              <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>
                TEXOL Collect
              </div>
              <div style={{ fontSize: 13, opacity: .8 }}>
                Record money drops fast · installable as an app
              </div>
            </div>
            <button
              onClick={() => window.location.href = '/?mode=collect'}
              style={{
                background: '#0b1a2e', color: '#f0c94b',
                padding: '14px 26px', border: 'none', borderRadius: 12,
                fontWeight: 700, fontSize: 14, cursor: 'pointer',
                fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 10,
              }}
            >
              <i className="fas fa-arrow-right" /> Open
            </button>
          </div>
        </div>
      </div>

      <div className="dashboard-grid">
        <StatCard title="👥 Staff on register" value={loading ? '—' : `${stats.staffCount}`} sub="Active at your station" />
        <StatCard title="🟢 Open shifts today" value={loading ? '—' : `${stats.openShifts}`} sub={new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} />
        <StatCard title="💰 Drops today" value={loading ? '—' : `UGX ${stats.dropTotal.toLocaleString()}`} sub={loading ? '' : `${stats.dropCount} drops`} />
        <StatCard title="📱 Transactions claimed" value={loading ? '—' : `${stats.txnCount}`} sub="Today" />
      </div>

      <div className="card-panel">
        <div className="card">
          <h3><i className="fas fa-bolt" /> Quick actions</h3>
          <div className="quick-actions">
            <button className="quick-action" onClick={() => onNavigate('attendance')}>
              <i className="fas fa-clock" /><span>Clock In / Out</span>
            </button>
            <button className="quick-action" onClick={() => onNavigate('drops')}>
              <i className="fas fa-money-bill-wave" /><span>Record Drop</span>
            </button>
            <button className="quick-action" onClick={() => onNavigate('balance')}>
              <i className="fas fa-cash-register" /><span>Shift Balance</span>
            </button>
            <button className="quick-action" onClick={() => onNavigate('timetable')}>
              <i className="fas fa-calendar-alt" /><span>Shifts</span>
            </button>
          </div>
        </div>
        <div className="card">
          <h3><i className="fas fa-info-circle" /> Your session</h3>
          <div className="fuel-row"><span className="label">Name</span><span className="value">{user.name}</span></div>
          <div className="fuel-row"><span className="label">Role</span><span className="value">{capitalize(user.role)}</span></div>
          <div className="fuel-row"><span className="label">Access</span><span className="value">{user.access_score}%</span></div>
          <div className="fuel-row"><span className="label">Station</span><span className="value">{station?.name || '—'}</span></div>
        </div>
      </div>
    </>
  )
}

function StatCard({ title, value, sub }) {
  return (
    <div className="stat-card">
      <div className="stat-title">{title}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  )
}

/* ============================================================
   HELPERS
   ============================================================ */
function getMondayISO() {
  const d = new Date()
  const day = d.getDay()
  const diff = (day + 6) % 7
  d.setDate(d.getDate() - diff)
  return d.toISOString().slice(0, 10)
}

function formatWeekStart() {
  const d = new Date(getMondayISO())
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function capitalize(s = '') {
  return s.charAt(0).toUpperCase() + s.slice(1)
}