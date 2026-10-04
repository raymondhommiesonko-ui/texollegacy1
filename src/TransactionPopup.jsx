import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'

export default function TransactionPopup({ txn, onClose, onClaimed }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [success, setSuccess] = useState(false)
  const [color, setColor] = useState(null)
  const [seconds, setSeconds] = useState(30)
  const inputRef = useRef(null)

  useEffect(() => {
    if (inputRef.current) inputRef.current.focus()
  }, [])

  useEffect(() => {
    if (success) return
    const t = setInterval(() => {
      setSeconds(s => {
        if (s <= 1) {
          clearInterval(t)
          onClose()
          return 0
        }
        return s - 1
      })
    }, 1000)
    return () => clearInterval(t)
  }, [success])

  function press(digit) {
    if (busy || success) return
    setErr('')
    if (code.length >= 2) return
    const next = code + digit
    setCode(next)
    if (next.length === 2) {
      setTimeout(() => submit(next), 150)
    }
  }

  function backspace() {
    setCode(c => c.slice(0, -1))
    setErr('')
  }

  async function submit(finalCode) {
    const c = finalCode || code
    if (c.length !== 2) { setErr('Enter 2-digit code'); return }
    setBusy(true); setErr('')

    try {
      const { data, error } = await supabase.rpc('claim_transaction', {
        p_txn_id: txn.txn_id,
        p_code: c,
      })
      if (error) throw error
      if (!data?.ok) {
        setErr(data?.error || 'Could not claim')
        setCode('')
        setBusy(false)
        return
      }
      setColor(data.color)
      setSuccess(true)
      setTimeout(() => {
        onClaimed && onClaimed()
        onClose()
      }, 1400)
    } catch (e) {
      setErr(e.message || 'Error')
      setBusy(false)
      setCode('')
    }
  }

  const providerLabel = txn.provider === 'airtel' ? 'Airtel Money' : 'MTN MoMo'
  const providerColor = txn.provider === 'airtel' ? '#dc2626' : '#f59e0b'

  return (
    <div className="txn-popup-backdrop">
      <div
        className={`txn-popup ${success ? 'success' : ''}`}
        style={success && color ? { boxShadow: `0 0 0 4px ${color}, 0 20px 60px rgba(0,0,0,.4)` } : {}}
      >
        {!success ? (
          <>
            <div className="txn-popup-header">
              <div className="txn-badge" style={{ background: providerColor }}>
                {providerLabel}
              </div>
              <div className="txn-countdown">{seconds}</div>
            </div>

            <div className="txn-amount">
              UGX {Number(txn.amount).toLocaleString()}
            </div>

            <div className="txn-info">
              <div className="row">
                <span className="lbl">Transaction ID</span>
                <span className="val mono">{txn.txn_id}</span>
              </div>
              <div className="row">
                <span className="lbl">Time</span>
                <span className="val">
                  {new Date(txn.received_at || Date.now()).toLocaleTimeString('en-GB')}
                </span>
              </div>
              {txn.customer_name && (
                <div className="row">
                  <span className="lbl">From</span>
                  <span className="val">{txn.customer_name}</span>
                </div>
              )}
              {txn.customer_phone && (
                <div className="row">
                  <span className="lbl">Phone</span>
                  <span className="val">{txn.customer_phone}</span>
                </div>
              )}
            </div>

            <div className="txn-code-display">
              <input
                ref={inputRef}
                type="text"
                inputMode="numeric"
                value={code}
                readOnly
                placeholder="••"
                className="txn-code-input"
              />
            </div>

            {err && <div className="txn-error">{err}</div>}

            <div className="txn-numpad">
              {[1,2,3,4,5,6,7,8,9].map(n => (
                <button key={n} onClick={() => press(String(n))} className="numpad-key">
                  {n}
                </button>
              ))}
              <button className="numpad-key back" onClick={backspace}>
                <i className="fas fa-backspace" />
              </button>
              <button onClick={() => press('0')} className="numpad-key">0</button>
              <button className="numpad-key check" onClick={() => submit()}>
                <i className="fas fa-check" />
              </button>
            </div>

            <button className="txn-skip" onClick={onClose}>
              Skip — another attendant will claim
            </button>
          </>
        ) : (
          <div className="txn-success">
            <div className="big-tick" style={{ background: color || '#10b981' }}>✓</div>
            <div className="success-title">Claimed!</div>
            <div className="success-sub">
              UGX {Number(txn.amount).toLocaleString()} · Txn {txn.txn_id}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}