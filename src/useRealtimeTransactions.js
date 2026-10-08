import { useEffect } from 'react'
import { supabase } from './supabase'

export function useRealtimeTransactions(stationId, onNewTxn, onClaimedTxn) {
  useEffect(() => {
    if (!stationId) return

    const channel = supabase
      .channel('txn-inbox-' + stationId)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'transactions',
          filter: `station_id=eq.${stationId}`,
        },
        (payload) => {
          console.log('New transaction received:', payload.new)
          if (onNewTxn) onNewTxn(payload.new)
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'transactions',
          filter: `station_id=eq.${stationId}`,
        },
        (payload) => {
          console.log('Transaction updated:', payload.new)
          if (onClaimedTxn) onClaimedTxn(payload.new)
        }
      )
      .subscribe((status) => {
        console.log('Realtime status:', status)
      })

    return () => {
      supabase.removeChannel(channel)
    }
  }, [stationId])
}