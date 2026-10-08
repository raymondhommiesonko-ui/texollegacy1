import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { useProfile } from './hooks'
import { MENU, SCREEN_TITLES, FUTURE_SCREENS } from './constants'
import Home from './screens/Home'
import Attendance from './screens/Attendance'
import Drops from './screens/Drops'
import Collect from './screens/Collect'
import Shifts from './screens/Shifts'
import Balance from './screens/Balance'
import Staff from './screens/Staff'
import Notifications from './screens/Notifications'
import Account from './screens/Account'
import FuelCards from './screens/FuelCards'
import Shortages from './screens/Shortages'
import Customers from './screens/Customers'
import Reports from './screens/Reports'
import Balancing from './screens/Balancing'
import Transactions from './screens/Transactions'
import Settings from './screens/Settings'
import TransactionPopup from './TransactionPopup'
import { useRealtimeTransactions } from './useRealtimeTransactions'
import './App.css'

export default function App() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  const [autoCollect, setAutoCollect] = useState(
    new URLSearchParams(window.location.search).get('mode') === 'collect'
  )

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])

  if (loading) return <div className="loading">Loading…</div>
  if (!session) return <Login />
  return (
    <Portal
      session={session}
      autoCollect={autoCollect}
      onExitCollect={() => {
        setAutoCollect(false)
        window.history.replaceState({}, '', '/')
      }}
    />
  )
}

/* ============================================================
   LOGIN
   ============================================================ */
function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function signIn(e) {
    e.preventDefault()
    setBusy(true); setErr('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setErr(error.message)
    setBusy(false)
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-logo">⛽</div>
        <h1>TEXOL PORTAL</h1>
        <p className="auth-tag">Employee Portal · Uganda</p>
        <form onSubmit={signIn}>
          <label>Email</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} required />
          <label>Password</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} required />
          {err && <div className="auth-err">{err}</div>}
          <button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'SIGN IN'}</button>
        </form>
      </div>
    </div>
  )
}

/* ============================================================
   PORTAL
   ============================================================ */
