import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, useColorScheme, Alert } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { LoadingView, ErrorView, EmptyView } from '../../components/StateViews';
import { supabase } from '../../lib/supabase';
import Colors from '../../constants/Colors';
import { Spacing, FontSize } from '../../constants/Spacing';

type BookingRow = {
  id: string;
  token_number: number | null;
  appointment_start: string | null;
  status: string;
  profiles: { full_name: string; phone: string | null } | null;
};

type SessionInfo = {
  current_token: number;
  last_token_issued: number;
  capacity: number;
  booking_mode: 'TOKEN' | 'SLOT';
};

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
}

export default function QueueScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme as 'light' | 'dark'];
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();

  const [session, setSession] = useState<SessionInfo | null>(null);
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [callingNext, setCallingNext] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const [sessionResult, bookingsResult] = await Promise.all([
      supabase
        .from('clinic_sessions')
        .select('current_token, last_token_issued, capacity, booking_mode')
        .eq('id', sessionId)
        .single(),
      supabase
        .from('bookings')
        .select('id, token_number, appointment_start, status, profiles(full_name, phone)')
        .eq('session_id', sessionId)
        .neq('status', 'CANCELLED')
        .order('token_number', { ascending: true, nullsFirst: false })
        .order('appointment_start', { ascending: true }),
    ]);

    if (sessionResult.error || bookingsResult.error) {
      setError('Could not load the queue. Please check your internet connection.');
    } else {
      setSession(sessionResult.data);
      setBookings(bookingsResult.data as unknown as BookingRow[]);
    }
    setLoading(false);
  }, [sessionId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCallNext() {
    setCallingNext(true);
    const { data, error: callError } = await supabase.rpc('call_next_token', {
      p_session_id: sessionId,
    });
    setCallingNext(false);

    if (callError) {
      Alert.alert('Could not call next', callError.message);
      return;
    }

    Alert.alert('Now calling', `Token #${data}`);
    load();
  }

  async function handleStatusUpdate(bookingId: string, status: 'COMPLETED' | 'NO_SHOW' | 'SKIPPED') {
    setActioningId(bookingId);
    const { error: updateError } = await supabase.rpc('update_booking_status', {
      p_booking_id: bookingId,
      p_new_status: status,
    });
    setActioningId(null);

    if (updateError) {
      Alert.alert('Could not update', updateError.message);
      return;
    }
    load();
  }

  if (loading) return <LoadingView message="Loading queue..." />;
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
      <Stack.Screen options={{ title: 'Queue' }} />

      {session.booking_mode === 'TOKEN' && (
        <Card>
          <Text style={[styles.currentLabel, { color: colors.textMuted }]}>Currently calling</Text>
          <Text style={[styles.currentToken, { color: colors.primary }]}>
            {session.current_token > 0 ? `#${session.current_token}` : 'Not started'}
          </Text>
          <View style={{ marginTop: Spacing.sm }}>
            <Button
              title="Call Next Patient"
              onPress={handleCallNext}
              variant="primary"
              loading={callingNext}
              disabled={session.current_token >= session.last_token_issued}
            />
          </View>
        </Card>
      )}

      <FlatList
        data={bookings}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<EmptyView title="No patients yet" message="Bookings for this session will appear here." />}
        renderItem={({ item }) => (
          <Card>
            <Text style={[styles.patientName, { color: colors.text }]}>
              {item.profiles?.full_name ?? 'Patient'}
            </Text>
            {item.profiles?.phone ? (
              <Text style={[styles.detail, { color: colors.textMuted }]}>{item.profiles.phone}</Text>
            ) : null}
            {item.token_number != null ? (
              <Text style={[styles.detail, { color: colors.text }]}>Token #{item.token_number}</Text>
            ) : item.appointment_start ? (
              <Text style={[styles.detail, { color: colors.text }]}>{formatTime(item.appointment_start)}</Text>
            ) : null}
            <Text style={[styles.status, { color: colors.warning }]}>{item.status}</Text>

            {item.status === 'CONFIRMED' && (
              <View style={styles.actionRow}>
                <View style={styles.actionButton}>
                  <Button
                    title="Completed"
                    onPress={() => handleStatusUpdate(item.id, 'COMPLETED')}
                    variant="primary"
                    loading={actioningId === item.id}
                  />
                </View>
                <View style={styles.actionButton}>
                  <Button
                    title="No-show"
                    onPress={() => handleStatusUpdate(item.id, 'NO_SHOW')}
                    variant="danger"
                    loading={actioningId === item.id}
                  />
                </View>
                <View style={styles.actionButton}>
                  <Button
                    title="Skip"
                    onPress={() => handleStatusUpdate(item.id, 'SKIPPED')}
                    variant="secondary"
                    loading={actioningId === item.id}
                  />
                </View>
              </View>
            )}
          </Card>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: Spacing.lg },
  list: { paddingBottom: Spacing.xxl },
  currentLabel: { fontSize: FontSize.small },
  currentToken: { fontSize: FontSize.title, fontWeight: 'bold' },
  patientName: { fontSize: FontSize.heading, fontWeight: '600' },
  detail: { fontSize: FontSize.body, marginTop: Spacing.xs },
  status: { fontSize: FontSize.small, fontWeight: '600', marginTop: Spacing.sm, textTransform: 'capitalize' },
  actionRow: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.md },
  actionButton: { flex: 1 },
});  