import { useEffect, useState } from 'react'
import { supabase } from '../supabase'

export default function Notifications({ profile }) {
  const user = profile.user
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')

  async function loadAll() {
    setLoading(true)
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100)
    setRows(data || [])
    setLoading(false)
  }

  useEffect(() => { loadAll() }, [user.id])

  // Read/unread via notification_reads
  const [reads, setReads] = useState({})
  useEffect(() => {
    async function loadReads() {
      const { data } = await supabase
        .from('notification_reads')
        .select('notification_id')
        .eq('user_id', user.id)
      const map = {}
      ;(data || []).forEach(r => { map[r.notification_id] = true })
      setReads(map)
    }
    loadReads()
  }, [user.id])

  async function markRead(id) {
    await supabase.from('notification_reads').upsert({
      notification_id: id,
      user_id: user.id,
    })
    setReads(r => ({ ...r, [id]: true }))
  }

  async function markAllRead() {
    const rows = visible.filter(n => !reads[n.id])
    if (rows.length === 0) return
    await supabase.from('notification_reads').upsert(
      rows.map(r => ({ notification_id: r.id, user_id: user.id }))
    )
    setReads(prev => {
      const next = { ...prev }
      rows.forEach(r => { next[r.id] = true })
      return next
    })
  }

  const visible = filter === 'unread'
    ? rows.filter(r => !reads[r.id])
    : rows

  function fmt(iso) {
    const d = new Date(iso)
    const now = Date.now()
    const diffMin = Math.floor((now - d.getTime()) / 60000)
    if (diffMin < 1) return 'just now'
    if (diffMin < 60) return `${diffMin}m ago`
    if (diffMin < 1440) return `${Math.floor(diffMin/60)}h ago`
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
  }

  return (
    <div className="notif-screen">
      <div className="notif-head">
        <div>
          <h3>Notifications</h3>
          <div className="sub">{rows.length} total · {rows.filter(r => !reads[r.id]).length} unread</div>
        </div>
        <div className="notif-actions">
          <select value={filter} onChange={e => setFilter(e.target.value)}>
            <option value="all">All</option>
            <option value="unread">Unread only</option>
          </select>
          <button className="btn-ghost" onClick={markAllRead}>
            <i className="fas fa-check-double" /> Mark all read
          </button>
        </div>
      </div>

      {loading ? (
        <div className="notif-empty">Loading…</div>
      ) : visible.length === 0 ? (
        <div className="notif-empty">
          <i className="fas fa-bell-slash" />
          <h4>No notifications</h4>
        </div>
      ) : (
        <div className="notif-list">
          {visible.map(n => {
            const isUnread = !reads[n.id]
            return (
              <div
                key={n.id}
                className={`notif-item ${isUnread ? 'unread' : ''}`}
                onClick={() => markRead(n.id)}
              >
                <div className={`notif-icon type-${n.type}`}>
                  <i className={
                    n.type === 'meeting' ? 'fas fa-users' :
                    n.type === 'alert' ? 'fas fa-exclamation-triangle' :
                    n.type === 'approval' ? 'fas fa-check-circle' :
                    'fas fa-info-circle'
                  } />
                </div>
                <div className="notif-body">
                  <div className="notif-title">{n.title}</div>
                  {n.body && <div className="notif-text">{n.body}</div>}
                  <div className="notif-meta">{fmt(n.created_at)}</div>
                </div>
                {isUnread && <div className="notif-dot" />}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}