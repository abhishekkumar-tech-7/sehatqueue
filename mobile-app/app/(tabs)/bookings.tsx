import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, useColorScheme, Alert } from 'react-native';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { LoadingView, EmptyView, ErrorView } from '../../components/StateViews';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/AuthContext';
import { formatRupees } from '../../lib/money';
import Colors from '../../constants/Colors';
import { Spacing, FontSize } from '../../constants/Spacing';

type BookingRow = {
  id: string;
  booking_mode: 'TOKEN' | 'SLOT';
  token_number: number | null;
  appointment_start: string | null;
  status: string;
  booking_reference: string;
  payment_status: string | null;
  amount_online_paise: number | null;
  clinic_sessions: { session_date: string; start_time: string; end_time: string; block_label: string | null } | null;
  doctor_clinics: {
    doctors: { display_name: string } | null;
    clinics: { name: string } | null;
  } | null;
  payment_refunds: { amount_paise: number; status: string }[] | null;
};

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function clock(value: string) {
  const [h, m] = value.split(':').map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

function blockName(s: { start_time: string; block_label: string | null }) {
  const h = parseInt(s.start_time.slice(0, 2), 10);
  return s.block_label || (h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : h < 21 ? 'Evening' : 'Night');
}

function sessionLine(s: { session_date: string; start_time: string; end_time: string; block_label: string | null }) {
  const [y, m, d] = s.session_date.split('-').map(Number);
  const day = new Date(y, m - 1, d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  return `${day} - ${blockName(s)} (${clock(s.start_time)} - ${clock(s.end_time)})`;
}

const STATUS_COLORS: Record<string, 'text' | 'success' | 'error' | 'warning' | 'textMuted'> = {
  CONFIRMED: 'success',
  CANCELLED: 'error',
  COMPLETED: 'text',
  NO_SHOW: 'error',
  SKIPPED: 'warning',
  ON_HOLD: 'warning',
  EXPIRED: 'textMuted',
  PENDING: 'warning',
};

const REFUND_LABEL: Record<string, string> = {
  REQUESTED: 'processing',
  PROCESSING: 'processing',
  SUCCESS: 'completed',
  FAILED: 'delayed - please contact support',
};

export default function BookingsScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme as 'light' | 'dark'];
  const { profile } = useAuth();

  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!profile) return;
    setError(null);
    const { data, error: queryError } = await supabase
      .from('bookings')
      .select(
        `id, booking_mode, token_number, appointment_start, status, booking_reference,
         payment_status, amount_online_paise,
         clinic_sessions(session_date, start_time, end_time, block_label),
         doctor_clinics(doctors(display_name), clinics(name)),
         payment_refunds(amount_paise, status)`
      )
      .eq('patient_id', profile.id)
      .order('created_at', { ascending: false });

    if (queryError) {
      setError('Could not load your bookings. Please check your internet connection.');
    } else {
      setBookings(data as unknown as BookingRow[]);
    }
    setLoading(false);
    setRefreshing(false);
  }, [profile]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCancel(booking: BookingRow) {
    // Tell the patient exactly what they will get back before they confirm.
    setCancellingId(booking.id);
    const { data: pv } = await supabase.rpc('preview_cancel_refund', { p_booking_id: booking.id });
    setCancellingId(null);
    const p = Array.isArray(pv) ? pv[0] : pv;

    let message = 'This will free up your spot for someone else.';
    if (p?.is_paid) {
      if (p.refund_paise > 0) {
        message =
          `You paid ${formatRupees(p.paid_paise)} online. If you cancel now you will get ${formatRupees(p.refund_paise)} back` +
          (p.deduction_paise > 0 ? ` (${formatRupees(p.deduction_paise)} is deducted under the doctor's cancellation policy).` : '.');
      } else {
        message = `You paid ${formatRupees(p.paid_paise)} online, but this is within ${p.cutoff_hours} hour(s) of the session, so no refund applies if you cancel.`;
      }
    }

    Alert.alert('Cancel booking?', message, [
      { text: 'Keep booking', style: 'cancel' },
      {
        text: 'Cancel booking',
        style: 'destructive',
        onPress: async () => {
          setCancellingId(booking.id);
          const { error: cancelError } = await supabase.rpc('cancel_booking', {
            p_booking_id: booking.id,
            p_reason: 'Cancelled by patient',
          });
          setCancellingId(null);

          if (cancelError) {
            Alert.alert('Could not cancel', cancelError.message);
            return;
          }
          // Start the refund right away. If this fails it is retried later.
          supabase.functions.invoke('process-refunds').catch(() => {});
          load();
        },
      },
    ]);
  }

  if (loading) return <LoadingView message="Loading your bookings..." />;
  if (error) {
    return (
      <ErrorView
        message={error}
        onRetry={() => {
          setLoading(true);
          load();
        }}
      />
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={bookings}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshing={refreshing}
        onRefresh={() => {
          setRefreshing(true);
          load();
        }}
        ListEmptyComponent={
          <EmptyView title="No bookings yet" message="Bookings you make will show up here." />
        }
        renderItem={({ item }) => {
          const doctorName = item.doctor_clinics?.doctors?.display_name ?? 'Doctor';
          const clinicName = item.doctor_clinics?.clinics?.name ?? '';
          const canCancel = item.status === 'CONFIRMED' || item.status === 'ON_HOLD';
          const refund = item.payment_refunds?.[0];
          const paidOnline =
            (item.payment_status === 'PAID' || item.payment_status === 'REFUND_PENDING' || item.payment_status === 'REFUNDED') &&
            (item.amount_online_paise ?? 0) > 0;

          return (
            <Card>
              <Text style={[styles.doctorName, { color: colors.text }]}>{doctorName}</Text>
              {clinicName ? (
                <Text style={[styles.detail, { color: colors.textMuted }]}>{clinicName}</Text>
              ) : null}

              {item.booking_mode === 'TOKEN' ? (
                <>
                  <Text style={[styles.tokenNumber, { color: colors.primary }]}>
                    Token #{item.token_number}
                  </Text>
                  {item.clinic_sessions ? (
                    <Text style={[styles.detail, { color: colors.textMuted }]}>
                      {sessionLine(item.clinic_sessions)}
                    </Text>
                  ) : null}
                </>
              ) : (
                item.appointment_start && (
                  <>
                    <Text style={[styles.detail, { color: colors.text }]}>
                      {formatDateTime(item.appointment_start)}
                    </Text>
                    {item.clinic_sessions ? (
                      <Text style={[styles.detail, { color: colors.textMuted }]}>
                        {blockName(item.clinic_sessions)} session
                      </Text>
                    ) : null}    
                  </>
                )
              )}

              <Text style={[styles.status, { color: colors[STATUS_COLORS[item.status] ?? 'text'] }]}>
                {item.status}
              </Text>
              <Text style={[styles.reference, { color: colors.textMuted }]}>Ref: {item.booking_reference}</Text>

              {paidOnline ? (
                <Text style={[styles.detail, { color: colors.textMuted }]}>
                  Paid online: {formatRupees(item.amount_online_paise ?? 0)}
                </Text>
              ) : null}
              {refund ? (
                <Text style={[styles.detail, { color: refund.status === 'FAILED' ? colors.warning : colors.text }]}>
                  Refund of {formatRupees(refund.amount_paise)}: {REFUND_LABEL[refund.status] ?? refund.status}
                </Text>
              ) : null}

              {canCancel && (
                <View style={{ marginTop: Spacing.sm }}>
                  <Button
                    title="Cancel Booking"
                    onPress={() => handleCancel(item)}
                    variant="danger"
                    loading={cancellingId === item.id}
                  />
                </View>
              )}
            </Card>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { padding: Spacing.lg },
  doctorName: { fontSize: FontSize.heading, fontWeight: '600' },
  detail: { fontSize: FontSize.body, marginTop: Spacing.xs },
  tokenNumber: { fontSize: FontSize.large, fontWeight: 'bold', marginTop: Spacing.xs },
  status: { fontSize: FontSize.small, fontWeight: '600', marginTop: Spacing.sm, textTransform: 'capitalize' },
  reference: { fontSize: FontSize.small, marginTop: Spacing.xs },
});    