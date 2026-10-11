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
  patient_name: string | null;
  patient_age: number | null;
  status: string;
  profiles: { full_name: string; phone: string | null } | null;
};

type SessionInfo = {
  current_token: number;
  last_token_issued: number;
  capacity: number;
  booking_mode: 'TOKEN' | 'SLOT';
  status: string;
};

type QueueAction = 'COMPLETED' | 'ON_HOLD' | 'SKIPPED';

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
  const [actioning, setActioning] = useState<string | null>(null);
  const [callingNext, setCallingNext] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const [sessionResult, bookingsResult] = await Promise.all([
      supabase
        .from('clinic_sessions')
        .select('current_token, last_token_issued, capacity, booking_mode, status')
        .eq('id', sessionId)
        .single(),
      supabase
        .from('bookings')
        .select('id, token_number, appointment_start, patient_name, patient_age, status, profiles(full_name, phone)')
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

  async function handleSessionStatus(newStatus: 'OPEN' | 'PAUSED' | 'CLOSED') {
    const { error: statusError } = await supabase.rpc('update_session_status', {
      p_session_id: sessionId,
      p_new_status: newStatus,
    });

    if (statusError) {
      Alert.alert('Could not update session', statusError.message);
      return;
    }
    load();
  }

  async function handleBookingAction(bookingId: string, action: QueueAction) {
    setActioning(`${bookingId}:${action}`);
    const { error: updateError } = await supabase.rpc('update_booking_status', {
      p_booking_id: bookingId,
      p_new_status: action,
    });
    setActioning(null);

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

      <Card>
        <Text style={[styles.currentLabel, { color: colors.textMuted }]}>Session status</Text>
        <Text style={[styles.currentToken, { color: session.status === 'OPEN' ? colors.success : colors.warning }]}>
          {session.status}
        </Text>
        <View style={styles.actionRow}>
          {session.status === 'OPEN' && (
            <View style={styles.actionButton}>
              <Button title="Pause" onPress={() => handleSessionStatus('PAUSED')} variant="secondary" />
            </View>
          )}
          {session.status === 'PAUSED' && (
            <View style={styles.actionButton}>
              <Button title="Resume" onPress={() => handleSessionStatus('OPEN')} variant="primary" />
            </View>
          )}
          {(session.status === 'OPEN' || session.status === 'PAUSED') && (
            <View style={styles.actionButton}>
              <Button title="Close Session" onPress={() => handleSessionStatus('CLOSED')} variant="danger" />
            </View>
          )}
        </View>
      </Card>

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
              disabled={session.current_token >= session.last_token_issued || session.status !== 'OPEN'}
            />
          </View>
        </Card>
      )}

      <FlatList
        data={bookings}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<EmptyView title="No patients yet" message="Bookings for this session will appear here." />}
        renderItem={({ item }) => {
          const displayName = item.patient_name ?? item.profiles?.full_name ?? 'Patient';
          const canAct = item.status === 'CONFIRMED' || item.status === 'ON_HOLD';

          return (
            <Card>
              <Text style={[styles.patientName, { color: colors.text }]}>
                {displayName}
                {item.patient_age != null ? `, ${item.patient_age} yrs` : ''}
              </Text>
              {item.profiles?.phone ? (
                <Text style={[styles.detail, { color: colors.textMuted }]}>{item.profiles.phone}</Text>
              ) : null}
              {item.token_number != null ? (
                <Text style={[styles.detail, { color: colors.text }]}>Token #{item.token_number}</Text>
              ) : item.appointment_start ? (
                <Text style={[styles.detail, { color: colors.text }]}>{formatTime(item.appointment_start)}</Text>
              ) : null}
              <Text style={[styles.status, { color: colors.warning }]}>{item.status.replace('_', ' ')}</Text>

              {canAct && (
                <View style={styles.actionRow}>
                  <View style={styles.actionButton}>
                    <Button
                      title="Completed"
                      onPress={() => handleBookingAction(item.id, 'COMPLETED')}
                      variant="primary"
                      loading={actioning === `${item.id}:COMPLETED`}
                      disabled={actioning !== null}
                    />
                  </View>
                  {item.status === 'CONFIRMED' && (
                    <View style={styles.actionButton}>
                      <Button
                        title="Hold"
                        onPress={() => handleBookingAction(item.id, 'ON_HOLD')}
                        variant="secondary"
                        loading={actioning === `${item.id}:ON_HOLD`}
                        disabled={actioning !== null}
                      />
                    </View>
                  )}
                  <View style={styles.actionButton}>
                    <Button
                      title="Skip"
                      onPress={() => handleBookingAction(item.id, 'SKIPPED')}
                      variant="secondary"
                      loading={actioning === `${item.id}:SKIPPED`}
                      disabled={actioning !== null}
                    />
                  </View>
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