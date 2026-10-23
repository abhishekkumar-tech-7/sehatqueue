import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, useColorScheme, Alert } from 'react-native';
import { Stack, useLocalSearchParams, router } from 'expo-router';
import { Button } from '../../components/Button';
import { FeePanel } from '../../components/FeePanel';
import { LoadingView, ErrorView } from '../../components/StateViews';
import { supabase } from '../../lib/supabase';
import { getFeeQuote, startPayment, FeeQuote } from '../../lib/checkout';
import { formatRupees } from '../../lib/money';
import Colors from '../../constants/Colors';
import { Spacing, FontSize, BorderRadius } from '../../constants/Spacing';

const SLOT_MINUTES = 15;

type SessionInfo = {
  session_date: string;
  start_time: string;
  end_time: string;
};

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
  const [quote, setQuote] = useState<FeeQuote | null>(null);
  const [takenTimes, setTakenTimes] = useState<Set<number>>(new Set());
  const [chosen, setChosen] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [booking, setBooking] = useState(false);

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

    const { data: bookingsData } = await supabase
      .from('bookings')
      .select('appointment_start')
      .eq('session_id', sessionId)
      .not('appointment_start', 'is', null);

    const taken = new Set<number>((bookingsData ?? []).map((b) => new Date(b.appointment_start!).getTime()));

    setSession(sessionData);
    setTakenTimes(taken);
    setQuote(await getFeeQuote(sessionId as string));
    setLoading(false);
  }, [sessionId]);

  useEffect(() => {
    load();
  }, [load]);

  const slots = useMemo(() => (session ? buildSlots(session) : []), [session]);
  const payOnline = !!quote && quote.pay_mode !== 'OFF' && quote.online_paise > 0;

  async function handleConfirm() {
    if (!chosen) return;
    setBooking(true);

    if (payOnline && quote) {
      const result = await startPayment({
        kind: 'slot',
        session_id: sessionId,
        start_time: chosen.toISOString(),
        duration_minutes: SLOT_MINUTES,
        expected_total_paise: quote.total_paise,
      });
      setBooking(false);

      if (!result.ok) {
        Alert.alert('Could not start payment', result.message);
        setChosen(null);
        load();
        return;
      }
      router.replace({
        pathname: '/booking/pay',
        params: {
          orderId: result.data.order_id,
          sessionId: result.data.payment_session_id, // Cashfree payment session
          env: result.data.cashfree_env,
          amountPaise: String(result.data.amount_paise),
        },
      } as any);
      return;
    }

    const { data, error: bookError } = await supabase.rpc('book_slot', {
      p_session_id: sessionId,
      p_start_time: chosen.toISOString(),
      p_duration_minutes: SLOT_MINUTES,
      p_expected_total_paise: quote ? quote.total_paise : null,
    });
    setBooking(false);

    if (bookError) {
      Alert.alert('Could not book', bookError.message);
      setChosen(null);
      load();
      return;
    }

    const result = Array.isArray(data) ? data[0] : data;
    Alert.alert(
      'Appointment booked',
      `Your appointment is at ${formatSlotTime(chosen)}.\nReference: ${result.booking_reference}`,
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
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.container}
    >
      <Stack.Screen options={{ title: 'Choose a Time' }} />
      <Text style={[styles.subtitle, { color: colors.textMuted }]}>Select an available 15-minute slot</Text>

      {slots.length === 0 ? (
        <Text style={[styles.subtitle, { color: colors.textMuted }]}>
          No remaining time slots for this session today.
        </Text>
      ) : (
        <View style={styles.grid}>
          {slots.map((slot) => {
            const isTaken = takenTimes.has(slot.getTime());
            const isChosen = chosen?.getTime() === slot.getTime();
            return (
              <Pressable
                key={slot.getTime()}
                disabled={isTaken || booking}
                onPress={() => setChosen(slot)}
                accessibilityRole="button"
                accessibilityState={{ disabled: isTaken, selected: isChosen }}
                style={[
                  styles.slot,
                  {
                    backgroundColor: isTaken ? colors.border : isChosen ? colors.primary : colors.cardBackground,
                    borderColor: isChosen ? colors.primary : colors.border,
                  },
                ]}
              >
                <Text
                  style={{
                    color: isTaken ? colors.textMuted : isChosen ? '#FFFFFF' : colors.text,
                    fontSize: FontSize.body,
                  }}
                >
                  {formatSlotTime(slot)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      {chosen ? (
        <View style={{ marginTop: Spacing.lg }}>
          <Text style={[styles.chosen, { color: colors.text }]}>Selected: {formatSlotTime(chosen)}</Text>
          {quote ? <FeePanel quote={quote} count={1} /> : null}
          <View style={{ marginTop: Spacing.md }}>
            <Button
              title={payOnline && quote ? `Pay ${formatRupees(quote.online_paise)} & Confirm` : 'Confirm Appointment'}
              onPress={handleConfirm}
              variant="primary"
              loading={booking}
            />
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
  subtitle: { fontSize: FontSize.body, marginBottom: Spacing.md },
  chosen: { fontSize: FontSize.heading, fontWeight: '600', marginBottom: Spacing.sm },
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