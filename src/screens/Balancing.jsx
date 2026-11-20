import { useEffect, useMemo, useState, useCallback } from 'react'
import { supabase } from '../supabase'
import PumpBalanceModal from './PumpBalanceModal'

export default function Balancing({ profile }) {
  const user = profile.user
  const powers = profile.powers || {}
  const isManager = ['admin', 'manager'].includes(user.role)
  const isSupervisor = user.role === 'supervisor'
  const isAdminManagerSup = isManager || isSupervisor

  const canEditAll = isAdminManagerSup || powers.edit_balancing

  const [shift, setShift] = useState(null)
  const [pumps, setPumps] = useState([])
  const [entries, setEntries] = useState({})
  const [staff, setStaff] = useState([])
  const [expenses, setExpenses] = useState({})
  const [loading, setLoading] = useState(true)

  // Prices State
  const [prices, setPrices] = useState({ PMS: 6789, AGO: 7039 })
  const [showPriceSettings, setShowPriceSettings] = useState(false)
  const [editPrices, setEditPrices] = useState({ PMS: 0, AGO: 0 })

  const [liveData, setLiveData] = useState({})
  const [openPumpModal, setOpenPumpModal] = useState(null)
  const [openAssign, setOpenAssign] = useState(null)

  const nameById = useMemo(() => {
    const m = {}
    staff.forEach(s => { m[s.id] = s.name })
    return m
  }, [staff])

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const { data: shifts } = await supabase
        .from('shifts')
        .select('*')
        .eq('station_id', user.station_id)
        .in('status', ['open', 'pending_close'])
        .order('opened_at', { ascending: false })
        .limit(1)
      const cur = shifts?.[0] || null
      setShift(cur)

      const { data: pumpList } = await supabase
        .from('pumps')
        .select('*')
        .eq('station_id', user.station_id)
        .eq('is_active', true)
        .order('pump_number')

      // Normalize pump_number to Number so keys always match
      const normalizedPumps = (pumpList || []).map(p => ({
        ...p,
        pump_number: Number(p.pump_number),
      }))
      setPumps(normalizedPumps)

      // Load Prices from station_prices table
      const { data: priceData } = await supabase
        .from('station_prices')
        .select('*')
        .eq('station_id', user.station_id)

      if (priceData && priceData.length > 0) {
        const pObj = { PMS: 6789, AGO: 7039 }
        priceData.forEach(p => {
          pObj[p.product_name.toUpperCase()] = Number(p.price)
        })
        setPrices(pObj)
        setEditPrices(pObj)
      } else {
        setEditPrices(prev => (prev.PMS || prev.AGO ? prev : prices))
      }

      const { data: us } = await supabase
        .from('users')
        .select('id, name, role')
        .eq('station_id', user.station_id)
        .eq('is_active', true)
        .in('role', ['attendant', 'ambassador', 'supervisor'])
        .order('name')
      setStaff(us || [])

      if (!cur) {
        setLoading(false)
        return
      }

      const { data: existing } = await supabase
        .from('balance_entries')
        .select('*')
        .eq('shift_id', cur.id)

      let visibleEntries = existing || []
      if (!canEditAll) visibleEntries = visibleEntries.filter(e => e.user_id === user.id)

      // Normalize keys to Number
      const byPump = {}
      visibleEntries.forEach(e => {
        if (e.pump_number != null) byPump[Number(e.pump_number)] = e
      })
      setEntries(byPump)

      const startTime = cur.opened_at
      const endTime = cur.closed_at || new Date().toISOString()

      const [txnsRes, appUsersRes, dropsRes] = await Promise.all([
        supabase
          .from('transactions')
          .select('*')
          .eq('station_id', user.station_id)
          .eq('status', 'claimed')
          .gte('received_at', startTime)
          .lte('received_at', endTime),
        supabase
          .from('app_users')
          .select('*')
          .eq('station_id', user.station_id)
          .gte('txn_at', startTime)
          .lte('txn_at', endTime),
        supabase
          .from('money_drops')
          .select('*')
          .eq('shift_id', cur.id)
          .eq('status', 'active'),
      ])

      const live = {}
      const initLive = id => {
        if (!live[id]) live[id] = { momo: 0, app: 0, drops: 0 }
      }

      ;(txnsRes.data || []).forEach(t => {
        if (t.claimed_by) {
          initLive(t.claimed_by)
          if (['airtel', 'mtn'].includes(t.provider)) live[t.claimed_by].momo += Number(t.amount)
        }
      })
      ;(appUsersRes.data || []).forEach(a => {
        if (a.claimed_by) {
          initLive(a.claimed_by)
          live[a.claimed_by].app += Number(a.amount)
        }
      })
      ;(dropsRes.data || []).forEach(d => {
        if (d.attendant_id) {
          initLive(d.attendant_id)
          live[d.attendant_id].drops += Number(d.amount)
        }
      })
      setLiveData(live)

      const ids = visibleEntries.map(e => e.id)
      const expMap = {}
      if (ids.length > 0) {
        const { data: exp } = await supabase
          .from('balance_expenses')
          .select('*')
          .in('entry_id', ids)
        ;(exp || []).forEach(x => {
          const entry = visibleEntries.find(e => e.id === x.entry_id)
          if (entry) {
            const p = Number(entry.pump_number)
            if (!expMap[p]) expMap[p] = []
            expMap[p].push(x)
          }
        })
      }
      setExpenses(expMap)
    } catch (e) {
      console.error('Load error:', e)
    }
    setLoading(false)
  }, [user.station_id, canEditAll, user.id]) // prices intentionally omitted to avoid loops

  useEffect(() => {
    loadAll()
  }, [loadAll])

  async function assignPump(pumpNumber, userId) {
    if (!shift) return
    try {
      const pumpNum = Number(pumpNumber)
      const userIdToSave = userId === '' || userId === undefined ? null : userId

      const { data: existingRows, error: findErr } = await supabase
        .from('balance_entries')
        .select('id')
        .eq('shift_id', shift.id)
        .eq('pump_number', pumpNum)
        .limit(1)

      if (findErr) throw findErr
      const existing = existingRows && existingRows[0]

      // Unassign = delete the row so meters reset and pump returns to "+ Assign"
      if (existing && userIdToSave === null) {
        const { error } = await supabase
          .from('balance_entries')
          .delete()
          .eq('id', existing.id)
        if (error) throw error

        // Optimistic UI: remove the entry immediately
        setEntries(prev => {
          const next = { ...prev }
          delete next[pumpNum]
          return next
        })
        setOpenAssign(null)
        await loadAll()
        return
      }

      let savedRow, writeErr
      if (existing) {
        const r = await supabase
          .from('balance_entries')
          .update({ user_id: userIdToSave })
          .eq('id', existing.id)
          .select('*')
          .single()
        savedRow = r.data
        writeErr = r.error
      } else {
        const r = await supabase
          .from('balance_entries')
          .insert({
            shift_id: shift.id,
            station_id: user.station_id,
            pump_number: pumpNum,
            user_id: userIdToSave,
            pms_open: 0,
            pms_close: 0,
            ago_open: 0,
            ago_close: 0,
          })
          .select('*')
          .single()
        savedRow = r.data
        writeErr = r.error
      }
      if (writeErr) throw writeErr

      // Optimistic UI so the name shows immediately
      if (savedRow) {
        setEntries(prev => ({ ...prev, [pumpNum]: savedRow }))
      }

      setOpenAssign(null)
      await loadAll()
    } catch (err) {
      console.error('Assign error:', err)
      alert('Failed to assign: ' + err.message)
    }
  }

  async function savePrices() {
    try {
      const updates = Object.keys(editPrices).map(product => ({
        station_id: user.station_id,
        product_name: product,
        price: Number(editPrices[product]),
        updated_at: new Date().toISOString(),
      }))

      const { error } = await supabase
        .from('station_prices')
        .upsert(updates, { onConflict: 'station_id,product_name' })
      if (error) throw error

      setShowPriceSettings(false)
      await loadAll()
    } catch (err) {
      alert('Failed to save prices. Ensure SQL is run correctly. ' + err.message)
    }
  }

  function calcRow(pumpNumber) {
    const e = entries[Number(pumpNumber)]
    if (!e)
      return {
        pmsLiters: 0,
        agoLiters: 0,
        totalSales: 0,
        netBalance: 0,
        momo: 0,
        drops: 0,
        app: 0,
        totalExp: 0,
        cash: 0,
        visa: 0,
        salesDiff: 0,
      }

    const pmsL = Math.max(0, Number(e.pms_close || 0) - Number(e.pms_open || 0))
    const agoL = Math.max(0, Number(e.ago_close || 0) - Number(e.ago_open || 0))

    const pmsS = pmsL * prices.PMS
    const agoS = agoL * prices.AGO
    const totalSales = pmsS + agoS

    const live = liveData[e.user_id] || { momo: 0, app: 0, drops: 0 }
    const momo = Number(e.momo) || live.momo
    const drops = Number(e.drops) || live.drops
    const app = Number(e.app_users) || live.app
    const salesDiff = Number(e.sales_difference || 0)
    const cash = Number(e.cash || 0)
    const visa = Number(e.visa || 0)

    const expList = (expenses[Number(pumpNumber)] || []).filter(x => x.status === 'approved')
    const totalExp = expList.reduce((a, x) => a + Number(x.amount || 0), 0)

    const deductions = totalExp + drops + momo + salesDiff + app + cash + visa
    const netBalance = totalSales - deductions

    return {
      pmsLiters: pmsL,
      agoLiters: agoL,
      pmsSales: pmsS,
      agoSales: agoS,
      totalSales,
      momo,
      drops,
      app,
      salesDiff,
      totalExp,
      cash,
      visa,
      netBalance,
    }
  }

  if (loading) return <div className="drops-empty">Loading…</div>
  if (!shift) return <div className="drops-empty">No open shift.</div>

  const visiblePumps = canEditAll
    ? pumps
    : pumps.filter(p => entries[Number(p.pump_number)]?.user_id === user.id)

  return (
    <div className="balancing-screen">
      <div
        className="balance-sheet-head"
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
      >
        <div>
          <h3>TEXOL LEGACY — {shift.shift_date}</h3>
          <div className="sub">{shift.shift_type.toUpperCase()} SHIFT</div>
        </div>
        {canEditAll && (
          <button
            className="btn-primary"
            onClick={() => setShowPriceSettings(true)}
            style={{ padding: '8px 16px', borderRadius: '4px' }}
          >
            <i className="fas fa-cog" style={{ marginRight: 6 }} /> Price Settings
          </button>
        )}
      </div>

      {/* VISIBLE PRICES BANNER */}
      <div
        style={{
          padding: '0 32px',
          marginBottom: '16px',
          display: 'flex',
          gap: '20px',
          fontSize: '13px',
          fontWeight: 'bold',
          color: '#475569',
        }}
      >
        <div style={{ background: '#e0e7ff', padding: '6px 12px', borderRadius: '4px' }}>
          PMS Price: <span style={{ color: '#1d4ed8' }}>{Number(prices.PMS).toLocaleString()}</span>
        </div>
        <div style={{ background: '#e0e7ff', padding: '6px 12px', borderRadius: '4px' }}>
          AGO Price: <span style={{ color: '#1d4ed8' }}>{Number(prices.AGO).toLocaleString()}</span>
        </div>
      </div>

      <div style={{ overflowX: 'auto', padding: '0 32px 32px' }}>
        <table className="balance-sheet" style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th className="sticky-col" style={{ minWidth: '150px' }}>NAMES</th>
              {visiblePumps.map(p => {
                const pn = Number(p.pump_number)
                const entry = entries[pn]
                return (
                  <th key={p.id} className="staff-head" style={{ minWidth: '130px', padding: '10px' }}>
                    <div className="staff-name" style={{ fontWeight: 700, marginBottom: 4 }}>
                      PUMP {pn}
                    </div>
                    <div style={{ fontSize: 10, color: '#64748b', marginBottom: 8 }}>{p.product}</div>

                    {/* Edit Data — only when the entry exists and the user can edit it */}
                    {entry && (canEditAll || entry.user_id === user.id) && (
                      <button
                        className="btn-tiny"
                        onClick={() => setOpenPumpModal(p)}
                        style={{
                          background: '#3b82f6',
                          color: 'white',
                          padding: '4px 10px',
                          borderRadius: 4,
                          width: '100%',
                          fontSize: 11,
                          fontWeight: 'bold',
                          marginBottom: 6,
                        }}
                      >
                        <i className="fas fa-edit" style={{ marginRight: 4 }} /> Edit Data
                      </button>
                    )}

                    {/* Assign / Reassign — always available to managers/admins/supervisors */}
                    {canEditAll && (
                      <button
                        className="btn-tiny"
                        onClick={() => setOpenAssign(pn)}
                        style={{
                          background: '#f8fafc',
                          border: '1px dashed #cbd5e1',
                          color: '#64748b',
                          padding: '4px 10px',
                          borderRadius: 4,
                          width: '100%',
                          fontSize: 11,
                        }}
                      >
                        {entry ? '↻ Reassign' : '+ Assign'}
                      </button>
                    )}
                  </th>
                )
              })}
              {canEditAll && <th className="total-col">TOTAL</th>}
            </tr>
            <tr>
              <th className="sticky-col" style={{ fontSize: 10 }}>ATTENDANT</th>
              {visiblePumps.map(p => {
                const pn = Number(p.pump_number)
                const entry = entries[pn]
                const label = entry?.user_id
                  ? nameById[entry.user_id] || 'Unknown user'
                  : 'Unassigned'
                return (
                  <th
                    key={p.id}
                    style={{
                      fontSize: 11,
                      color: entry?.user_id ? '#92400e' : '#8ba0b9',
                      padding: '8px',
                    }}
                  >
                    {label}
                  </th>
                )
              })}
              {canEditAll && <th className="total-col"></th>}
            </tr>
          </thead>
          <tbody>
            {/* PMS METERS */}
            <tr className="section-head">
              <td
                className="sticky-col"
                colSpan={visiblePumps.length + (canEditAll ? 2 : 1)}
              >
                PMS
              </td>
            </tr>
            <ReadonlyRow
              label="PMS LITERS"
              pumps={visiblePumps}
              getValue={p => calcRow(p.pump_number).pmsLiters}
            />
            <ReadonlyRow
              label="PMS SALES"
              pumps={visiblePumps}
              getValue={p => calcRow(p.pump_number).pmsSales}
            />

            {/* AGO METERS */}
            <tr className="section-head">
              <td
                className="sticky-col"
                colSpan={visiblePumps.length + (canEditAll ? 2 : 1)}
              >
                AGO
              </td>
            </tr>
            <ReadonlyRow
              label="AGO LITERS"
              pumps={visiblePumps}
              getValue={p => calcRow(p.pump_number).agoLiters}
            />
            <ReadonlyRow
              label="AGO SALES"
              pumps={visiblePumps}
              getValue={p => calcRow(p.pump_number).agoSales}
            />

            <ReadonlyRow
              label="TOTAL SALES"
              pumps={visiblePumps}
              getValue={p => calcRow(p.pump_number).totalSales}
              highlight
            />

            <tr className="section-head">
              <td
                className="sticky-col"
                colSpan={visiblePumps.length + (canEditAll ? 2 : 1)}
              >
                DEDUCTIONS & PAYMENTS
              </td>
            </tr>
            <ReadonlyRow
              label="DROPS"
              pumps={visiblePumps}
              getValue={p => calcRow(p.pump_number).drops}
            />
            <ReadonlyRow
              label="MOMO/AIRTEL"
              pumps={visiblePumps}
              getValue={p => calcRow(p.pump_number).momo}
            />
            <ReadonlyRow
              label="APP USERS"
              pumps={visiblePumps}
              getValue={p => calcRow(p.pump_number).app}
            />
            <ReadonlyRow
              label="SALES DIFF"
              pumps={visiblePumps}
              getValue={p => calcRow(p.pump_number).salesDiff}
            />
            <ReadonlyRow
              label="VISA"
              pumps={visiblePumps}
              getValue={p => calcRow(p.pump_number).visa}
            />
            <ReadonlyRow
              label="CASH"
              pumps={visiblePumps}
              getValue={p => calcRow(p.pump_number).cash}
            />

            <tr className="section-head">
              <td
                className="sticky-col"
                colSpan={visiblePumps.length + (canEditAll ? 2 : 1)}
              >
                TOTAL EXPENSES (Approved)
              </td>
            </tr>
            <ReadonlyRow
              label="TOTAL EXPENSES"
              pumps={visiblePumps}
              getValue={p => calcRow(p.pump_number).totalExp}
            />

            <tr className="balance-row">
              <td className="sticky-col" style={{ fontSize: 14, fontWeight: 800 }}>
                NET BALANCE
              </td>
              {visiblePumps.map(p => {
                const val = calcRow(p.pump_number).netBalance
                let cls = 'balance-zero'
                let textColor = '#0f172a'
                if (val > 300) {
                  cls = 'balance-short'
                  textColor = '#dc2626'
                } else if (val < -300) {
                  cls = 'balance-excess'
                  textColor = '#16a34a'
                }

                return (
                  <td
                    key={p.id}
                    className={cls}
                    style={{
                      textAlign: 'right',
                      fontWeight: 800,
                      color: textColor,
                      padding: '12px 8px',
                    }}
                  >
                    {val.toLocaleString()}
                  </td>
                )
              })}
              {canEditAll && (
                <td className="total-col" style={{ fontSize: 14, fontWeight: 800 }}>
                  {visiblePumps
                    .reduce((s, p) => s + calcRow(p.pump_number).netBalance, 0)
                    .toLocaleString()}
                </td>
              )}
            </tr>
          </tbody>
        </table>
      </div>

      {/* PRICE SETTINGS MODAL */}
      {showPriceSettings && (
        <div
          className="modal-bg"
          onClick={e => {
            if (e.target === e.currentTarget) setShowPriceSettings(false)
          }}
        >
          <div className="modal" style={{ maxWidth: '400px' }}>
            <h3>Station Prices</h3>
            <p style={{ fontSize: 12, color: '#64748b', marginBottom: 16 }}>
              These prices apply to all pumps in the current shift.
            </p>

            <label>PMS Price</label>
            <input
              type="number"
              value={editPrices.PMS}
              onChange={e => setEditPrices({ ...editPrices, PMS: e.target.value })}
              style={{ width: '100%', padding: '8px', marginBottom: 16 }}
            />

            <label>AGO Price</label>
            <input
              type="number"
              value={editPrices.AGO}
              onChange={e => setEditPrices({ ...editPrices, AGO: e.target.value })}
              style={{ width: '100%', padding: '8px', marginBottom: 16 }}
            />

            <div className="modal-actions">
              <button className="btn-ghost-full" onClick={() => setShowPriceSettings(false)}>
                Cancel
              </button>
              <button className="btn-primary-full" onClick={savePrices}>
                Save Prices
              </button>
            </div>
          </div>
        </div>
      )}

      {openAssign !== null && (
        <AssignPumpModal
          profile={profile}
          pumpNumber={openAssign}
          currentEntry={entries[Number(openAssign)]}
          onClose={() => setOpenAssign(null)}
          onSave={assignPump}
        />
      )}

      {openPumpModal && (
        <PumpBalanceModal
          profile={profile}
          pump={openPumpModal}
          entry={entries[Number(openPumpModal.pump_number)]}
          liveData={liveData[entries[Number(openPumpModal.pump_number)]?.user_id]}
          globalPrices={prices}
          onClose={() => setOpenPumpModal(null)}
          onSaved={loadAll}
        />
      )}
    </div>
  )
}

