import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, useColorScheme, Alert } from 'react-native';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { LoadingView, EmptyView, ErrorView } from '../../components/StateViews';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/AuthContext';
import Colors from '../../constants/Colors';
import { Spacing, FontSize } from '../../constants/Spacing';

type BookingRow = {
  id: string;
  booking_mode: 'TOKEN' | 'SLOT';
  token_number: number | null;
  appointment_start: string | null;
  status: string;
  booking_reference: string;
  clinic_sessions: { session_date: string; start_time: string; end_time: string } | null;
  doctor_clinics: {
    doctors: { display_name: string } | null;
    clinics: { name: string } | null;
  } | null;
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

const STATUS_COLORS: Record<string, 'text' | 'success' | 'error' | 'warning' | 'textMuted'> = {
  CONFIRMED: 'success',
  CANCELLED: 'error',
  COMPLETED: 'text',
  NO_SHOW: 'error',
  SKIPPED: 'warning',
  EXPIRED: 'textMuted',
  PENDING: 'warning',
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
         clinic_sessions(session_date, start_time, end_time),
         doctor_clinics(doctors(display_name), clinics(name))`
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

  function handleCancel(booking: BookingRow) {
    Alert.alert('Cancel booking?', 'This will free up your spot for someone else.', [
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
          const canCancel = item.status === 'CONFIRMED';

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
                      {item.clinic_sessions.session_date}
                    </Text>
                  ) : null}
                </>
              ) : (
                item.appointment_start && (
                  <Text style={[styles.detail, { color: colors.text }]}>
                    {formatDateTime(item.appointment_start)}
                  </Text>
                )
              )}

              <Text style={[styles.status, { color: colors[STATUS_COLORS[item.status] ?? 'text'] }]}>
                {item.status}
              </Text>
              <Text style={[styles.reference, { color: colors.textMuted }]}>Ref: {item.booking_reference}</Text>

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