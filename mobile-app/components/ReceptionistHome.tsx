import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, useColorScheme, RefreshControl } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Card } from './Card';
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const today = todayInIndia();

    const { data, error: queryError } = await supabase
      .from('clinic_sessions')
      .select(
        `id, session_date, start_time, end_time, booking_mode, status,
         doctor_clinics(doctors(display_name), clinics(name))`
      )
      .eq('session_date', today)
      .order('start_time');

    if (queryError) {
      setError('Could not load sessions. Please check your internet connection.');
    } else {
      setSessions(data as unknown as SessionRow[]);
    }
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
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

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={() => load()} tintColor={colors.primary} />}
    >
      <Text style={[styles.title, { color: colors.text }]}>Hello, {profile.full_name}</Text>
      <Text style={[styles.subtitle, { color: colors.textMuted }]}>Today's sessions</Text>

      {sessions.length === 0 ? (
        <EmptyView title="No sessions today" message="There are no clinic sessions scheduled for today." />
      ) : (
        sessions.map((s) => (
          <Pressable
            key={s.id}
            onPress={() => router.push({ pathname: '/doctor-portal/queue', params: { sessionId: s.id } } as any)}
          >
            <Card>
              <Text style={[styles.doctorName, { color: colors.primary }]}>
                {s.doctor_clinics?.doctors?.display_name}
              </Text>
              <Text style={[styles.detail, { color: colors.textMuted }]}>{s.doctor_clinics?.clinics?.name}</Text>
              <Text style={[styles.detail, { color: colors.text }]}>
                {formatTime(s.start_time)} - {formatTime(s.end_time)}
              </Text>
              <Text style={[styles.status, { color: colors.warning }]}>{s.status}</Text>
            </Card>
          </Pressable>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
  title: { fontSize: FontSize.title, fontWeight: 'bold' },
  subtitle: { fontSize: FontSize.body, marginTop: Spacing.xs, marginBottom: Spacing.lg },
  doctorName: { fontSize: FontSize.heading, fontWeight: '600' },
  detail: { fontSize: FontSize.body, marginTop: Spacing.xs },
  status: { fontSize: FontSize.small, fontWeight: '600', marginTop: Spacing.sm, textTransform: 'capitalize' },
}); 