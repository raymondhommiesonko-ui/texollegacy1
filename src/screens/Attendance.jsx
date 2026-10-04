import { useEffect, useRef, useState } from 'react'
import { supabase } from '../supabase'

export default function Attendance({ profile }) {
  const user = profile.user
  const canApprove = (user.access_score ?? 30) >= 60
  const canSeeOthers = canApprove || user.role === 'admin'

  const [myRecord, setMyRecord] = useState(null)
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [clockModal, setClockModal] = useState(null)

  async function loadAll() {
    setLoading(true)
    const today = new Date().toISOString().slice(0, 10)
    const start = today + 'T00:00:00'
    const end = today + 'T23:59:59'

    const { data: mine } = await supabase
      .from('attendance')
      .select('*')
      .eq('user_id', user.id)
      .gte('clock_in_at', start)
      .lte('clock_in_at', end)
      .order('clock_in_at', { ascending: false })
      .limit(1)
    setMyRecord(mine?.[0] || null)

    let query = supabase
      .from('attendance')
      .select('*, user:users!attendance_user_id_fkey(id, name, role, initials)')
      .order('clock_in_at', { ascending: false })
      .limit(50)

    if (!canSeeOthers) {
      query = query.eq('user_id', user.id)
    }

    const { data, error } = await query
    if (!error) setRecords(data || [])
    setLoading(false)
  }

  useEffect(() => { loadAll() }, [user.id])

  async function clockOut() {
    if (!myRecord) return
    setBusy(true)
    const { error } = await supabase
      .from('attendance')
      .update({ clock_out_at: new Date().toISOString() })
      .eq('id', myRecord.id)
    setBusy(false)
    if (error) { alert(error.message); return }
    setClockModal(null)
    await loadAll()
  }

  async function approve(id) {
    const { error } = await supabase
      .from('attendance')
      .update({
        status: 'approved',
        approved_by: user.id,
        approved_at: new Date().toISOString(),
      })
      .eq('id', id)
    if (error) { alert(error.message); return }
    await loadAll()
  }

  const isClockedIn = myRecord && !myRecord.clock_out_at
  const elapsed = isClockedIn ? formatElapsed(myRecord.clock_in_at) : null

  return (
    <div className="att-screen">
      <div className={`clock-widget ${isClockedIn ? 'clocked-in' : ''}`}>
        <div className="clock-icon">{isClockedIn ? '⏱' : '🕐'}</div>
        <div className="clock-info">
          {isClockedIn ? (
            <>
              <div className="label">Clocked in</div>
              <div className="status">{elapsed}</div>
              <div className="sub">Started {formatTime(myRecord.clock_in_at)} · {myRecord.in_gps || 'no GPS'}</div>
            </>
          ) : (
            <>
              <div className="label">Ready to start?</div>
              <div className="status">Not clocked in</div>
              <div className="sub">Take a selfie and capture your location</div>
            </>
          )}
        </div>
        <div className="clock-action">
          {isClockedIn ? (
            <button className="out" onClick={() => setClockModal('out')}>
              <i className="fas fa-sign-out-alt" /> CLOCK OUT
            </button>
          ) : (
            <button onClick={() => setClockModal('in')}>
              <i className="fas fa-sign-in-alt" /> CLOCK IN NOW
            </button>
          )}
        </div>
      </div>

      <div className="att-head">
        <div>
          <h3>{canSeeOthers ? 'All attendance' : 'My attendance'}</h3>
          <div className="sub">
            {canSeeOthers
              ? 'Clock-ins awaiting approval · GPS + photo captured'
              : 'Your clock-in records'}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="att-empty">Loading…</div>
      ) : records.length === 0 ? (
        <div className="att-empty">
          <i className="fas fa-clock" />
          <h4>No records yet</h4>
          <p>{canSeeOthers ? 'Staff haven\'t clocked in.' : 'Tap CLOCK IN above to start your day.'}</p>
        </div>
      ) : (
        <div className="att-list">
          {records.map(r => (
            <AttendanceRow
              key={r.id}
              record={r}
              canApprove={canApprove}
              onApprove={() => approve(r.id)}
            />
          ))}
        </div>
      )}

      {clockModal === 'in' && (
        <ClockInModal
          user={user}
          onClose={() => setClockModal(null)}
          onSaved={async () => { setClockModal(null); await loadAll() }}
        />
      )}
      {clockModal === 'out' && (
        <ClockOutModal
          record={myRecord}
          busy={busy}
          onClose={() => setClockModal(null)}
          onConfirm={clockOut}
        />
      )}
    </div>
  )
}

