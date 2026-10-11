import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, useColorScheme, RefreshControl } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Card } from './Card';
import { Button } from './Button';
import { LoadingView, ErrorView, EmptyView } from './StateViews';
import { supabase } from '../lib/supabase';
import { Profile } from '../lib/AuthContext';
import Colors from '../constants/Colors';
import { Spacing, FontSize } from '../constants/Spacing';

type SessionRow = {
  id: string;
  session_date: string;
  start_time: string;
  end_time: string;
  booking_mode: 'TOKEN' | 'SLOT';
  capacity: number;
  status: string;
  doctor_clinics: { doctors: { display_name: string } | null; clinics: { name: string } | null } | null;
};

function formatTime(value: string) {
  const [h, m] = value.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${suffix}`;
}

function todayInIndia() {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export default function ReceptionistHome({ profile }: { profile: Profile }) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme as 'light' | 'dark'];

  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [bookedCounts, setBookedCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const today = todayInIndia();

    const { data, error: queryError } = await supabase
      .from('clinic_sessions')
      .select(
        `id, session_date, start_time, end_time, booking_mode, capacity, status,
         doctor_clinics(doctors(display_name), clinics(name))`
      )
      .eq('session_date', today)
      .order('start_time');

    if (queryError) {
      console.log('Receptionist sessions error:', queryError.message);
      setError('Could not load sessions. Please check your internet connection.');
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const sessionList = data as unknown as SessionRow[];
    setSessions(sessionList);

    // Booked count per session. Cancelled and expired bookings free their spot;
    // held, completed and skipped ones still count as used.
    if (sessionList.length > 0) {
      const { data: bookingRows } = await supabase
        .from('bookings')
        .select('session_id')
        .in('session_id', sessionList.map((s) => s.id))
        .not('status', 'in', '(CANCELLED,EXPIRED)');

      const counts: Record<string, number> = {};
      (bookingRows ?? []).forEach((b) => {
        counts[b.session_id] = (counts[b.session_id] ?? 0) + 1;
      });
      setBookedCounts(counts);
    } else {
      setBookedCounts({});
    }

    setLoading(false);
    setRefreshing(false);
  }, []);

  // Reload whenever this screen comes back into focus (e.g. after creating a session).
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (loading) return <LoadingView message="Loading today's sessions..." />;
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

  const activeSessions = sessions.filter((s) => s.status !== 'CLOSED' && s.status !== 'CANCELLED');
  const endedSessions = sessions.filter((s) => s.status === 'CLOSED' || s.status === 'CANCELLED');

  function renderSession(s: SessionRow, ended: boolean) {
    const booked = bookedCounts[s.id] ?? 0;
    const isFull = booked >= s.capacity;
    const ratio = s.capacity > 0 ? Math.min(booked / s.capacity, 1) : 0;
    const barColor = isFull ? colors.error : ratio >= 0.8 ? colors.warning : colors.success;
    const statusColor = s.status === 'OPEN' ? colors.success : ended ? colors.textMuted : colors.warning;

    return (
      <Pressable
        key={s.id}
        onPress={() => router.push({ pathname: '/doctor-portal/queue', params: { sessionId: s.id } } as any)}
        style={{ opacity: ended ? 0.6 : 1 }}
      >
        <Card>
          <Text style={[styles.doctorName, { color: colors.primary }]}>
            {s.doctor_clinics?.doctors?.display_name}
          </Text>
          <Text style={[styles.detail, { color: colors.textMuted }]}>{s.doctor_clinics?.clinics?.name}</Text>
          <Text style={[styles.detail, { color: colors.text }]}>
            {formatTime(s.start_time)} - {formatTime(s.end_time)}
          </Text>
          <Text style={[styles.detail, { color: colors.textMuted }]}>
            {s.booking_mode === 'TOKEN' ? 'Token queue' : 'Appointments'}
          </Text>

          <View style={styles.capacityRow}>
            <Text style={[styles.capacityText, { color: colors.text }]}>
              {booked} / {s.capacity} booked
            </Text>
            {isFull ? <Text style={[styles.fullBadge, { color: colors.error }]}>Full</Text> : null}
          </View>
          <View style={[styles.barTrack, { backgroundColor: colors.border }]}>
            <View style={[styles.barFill, { width: `${ratio * 100}%`, backgroundColor: barColor }]} />
          </View>

          <Text style={[styles.status, { color: statusColor }]}>{s.status}</Text>
        </Card>
      </Pressable>
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.container}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            load();
          }}
          tintColor={colors.primary}
        />
      }
    >
      <Text style={[styles.title, { color: colors.text }]}>Hello, {profile.full_name}</Text>

      <View style={{ marginTop: Spacing.md, marginBottom: Spacing.md }}>
        <Button
          title="+ New Session"
          onPress={() => router.push('/doctor-portal/new-session' as any)}
          variant="primary"
        />
      </View>

      <Text style={[styles.subtitle, { color: colors.textMuted }]}>Active sessions</Text>
      {activeSessions.length === 0 ? (
        <EmptyView
          title="No active sessions"
          message="There are no open or paused sessions for today. Tap + New Session to create one."
        />
      ) : (
        activeSessions.map((s) => renderSession(s, false))
      )}

      {endedSessions.length > 0 && (
        <>
          <Text style={[styles.subtitle, { color: colors.textMuted, marginTop: Spacing.lg }]}>Ended today</Text>
          {endedSessions.map((s) => renderSession(s, true))}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
  title: { fontSize: FontSize.title, fontWeight: 'bold' },
  subtitle: { fontSize: FontSize.body, marginTop: Spacing.xs, marginBottom: Spacing.md },
  doctorName: { fontSize: FontSize.heading, fontWeight: '600' },
  detail: { fontSize: FontSize.body, marginTop: Spacing.xs },
  capacityRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.md },
  capacityText: { fontSize: FontSize.body, fontWeight: '600' },
  fullBadge: { fontSize: FontSize.small, fontWeight: '700' },
  barTrack: { height: 8, borderRadius: 4, marginTop: Spacing.xs, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4 },
  status: { fontSize: FontSize.small, fontWeight: '600', marginTop: Spacing.sm, textTransform: 'capitalize' },
});    