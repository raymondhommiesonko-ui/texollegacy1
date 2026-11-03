import { useEffect, useState, useCallback } from 'react'
import { supabase } from './supabase'

// Load the current user's full profile + powers + station
export function useProfile(session) {
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  const loadProfile = useCallback(async (signal) => {
    if (!session?.user?.id) {
      setProfile(null)
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const [userRes, powersRes] = await Promise.all([
        supabase.from('users').select('*, stations(*)').eq('id', session.user.id).single(),
        supabase.from('user_powers').select('power_id, granted').eq('user_id', session.user.id)
      ])

      if (signal?.aborted) return

      const user = userRes.data
      const powerMap = {}
      ;(powersRes.data || []).forEach(p => { powerMap[p.power_id] = p.granted })

      setProfile({ user, powers: powerMap, station: user?.stations })
    } catch (err) {
      console.error("Error loading profile:", err)
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [session?.user?.id])

  useEffect(() => {
    const controller = new AbortController()
    loadProfile(controller.signal)
    return () => controller.abort()
  }, [loadProfile])

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
        { data: todayShifts },
        { data: pendingAtt }
      ] = await Promise.all([
        supabase.from('users').select('id', { count: 'exact', head: true }).eq('station_id', stationId).eq('is_active', true),
        supabase.from('shifts').select('id, status').eq('station_id', stationId).eq('shift_date', today),
        supabase.from('attendance').select('id').eq('status', 'pending').limit(100),
      ])

      if (cancelled) return

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