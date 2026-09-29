import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, useColorScheme, Alert } from 'react-native';
import { Stack, useLocalSearchParams, router } from 'expo-router';
import { LoadingView, ErrorView } from '../../components/StateViews';
import { supabase } from '../../lib/supabase';
import Colors from '../../constants/Colors';
import { Spacing, FontSize, BorderRadius } from '../../constants/Spacing';

const SLOT_MINUTES = 15;

type SessionInfo = {
  session_date: string;
  start_time: string;
  end_time: string;
};

// Builds every 15-min slot between the session's start and end time,
// excluding any slot whose start time has already passed (only relevant
// when the session is happening today).
function buildSlots(session: SessionInfo) {
  const [y, m, d] = session.session_date.split('-').map(Number);
  const [sh, sm] = session.start_time.split(':').map(Number);
  const [eh, em] = session.end_time.split(':').map(Number);

  const start = new Date(y, m - 1, d, sh, sm);
  const end = new Date(y, m - 1, d, eh, em);
  const now = new Date();

  const slots: Date[] = [];
  let current = start;
  while (current < end) {
    if (current > now) {
      slots.push(current);
    }
    current = new Date(current.getTime() + SLOT_MINUTES * 60000);
  }
  return slots;
}

function formatSlotTime(date: Date) {
  return date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
}

export default function SlotBookingScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme as 'light' | 'dark'];
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();

  const [session, setSession] = useState<SessionInfo | null>(null);
  const [takenTimes, setTakenTimes] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bookingTime, setBookingTime] = useState<number | null>(null);

  const load = useCallback(async () => {
    setError(null);

    const { data: sessionData, error: sessionError } = await supabase
      .from('clinic_sessions')
      .select('session_date, start_time, end_time, doctor_clinic_id')
      .eq('id', sessionId)
      .single();

    if (sessionError || !sessionData) {
      setError('Could not load this session.');
      setLoading(false);
      return;
    }

    // We can only see CONFIRMED bookings for our own account via RLS, so instead
    // we ask the server which times are taken through a safe read: bookings for
    // this exact session that are not cancelled. Patients can only read their own
    // bookings by policy, so we rely on the slot function itself as the final
    // authority; this list is only used to gray out obviously-taken times.
    const { data: bookingsData } = await supabase
      .from('bookings')
      .select('appointment_start')
      .eq('session_id', sessionId)
      .not('appointment_start', 'is', null);

    const taken = new Set<number>((bookingsData ?? []).map((b) => new Date(b.appointment_start!).getTime()));

    setSession(sessionData);
    setTakenTimes(taken);
    setLoading(false);
  }, [sessionId]);

  useEffect(() => {
    load();
  }, [load]);

  const slots = useMemo(() => (session ? buildSlots(session) : []), [session]);

  async function handleBookSlot(slot: Date) {
    setBookingTime(slot.getTime());
    const { data, error: bookError } = await supabase.rpc('book_slot', {
      p_session_id: sessionId,
      p_start_time: slot.toISOString(),
      p_duration_minutes: SLOT_MINUTES,
    });
    setBookingTime(null);

    if (bookError) {
      Alert.alert('Could not book', bookError.message);
      load(); // refresh in case someone else just took a nearby slot
      return;
    }

    const result = Array.isArray(data) ? data[0] : data;
    Alert.alert(
      'Appointment booked',
      `Your appointment is at ${formatSlotTime(slot)}.\nReference: ${result.booking_reference}`,
      [{ text: 'OK', onPress: () => router.back() }]
    );
  }

  if (loading) return <LoadingView message="Loading available times..." />;
  if (error || !session) {
    return (
      <ErrorView
        message={error ?? 'Session not found.'}
        onRetry={() => {
          setLoading(true);
          load();
        }}
      />
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: 'Choose a Time' }} />
      <Text style={[styles.subtitle, { color: colors.textMuted }]}>
        Select an available 15-minute slot
      </Text>

      {slots.length === 0 ? (
        <Text style={[styles.subtitle, { color: colors.textMuted }]}>
          No remaining time slots for this session today.
        </Text>
      ) : (
        <View style={styles.grid}>
          {slots.map((slot) => {
            const isTaken = takenTimes.has(slot.getTime());
            const isBookingThis = bookingTime === slot.getTime();
            return (
              <Pressable
                key={slot.getTime()}
                disabled={isTaken || bookingTime !== null}
                onPress={() => handleBookSlot(slot)}
                accessibilityRole="button"
                accessibilityState={{ disabled: isTaken }}
                style={[
                  styles.slot,
                  {
                    backgroundColor: isTaken ? colors.border : colors.cardBackground,
                    borderColor: colors.border,
                    opacity: isBookingThis ? 0.6 : 1,
                  },
                ]}
              >
                <Text style={{ color: isTaken ? colors.textMuted : colors.text, fontSize: FontSize.body }}>
                  {formatSlotTime(slot)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: Spacing.lg },
  subtitle: { fontSize: FontSize.body, marginBottom: Spacing.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  slot: {
    minWidth: 88,
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    paddingHorizontal: Spacing.sm,
  },
});  