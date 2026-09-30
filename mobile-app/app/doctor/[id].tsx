import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, useColorScheme, Image } from 'react-native';
import { Stack, useLocalSearchParams, router } from 'expo-router';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { LoadingView, ErrorView } from '../../components/StateViews';
import { supabase } from '../../lib/supabase';
import Colors from '../../constants/Colors';
import { Spacing, FontSize } from '../../constants/Spacing';

type Session = {
  id: string;
  session_date: string;
  start_time: string;
  end_time: string;
  booking_mode: 'TOKEN' | 'SLOT';
  capacity: number;
  status: string;
};

type DoctorDetail = {
  id: string;
  display_name: string;
  bio: string | null;
  qualifications: string | null;
  photo_url: string | null;
  experience_years: number | null;
  doctor_specialties: { specialties: { name: string } | null }[];
  doctor_clinics: {
    id: string;
    clinics: { name: string; address: string; locality: string | null; city: string; phone: string | null } | null;
    clinic_sessions: Session[];
  }[];
};

function formatTime(value: string) {
  const [h, m] = value.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${suffix}`;
}

function formatDate(value: string) {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function todayInIndia() {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export default function DoctorProfileScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme as 'light' | 'dark'];
  const { id } = useLocalSearchParams<{ id: string }>();

  const [doctor, setDoctor] = useState<DoctorDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const { data, error: queryError } = await supabase
      .from('doctors')
      .select(
        `id, display_name, bio, qualifications, photo_url, experience_years,
         doctor_specialties(specialties(name)),
         doctor_clinics(id, clinics(name, address, locality, city, phone),
           clinic_sessions(id, session_date, start_time, end_time, booking_mode, capacity, status))`
      )
      .eq('id', id)
      .single();

    if (queryError || !data) {
      setError('Could not load this doctor. Please check your internet connection.');
    } else {
      setDoctor(data as unknown as DoctorDetail);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <LoadingView message="Loading doctor..." />;
  if (error || !doctor) {
    return (
      <ErrorView
        message={error ?? 'Doctor not found.'}
        onRetry={() => {
          setLoading(true);
          load();
        }}
      />
    );
  }

  const specialties = doctor.doctor_specialties
    .map((s) => s.specialties?.name)
    .filter(Boolean)
    .join(', ');
  const today = todayInIndia();

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.container}>
      <Stack.Screen options={{ title: doctor.display_name }} />

      <View style={styles.header}>
        {doctor.photo_url ? (
          <Image source={{ uri: doctor.photo_url }} style={styles.photo} />
        ) : (
          <View style={[styles.photoPlaceholder, { backgroundColor: colors.cardBackground }]}>
            <Text style={[styles.photoInitial, { color: colors.textMuted }]}>
              {doctor.display_name.charAt(0)}
            </Text>
          </View>
        )}
        <View style={styles.headerText}>
          <Text style={[styles.name, { color: colors.text }]}>{doctor.display_name}</Text>
          {specialties ? <Text style={[styles.detail, { color: colors.textMuted }]}>{specialties}</Text> : null}
          {doctor.experience_years != null ? (
            <Text style={[styles.detail, { color: colors.textMuted }]}>
              {doctor.experience_years} years experience
            </Text>
          ) : null}
        </View>
      </View>

      {doctor.qualifications ? (
        <Text style={[styles.detail, { color: colors.textMuted }]}>{doctor.qualifications}</Text>
      ) : null}
      {doctor.bio ? <Text style={[styles.bio, { color: colors.text }]}>{doctor.bio}</Text> : null}

      {doctor.doctor_clinics.map((link) => {
        const sessions = link.clinic_sessions
          .filter((s) => s.status === 'OPEN' && s.session_date >= today)
          .sort((a, b) => (a.session_date + a.start_time).localeCompare(b.session_date + b.start_time));

        return (
          <View key={link.id}>
            {link.clinics ? (
              <Card>
                <Text style={[styles.clinicName, { color: colors.primary }]}>{link.clinics.name}</Text>
                <Text style={[styles.detail, { color: colors.text }]}>
                  {link.clinics.address}
                  {link.clinics.locality ? `, ${link.clinics.locality}` : ''}, {link.clinics.city}
                </Text>
                {link.clinics.phone ? (
                  <Text style={[styles.detail, { color: colors.textMuted }]}>Phone: {link.clinics.phone}</Text>
                ) : null}
              </Card>
            ) : null}

            <Text style={[styles.sectionTitle, { color: colors.text }]}>Available sessions</Text>

            {sessions.length === 0 ? (
              <Text style={[styles.detail, { color: colors.textMuted }]}>No open sessions right now.</Text>
            ) : (
              sessions.map((s) => (
                <Card key={s.id}>
                  <Text style={[styles.sessionDate, { color: colors.text }]}>
                    {s.session_date === today ? 'Today' : formatDate(s.session_date)}
                  </Text>
                  <Text style={[styles.detail, { color: colors.textMuted }]}>
                    {formatTime(s.start_time)} - {formatTime(s.end_time)}
                  </Text>
                  <Text style={[styles.detail, { color: colors.textMuted }]}>
                    {s.booking_mode === 'TOKEN' ? 'Queue token booking' : 'Time-slot booking'}
                  </Text>
                  {s.booking_mode === 'TOKEN' ? (
                    <Text style={[styles.note, { color: colors.warning }]}>
                      A token is your place in the queue, not a guaranteed consultation time.
                    </Text>
                  ) : null}
                  <View style={{ height: Spacing.md }} />
                  {s.booking_mode === 'TOKEN' ? (
                    <Button
                      title="Book Token"
                      onPress={() =>
                        router.push({ pathname: '/booking/token', params: { sessionId: s.id } } as any)
                      }
                      variant="primary"
                    />
                  ) : (
                    <Button
                      title="Book Appointment"
                      onPress={() =>
                        router.push({ pathname: '/booking/slot', params: { sessionId: s.id } } as any)
                      }
                      variant="primary"
                    />
                  )}
                </Card>
              ))
            )}
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: Spacing.sm },
  photo: { width: 64, height: 64, borderRadius: 32, marginRight: Spacing.md },
  photoPlaceholder: {
    width: 64,
    height: 64,
    borderRadius: 32,
    marginRight: Spacing.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  photoInitial: { fontSize: FontSize.title, fontWeight: 'bold' },
  headerText: { flex: 1 },
  name: { fontSize: FontSize.title, fontWeight: 'bold' },
  detail: { fontSize: FontSize.body, marginTop: Spacing.xs },
  bio: { fontSize: FontSize.body, marginTop: Spacing.md, marginBottom: Spacing.md },
  clinicName: { fontSize: FontSize.heading, fontWeight: '600' },
  sectionTitle: { fontSize: FontSize.heading, fontWeight: '600', marginTop: Spacing.md, marginBottom: Spacing.sm },
  sessionDate: { fontSize: FontSize.large, fontWeight: '600' },
  note: { fontSize: FontSize.small, marginTop: Spacing.sm },
});  