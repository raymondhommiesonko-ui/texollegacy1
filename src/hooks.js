import { useEffect, useState } from 'react'
import { supabase } from './supabase'

// Load the current user's full profile + powers + station
export function useProfile(session) {
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!session) { setProfile(null); setLoading(false); return }
    let cancelled = false

    async function load() {
      setLoading(true)
      // profile
      const { data: user } = await supabase
        .from('users')
        .select('*, stations(*)')
        .eq('id', session.user.id)
        .single()
      // powers
      const { data: powers } = await supabase
        .from('user_powers')
        .select('power_id, granted')
        .eq('user_id', session.user.id)

      if (cancelled) return

      const powerMap = {}
      ;(powers || []).forEach(p => { powerMap[p.power_id] = p.granted })

      setProfile({ user, powers: powerMap, station: user?.stations })
      setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [session])

  return { profile, loading }
}

// Load station-wide stats for the Home screen
export function useHomeStats(profile) {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!profile?.user?.station_id) { setStats(null); setLoading(false); return }
    let cancelled = false

    async function load() {
      setLoading(true)
      const stationId = profile.user.station_id
      const today = new Date().toISOString().slice(0, 10)

      // Parallel fetch
      const [
        { count: staffCount },
        { data: todayDrops },
        { data: todayShifts },
        { data: pendingAtt }
      ] = await Promise.all([
        supabase.from('users').select('id', { count: 'exact', head: true }).eq('station_id', stationId).eq('is_active', true),
        supabase.from('money_drops').select('amount, shift_id').eq('shift_id', supabase.from('shifts').select('id').eq('station_id', stationId).eq('shift_date', today).then(() => {})).limit(0),
        supabase.from('shifts').select('id, status').eq('station_id', stationId).eq('shift_date', today),
        supabase.from('attendance').select('id').eq('status', 'pending').limit(100),
      ])

      if (cancelled) return

      // Simpler: get today's drops via shift join
      const shiftIds = (todayShifts || []).map(s => s.id)
      let dropsToday = []
      if (shiftIds.length > 0) {
        const { data } = await supabase
          .from('money_drops')
          .select('amount')
          .in('shift_id', shiftIds)
        dropsToday = data || []
      }

      const dropTotal = dropsToday.reduce((sum, d) => sum + Number(d.amount), 0)

      setStats({
        staffCount: staffCount || 0,
        dropTotal,
        dropCount: dropsToday.length,
        openShifts: (todayShifts || []).filter(s => s.status === 'open').length,
        pendingAttendance: (pendingAtt || []).length,
      })
      setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [profile?.user?.station_id])

  return { stats, loading }
}