function Portal({ session, autoCollect = false, onExitCollect }) {
  const { profile, loading } = useProfile(session)
  const [screen, setScreen] = useState('home')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [roleMenuOpen, setRoleMenuOpen] = useState(false)
  const [collectMode, setCollectMode] = useState(autoCollect)
  const [activeShift, setActiveShift] = useState(null)
  const [unreadCount, setUnreadCount] = useState(0)
  const [popupTxn, setPopupTxn] = useState(null)
  const [popupQueue, setPopupQueue] = useState([])

  useEffect(() => {
    function closeMenus() { setRoleMenuOpen(false) }
    document.addEventListener('click', closeMenus)
    return () => document.removeEventListener('click', closeMenus)
  }, [])

  useEffect(() => { setCollectMode(autoCollect) }, [autoCollect])

  // Load unread notification count
  useEffect(() => {
    if (!profile?.user?.id) return
    async function loadCount() {
      const { data: reads } = await supabase
        .from('notification_reads')
        .select('notification_id')
        .eq('user_id', profile.user.id)
      const { data: notifs } = await supabase
        .from('notifications')
        .select('id')
      const readIds = new Set((reads || []).map(r => r.notification_id))
      const unread = (notifs || []).filter(n => !readIds.has(n.id)).length
      setUnreadCount(unread)
    }
    loadCount()
  }, [profile?.user?.id, screen])

  // Realtime transactions — only for staff who can view or claim
  const canReceivePopups = profile?.user && (
    ['admin','manager','supervisor','ambassador','attendant','company_phone'].includes(profile.user.role)
  )

  useRealtimeTransactions(
    canReceivePopups ? profile?.user?.station_id : null,
    // New transaction arrives
    (txn) => {
      if (popupTxn) {
        setPopupQueue(q => [...q, txn])
      } else {
        setPopupTxn(txn)
      }
    },
    // Transaction was claimed elsewhere
    (updated) => {
      if (popupTxn && popupTxn.id === updated.id && updated.status === 'claimed') {
        setPopupTxn(null)
        setPopupQueue(q => {
          if (q.length > 0) {
            const [next, ...rest] = q
            setTimeout(() => setPopupTxn(next), 300)
            return rest
          }
          return q
        })
      }
    }
  )

  if (loading || !profile?.user) {
    return <div className="loading">Loading your profile…</div>
  }

  const user = profile.user
  const station = profile.station
  const access = user.access_score ?? 30
  const isCompanyPhone = user.role === 'company_phone'

  // Collect mode: full screen
  if (collectMode) {
    return (
      <Collect
        profile={profile}
        onExit={() => {
          setCollectMode(false)
          if (onExitCollect) onExitCollect()
        }}
      />
    )
  }

  // Sidebar menu — different rules for company phones
  let visibleMenu
  if (isCompanyPhone) {
    const allowedIds = ['home', 'transactions', 'drops']
    visibleMenu = MENU.map(group => ({
      ...group,
      items: group.items.filter(item => allowedIds.includes(item.id))
    })).filter(group => group.items.length > 0)
  } else {
    visibleMenu = MENU.map(group => ({
      ...group,
      items: group.items.filter(item => access >= item.minAccess)
    })).filter(group => group.items.length > 0)
  }

  function go(id) {
    setScreen(id)
    setSidebarOpen(false)
  }

  return (
    <div className="layout">
      {sidebarOpen && <div className="backdrop" onClick={() => setSidebarOpen(false)} />}

      {/* SIDEBAR */}
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <h1><i className="fas fa-gas-pump" /> TEXOL</h1>
          <div className="station-switch">
            <i className="fas fa-gas-pump" />
            <span className="name">{station?.name || 'STATION'}</span>
            <i className="fas fa-chevron-down chevron" />
          </div>
        </div>

        <nav className="sidebar-menu">
          {visibleMenu.map(group => (
            <div key={group.group}>
              <div className="menu-label">{group.group}</div>
              {group.items.map(item => (
                <a
                  key={item.id}
                  className={screen === item.id ? 'active' : ''}
                  onClick={() => go(item.id)}
                >
                  <i className={`fas ${item.icon}`} />
                  <span>{item.label}</span>
                  {item.id === 'notifications' && !isCompanyPhone && unreadCount > 0 && (
                    <span className="badge red">{unreadCount}</span>
                  )}
                  {item.badge && item.id !== 'notifications' && !isCompanyPhone && (
                    <span className={`badge ${item.badgeColor === 'red' ? 'red' : ''}`}>
                      {item.badge}
                    </span>
                  )}
                </a>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <span className="user-name">{user.name?.toUpperCase()}</span>
          <div className="user-role">
            <span>{isCompanyPhone ? 'Company Phone' : capitalize(user.role)}</span>
            <span className="access-pill">{access}%</span>
          </div>
        </div>
      </aside>

      {/* MAIN */}
      <main className="main">
        {/* TOPBAR */}
        <header className="topbar">
          <div className="topbar-left">
            <button className="menu-toggle" onClick={() => setSidebarOpen(true)}>
              <i className="fas fa-bars" />
            </button>
            <h2>
              <i className="fas fa-tachometer-alt" />
              <span className="title-text">
                {SCREEN_TITLES[screen] || 'TEXOL'} · {station?.name || ''}
              </span>
            </h2>
          </div>
          <div className="topbar-right">
            {/* Notification bell — hidden for company phones */}
            {!isCompanyPhone && (
              <button className="notif-btn" onClick={() => go('notifications')}>
                <i className="fas fa-bell" />
                {unreadCount > 0 && <span className="dot" />}
              </button>
            )}

            <div className="role-switcher">
              <button onClick={e => { e.stopPropagation(); setRoleMenuOpen(v => !v) }}>
                <div className="avatar">{initialsOf(user.name)}</div>
                <div className="info">
                  <div className="name">{user.name}</div>
                  <div className="role">
                    {isCompanyPhone ? 'Company Phone' : capitalize(user.role)} · {access}%
                  </div>
                </div>
                <i className="fas fa-chevron-down chevron" />
              </button>
              {roleMenuOpen && (
                <div className="role-menu open">
                  <div className="role-menu-head">Signed in as</div>
                  <div className="role-item active">
                    <div className="avatar">{initialsOf(user.name)}</div>
                    <div className="info">
                      <div className="name">{user.name}</div>
                      <div className="role">
                        {isCompanyPhone ? 'Company Phone' : capitalize(user.role)}
                      </div>
                    </div>
                    <div className="access">{access}%</div>
                  </div>

                  {/* My account — hidden for company phones */}
                  {!isCompanyPhone && (
                    <button
                      className="signout-btn"
                      style={{ color: '#0b1a2e' }}
                      onClick={() => { setRoleMenuOpen(false); setScreen('account') }}
                    >
                      <i className="fas fa-user-circle" /> My account
                    </button>
                  )}

                  <button className="signout-btn" onClick={() => supabase.auth.signOut()}>
                    <i className="fas fa-sign-out-alt" /> Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* SCREEN CONTENT */}
        <div className="screen-wrap">
          {screen === 'home' && <Home profile={profile} onNavigate={go} />}
          {screen === 'attendance' && !isCompanyPhone && <Attendance profile={profile} />}
          {screen === 'drops' && <Drops profile={profile} onOpenCollect={() => {}} />}
          {screen === 'transactions' && <Transactions profile={profile} />}
          {screen === 'timetable' && !isCompanyPhone && (
            <Shifts
              profile={profile}
              onOpenShift={(s) => { setActiveShift(s); setScreen('balance') }}
            />
          )}
          {screen === 'balance' && !isCompanyPhone && (
            <Balance profile={profile} activeShift={activeShift} />
          )}
          {screen === 'balancing' && !isCompanyPhone && <Balancing profile={profile} />}
          {screen === 'staff' && !isCompanyPhone && <Staff profile={profile} />}
          {screen === 'notifications' && !isCompanyPhone && <Notifications profile={profile} />}
          {screen === 'account' && !isCompanyPhone && <Account profile={profile} />}
          {screen === 'account' && isCompanyPhone && (
            <div className="drops-empty">
              <i className="fas fa-lock" />
              <h4>Not available</h4>
              <p>Company phone accounts can't change their own password. Ask an admin.</p>
            </div>
          )}
          {screen === 'fuel-cards' && !isCompanyPhone && <FuelCards profile={profile} />}
          {screen === 'shortages' && !isCompanyPhone && <Shortages profile={profile} />}
          {screen === 'customers' && !isCompanyPhone && <Customers profile={profile} />}
          {screen === 'reports' && !isCompanyPhone && <Reports profile={profile} />}
          {screen === 'settings' && !isCompanyPhone && <Settings profile={profile} />}

          {screen !== 'home' && screen !== 'attendance' && screen !== 'drops' &&
           screen !== 'timetable' && screen !== 'balance' && screen !== 'staff' &&
           screen !== 'notifications' && screen !== 'account' &&
           screen !== 'fuel-cards' && screen !== 'shortages' &&
           screen !== 'customers' && screen !== 'reports' &&
           screen !== 'transactions' && screen !== 'balancing' &&
           screen !== 'settings' && (
            <Placeholder screenId={screen} onBack={() => go('home')} />
          )}
        </div>
      </main>

      {/* TRANSACTION POPUP */}
      {popupTxn && (
        <TransactionPopup
          txn={popupTxn}
          onClose={() => {
            setPopupTxn(null)
            setPopupQueue(q => {
              if (q.length > 0) {
                const [next, ...rest] = q
                setTimeout(() => setPopupTxn(next), 300)
                return rest
              }
              return q
            })
          }}
          onClaimed={() => {}}
        />
      )}
    </div>
  )
}

/* ============================================================
   PLACEHOLDER
   ============================================================ */
function Placeholder({ screenId, onBack }) {
  const session = FUTURE_SCREENS[screenId] || 'a future session'
  const title = SCREEN_TITLES[screenId] || screenId
  return (
    <div className="placeholder">
      <div className="placeholder-icon">🚧</div>
      <h2>{title}</h2>
      <p>Coming in <strong>{session}</strong></p>
      <button onClick={onBack}>← Back to home</button>
    </div>
  )
}

/* ============================================================
   HELPERS
   ============================================================ */
function initialsOf(name = '') {
  return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || '??'
}
function capitalize(s = '') {
  return s.charAt(0).toUpperCase() + s.slice(1)
}