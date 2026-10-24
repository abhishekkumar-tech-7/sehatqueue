import { useEffect, useRef } from 'react';
import { supabase } from './supabase';

// Calls onChange whenever a booking changes, with a slow backup check in case a message is missed.
export function useBookingsRealtime(onChange: () => void) {
  const ref = useRef(onChange);
  ref.current = onChange;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const trigger = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => ref.current(), 600);
    };

    const channel = supabase
      .channel(`bookings-live-${Date.now()}-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, trigger)
      .subscribe();
    const poll = setInterval(() => ref.current(), 20000);

    return () => {
      if (timer) clearTimeout(timer);
      clearInterval(poll);
      supabase.removeChannel(channel);
    };
  }, []);
}   