function AttendanceRow({ record, canApprove, onApprove }) {
  const user = record.user || {}
  const initials = user.initials || (user.name || '??').split(' ').map(n => n[0]).join('').slice(0, 2)
  const isApproved = record.status === 'approved'
  const isPending = record.status === 'pending'
  const clockedOut = !!record.clock_out_at

  return (
    <div className="att-row">
      {record.in_photo_url ? (
        <img className="att-photo" src={record.in_photo_url} alt="" />
      ) : (
        <div className="att-avatar">{initials}</div>
      )}
      <div className="att-info">
        <div className="att-name">
          {user.name || 'Unknown'}
          {record.late_minutes > 0 && <span className="late-badge">Late {record.late_minutes}m</span>}
        </div>
        <div className="att-meta">
          {formatDate(record.clock_in_at)} · {formatTime(record.clock_in_at)}
          {clockedOut && <> → {formatTime(record.clock_out_at)}</>}
        </div>
        {record.in_gps && (
          <div className="att-loc"><i className="fas fa-map-marker-alt" /> {record.in_gps}</div>
        )}
      </div>
      <div className="att-right">
        <span className={`pill ${isApproved ? 'green' : 'amber'}`}>{record.status}</span>
        {isPending && canApprove && (
          <button className="btn-sm-approve" onClick={onApprove}>
            <i className="fas fa-check" /> Approve
          </button>
        )}
      </div>
    </div>
  )
}

/* ============================================================
   CLOCK-IN MODAL
   ============================================================ */