function ReadonlyRow({ label, pumps, getValue, highlight }) {
  return (
    <tr className={highlight ? 'highlight-row' : ''}>
      <td className="sticky-col" style={{ fontSize: 12, color: '#475569' }}>
        {label}
      </td>
      {pumps.map(p => (
        <td
          key={p.id}
          style={{
            textAlign: 'right',
            fontWeight: highlight ? 700 : 500,
            fontSize: 13,
            padding: '8px',
          }}
        >
          {Number(getValue(p) || 0).toLocaleString()}
        </td>
      ))}
      {highlight && <td className="total-col"></td>}
    </tr>
  )
}

function AssignPumpModal({ profile, pumpNumber, currentEntry, onClose, onSave }) {
  const user = profile.user
  const [staffList, setStaffList] = useState([])
  const [selectedUserId, setSelectedUserId] = useState(currentEntry?.user_id || '')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let mounted = true
    async function load() {
      const { data } = await supabase
        .from('users')
        .select('id, name, role')
        .eq('station_id', user.station_id)
        .eq('is_active', true)
        .in('role', ['attendant', 'ambassador', 'supervisor'])
        .order('name')
      if (mounted) setStaffList(data || [])
    }
    load()
    return () => {
      mounted = false
    }
  }, [user.station_id])

  const handleSave = async () => {
    setSaving(true)
    const userIdToSave = selectedUserId === '' ? null : selectedUserId
    await onSave(Number(pumpNumber), userIdToSave)
    setSaving(false)
  }

  return (
    <div
      className="modal-bg"
      onClick={e => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="modal">
        <h3>{currentEntry ? `Reassign Pump ${pumpNumber}` : `Assign Pump ${pumpNumber}`}</h3>
        <label>Attendant</label>
        <select
          value={selectedUserId || ''}
          onChange={e => setSelectedUserId(e.target.value)}
          style={{
            width: '100%',
            padding: '8px',
            marginBottom: '16px',
            borderRadius: '4px',
            border: '1px solid #ccc',
          }}
        >
          <option value="">— None (Unassign) —</option>
          {staffList.map(s => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.role})
            </option>
          ))}
        </select>

        <div className="modal-actions">
          <button className="btn-ghost-full" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn-primary-full" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}