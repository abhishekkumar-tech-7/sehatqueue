import { useCallback, useEffect, useState } from 'react';
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
  doctor_clinics: { clinics: { name: string } | null } | null;
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

export default function DoctorHome({ profile }: { profile: Profile }) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme as 'light' | 'dark'];

  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [bookedCounts, setBookedCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const today = todayInIndia();

    const { data: doctorRow } = await supabase
      .from('doctors')
      .select('id')
      .eq('profile_id', profile.id)
      .single();

    if (!doctorRow) {
      setError('Doctor profile not found.');
      setLoading(false);
      return;
    }

    const { data, error: queryError } = await supabase
      .from('clinic_sessions')
      .select(
        `id, session_date, start_time, end_time, booking_mode, capacity, status,
         doctor_clinics!inner(clinics(name), doctor_id)`
      )
      .eq('doctor_clinics.doctor_id', doctorRow.id)
      .eq('session_date', today)
      .order('start_time');

    if (queryError) {
      setError('Could not load your sessions. Please check your internet connection.');
      setLoading(false);
      return;
    }

    const sessionList = data as unknown as SessionRow[];
    setSessions(sessionList);

    // Get a booked count per session for the "X / capacity" display.
    if (sessionList.length > 0) {
      const { data: bookingCounts } = await supabase
        .from('bookings')
        .select('session_id')
        .in('session_id', sessionList.map((s) => s.id))
        .not('status', 'in', '(CANCELLED,EXPIRED)');

      const counts: Record<string, number> = {};
      (bookingCounts ?? []).forEach((b) => {
        counts[b.session_id] = (counts[b.session_id] ?? 0) + 1;
      });
      setBookedCounts(counts);
    }

    setLoading(false);
  }, [profile.id]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load();
    }, [load])
  );

  if (loading) return <LoadingView message="Loading your dashboard..." />;
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
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.container}
      refreshControl={
        <RefreshControl refreshing={loading} onRefresh={() => load()} tintColor={colors.primary} />
      }
    >
      <Text style={[styles.title, { color: colors.text }]}>Hello, Dr. {profile.full_name}</Text>

      <View style={{ marginTop: Spacing.md, marginBottom: Spacing.md }}>
        <Button
          title="+ New Session"
          onPress={() => router.push('/doctor-portal/new-session' as any)}
          variant="primary"
        />
        <View style={{ height: Spacing.sm }} />
        <Button
          title="Edit My Profile"
          onPress={() => router.push('/doctor-portal/edit-profile' as any)}
          variant="secondary"
        />
      </View>

      <Text style={[styles.subtitle, { color: colors.textMuted }]}>Today's sessions</Text>

      {sessions.length === 0 ? (
        <EmptyView
          title="No sessions today"
          message="You have no clinic sessions scheduled for today."
        />
      ) : (
        sessions.map((s) => (
          <Pressable
            key={s.id}
            onPress={() => router.push({ pathname: '/doctor-portal/queue', params: { sessionId: s.id } } as any)}
          >
            <Card>
              <Text style={[styles.clinicName, { color: colors.primary }]}>
                {s.doctor_clinics?.clinics?.name}
              </Text>
              <Text style={[styles.detail, { color: colors.text }]}>
                {formatTime(s.start_time)} - {formatTime(s.end_time)}
              </Text>
              <Text style={[styles.detail, { color: colors.textMuted }]}>
                {s.booking_mode === 'TOKEN' ? 'Token queue' : 'Appointments'} · {bookedCounts[s.id] ?? 0} /{' '}
                {s.capacity} booked
              </Text>
              <Text style={[styles.status, { color: colors.warning }]}>{s.status}</Text>
            </Card>
          </Pressable>
        ))
      )}

      <View style={styles.buttonGroup}>
        <Button
          title="Log Out"
          onPress={() => supabase.auth.signOut()}
          variant="secondary"
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
  title: { fontSize: FontSize.title, fontWeight: 'bold' },
  subtitle: { fontSize: FontSize.body, marginTop: Spacing.xs, marginBottom: Spacing.lg },
  clinicName: { fontSize: FontSize.heading, fontWeight: '600' },
  detail: { fontSize: FontSize.body, marginTop: Spacing.xs },
  status: { fontSize: FontSize.small, fontWeight: '600', marginTop: Spacing.sm, textTransform: 'capitalize' },
  buttonGroup: { marginTop: Spacing.lg },
});  