function ClockInModal({ user, onClose, onSaved }) {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)

  const [cameraState, setCameraState] = useState('idle') // idle | loading | ready | error | captured
  const [cameraErr, setCameraErr] = useState('')
  const [photo, setPhoto] = useState(null)

  const [location, setLocation] = useState(null)
  const [locError, setLocError] = useState('')
  const [locLoading, setLocLoading] = useState(true)

  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  // Request location on mount
  useEffect(() => {
    if (!navigator.geolocation) {
      setLocError('GPS not supported on this device')
      setLocLoading(false)
      return
    }
    navigator.geolocation.getCurrentPosition(
      pos => {
        setLocation({
          lat: pos.coords.latitude.toFixed(5),
          lng: pos.coords.longitude.toFixed(5),
          accuracy: Math.round(pos.coords.accuracy),
        })
        setLocLoading(false)
      },
      err => {
        let msg = 'Location unavailable'
        if (err.code === 1) msg = 'Location permission denied — check browser settings'
        else if (err.code === 2) msg = 'Location not available right now'
        else if (err.code === 3) msg = 'Location request timed out'
        setLocError(msg)
        setLocLoading(false)
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    )
  }, [])

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop())
      }
    }
  }, [])

  async function enableCamera() {
    setCameraState('loading')
    setCameraErr('')
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Camera API not available. Must use HTTPS.')
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play().catch(() => {})
      }
      setCameraState('ready')
    } catch (e) {
      let msg = 'Could not access camera'
      if (e.name === 'NotAllowedError') msg = 'Camera permission denied — allow camera in browser settings and reload'
      else if (e.name === 'NotFoundError') msg = 'No camera found on this device'
      else if (e.name === 'NotReadableError') msg = 'Camera is in use by another app'
      else if (e.message) msg = e.message
      setCameraErr(msg)
      setCameraState('error')
    }
  }

  function capture() {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return
    const w = video.videoWidth || 480
    const h = video.videoHeight || 480
    canvas.width = w
    canvas.height = h
    canvas.getContext('2d').drawImage(video, 0, 0, w, h)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.7)
    setPhoto(dataUrl)
    setCameraState('captured')
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
  }

  function retake() {
    setPhoto(null)
    enableCamera()
  }

  async function submit() {
    setBusy(true); setErr('')
    try {
      let photoUrl = null
      if (photo) {
        const blob = await (await fetch(photo)).blob()
        const filename = `${user.id}/${Date.now()}.jpg`
        const { error: upErr } = await supabase.storage
          .from('attendance-photos')
          .upload(filename, blob, { contentType: 'image/jpeg' })
        if (upErr) {
          // Photo upload failing shouldn't block clock-in
          console.warn('Photo upload failed:', upErr.message)
        } else {
          const { data: { publicUrl } } = supabase.storage
            .from('attendance-photos')
            .getPublicUrl(filename)
          photoUrl = publicUrl
        }
      }

      const gpsText = location ? `${location.lat},${location.lng} (±${location.accuracy}m)` : null
      const { error: insErr } = await supabase
        .from('attendance')
        .insert({
          user_id: user.id,
          clock_in_at: new Date().toISOString(),
          in_gps: gpsText,
          in_photo_url: photoUrl,
          status: 'pending',
        })
      if (insErr) throw insErr

      onSaved()
    } catch (e) {
      setErr(e.message || 'Failed to clock in')
      setBusy(false)
    }
  }

  return (
    <div className="modal-bg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <h3>Clock In — {user.name}</h3>
        <div className="modal-sub">Capture your location and photo</div>

        <div className="camera-box">
          {cameraState === 'idle' && (
            <div className="camera-placeholder">
              <i className="fas fa-camera" />
              <p>Tap "Enable camera" to take a selfie</p>
            </div>
          )}
          {cameraState === 'loading' && (
            <div className="camera-placeholder">
              <i className="fas fa-spinner fa-spin" />
              <p>Starting camera…</p>
            </div>
          )}
          {cameraState === 'ready' && (
            <>
              <video ref={videoRef} autoPlay playsInline muted />
              <div className="capture-hint">Tap Capture below</div>
            </>
          )}
          {cameraState === 'error' && (
            <div className="camera-placeholder">
              <i className="fas fa-exclamation-triangle" style={{ color: '#f59e0b' }} />
              <p>{cameraErr}</p>
              <p style={{ fontSize: 11, opacity: .7, marginTop: 6 }}>You can still clock in without a photo</p>
            </div>
          )}
          {cameraState === 'captured' && photo && (
            <img src={photo} alt="Selfie" />
          )}
        </div>

        <div className="cam-controls">
          {cameraState === 'idle' && (
            <button className="btn-ghost-full" onClick={enableCamera}>
              <i className="fas fa-camera" /> Enable camera
            </button>
          )}
          {cameraState === 'ready' && (
            <button className="btn-primary-full" onClick={capture}>
              <i className="fas fa-circle" /> Capture
            </button>
          )}
          {cameraState === 'error' && (
            <button className="btn-ghost-full" onClick={enableCamera}>
              <i className="fas fa-redo" /> Try again
            </button>
          )}
          {cameraState === 'captured' && (
            <button className="btn-ghost-full" onClick={retake}>
              <i className="fas fa-redo" /> Retake
            </button>
          )}
        </div>

        <div className={`location-box ${locError ? 'error' : ''}`}>
          <i className={
            locLoading ? 'fas fa-spinner fa-spin' :
            locError ? 'fas fa-exclamation-triangle' :
            'fas fa-map-marker-alt'
          } />
          {locLoading ? (
            <div>Getting your location…</div>
          ) : location ? (
            <div>
              <div style={{ fontWeight: 600 }}>Location captured</div>
              <div className="coords">{location.lat},{location.lng} (±{location.accuracy}m)</div>
            </div>
          ) : (
            <div>{locError || 'Location not available'} — you can still clock in</div>
          )}
        </div>

        {err && <div className="auth-err">{err}</div>}

        <div className="modal-actions">
          <button className="btn-ghost-full" onClick={onClose}>Cancel</button>
          <button className="btn-primary-full" onClick={submit} disabled={busy}>
            {busy ? 'Saving…' : <><i className="fas fa-check" /> Confirm Clock In</>}
          </button>
        </div>

        <canvas ref={canvasRef} style={{ display: 'none' }} />
      </div>
    </div>
  )
}

function ClockOutModal({ record, busy, onClose, onConfirm }) {
  if (!record) return null
  return (
    <div className="modal-bg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <h3>Clock Out</h3>
        <div className="modal-sub">
          You've been clocked in for <strong>{formatElapsed(record.clock_in_at)}</strong>
        </div>
        <div className="location-box">
          <i className="fas fa-clock" />
          <div>
            <div style={{ fontWeight: 600 }}>Clocked in at {formatTime(record.clock_in_at)}</div>
            {record.in_gps && <div className="coords">{record.in_gps}</div>}
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn-ghost-full" onClick={onClose}>Cancel</button>
          <button className="btn-primary-full red" onClick={onConfirm} disabled={busy}>
            {busy ? 'Saving…' : <><i className="fas fa-sign-out-alt" /> Confirm Clock Out</>}
          </button>
        </div>
      </div>
    </div>
  )
}

function formatTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
}
function formatDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const today = new Date()
  const isToday = d.toDateString() === today.toDateString()
  if (isToday) return 'Today'
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
}
function formatElapsed(iso) {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}