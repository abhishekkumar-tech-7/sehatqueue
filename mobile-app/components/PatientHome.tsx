import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, useColorScheme, RefreshControl } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { TextField } from './TextField';
import { Card } from './Card';
import { LoadingView } from './StateViews';
import { supabase } from '../lib/supabase';
import { Profile } from '../lib/AuthContext';
import Colors from '../constants/Colors';
import { Spacing, FontSize, BorderRadius } from '../constants/Spacing';

type UpcomingBooking = {
  id: string;
  booking_mode: 'TOKEN' | 'SLOT';
  token_number: number | null;
  appointment_start: string | null;
  session_id: string;
  status: string;
  doctor_clinics: { doctors: { display_name: string } | null; clinics: { name: string } | null } | null;
};

type SessionLiveState = { current_token: number; last_token_issued: number };

type DoctorRow = {
  id: string;
  display_name: string;
  qualifications: string | null;
  doctor_specialties: { specialties: { name: string; slug: string } | null }[];
  doctor_clinics: { clinics: { name: string; locality: string | null; city: string } | null }[];
};

type Specialty = { id: string; name: string; slug: string };

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

export default function PatientHome({ profile }: { profile: Profile }) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme as 'light' | 'dark'];

  const [upcoming, setUpcoming] = useState<UpcomingBooking[]>([]);
  const [liveState, setLiveState] = useState<Record<string, SessionLiveState>>({});
  const [doctors, setDoctors] = useState<DoctorRow[]>([]);
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [query, setQuery] = useState('');
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [bookingsResult, doctorsResult, specialtiesResult] = await Promise.all([
      supabase
        .from('bookings')
        .select(
          `id, booking_mode, token_number, appointment_start, session_id, status,
           doctor_clinics(doctors(display_name), clinics(name))`
        )
        .eq('patient_id', profile.id)
        .eq('status', 'CONFIRMED')
        .order('created_at', { ascending: false }),
      supabase
        .from('doctors')
        .select(
          'id, display_name, qualifications, doctor_specialties(specialties(name, slug)), doctor_clinics(clinics(name, locality, city))'
        )
        .order('display_name'),
      supabase.from('specialties').select('id, name, slug').order('name'),
    ]);

    const bookings = (bookingsResult.data as unknown as UpcomingBooking[]) ?? [];
    setUpcoming(bookings);
    setDoctors((doctorsResult.data as unknown as DoctorRow[]) ?? []);
    setSpecialties((specialtiesResult.data as Specialty[]) ?? []);

    // Load the current live state for every session the patient has a
    // TOKEN booking in, so we can show "Now serving #X" immediately.
    const tokenSessionIds = Array.from(
      new Set(bookings.filter((b) => b.booking_mode === 'TOKEN').map((b) => b.session_id))
    );
    if (tokenSessionIds.length > 0) {
      const { data: sessionsData } = await supabase
        .from('clinic_sessions')
        .select('id, current_token, last_token_issued')
        .in('id', tokenSessionIds);

      const state: Record<string, SessionLiveState> = {};
      (sessionsData ?? []).forEach((s) => {
        state[s.id] = { current_token: s.current_token, last_token_issued: s.last_token_issued };
      });
      setLiveState(state);
    }

    setLoading(false);
  }, [profile.id]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load();
    }, [load])
  );

  // Subscribe to live updates for every session the patient has a token in,
  // so "Now serving #X" updates instantly when the doctor calls next.
  useEffect(() => {
    const tokenSessionIds = Array.from(
      new Set(upcoming.filter((b) => b.booking_mode === 'TOKEN').map((b) => b.session_id))
    );
    if (tokenSessionIds.length === 0) return;

    const channel = supabase
      .channel('home-token-updates')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'clinic_sessions' },
        (payload) => {
          const updated = payload.new as { id: string; current_token: number; last_token_issued: number };
          if (tokenSessionIds.includes(updated.id)) {
            setLiveState((prev) => ({
              ...prev,
              [updated.id]: {
                current_token: updated.current_token,
                last_token_issued: updated.last_token_issued,
              },
            }));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [upcoming]);

  const filteredDoctors = useMemo(() => {
    const text = query.trim().toLowerCase();
    return doctors.filter((d) => {
      const matchesText = !text || d.display_name.toLowerCase().includes(text);
      const matchesSpecialty =
        !selectedSlug || d.doctor_specialties.some((s) => s.specialties?.slug === selectedSlug);
      return matchesText && matchesSpecialty;
    });
  }, [doctors, query, selectedSlug]);

  const showSearchResults = query.trim().length > 0 || selectedSlug !== null;

  if (loading) return <LoadingView message="Loading..." />;

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={() => load()} tintColor={colors.primary} />}
    >
      <Text style={[styles.title, { color: colors.text }]}>Hello, {profile.full_name}</Text>

      <TextField label="Search doctors" placeholder="e.g. Sharma" value={query} onChangeText={setQuery} />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
        {[{ id: 'all', name: 'All', slug: null as string | null }, ...specialties].map((s) => {
          const active = selectedSlug === s.slug;
          return (
            <Pressable
              key={s.id}
              onPress={() => setSelectedSlug(s.slug)}
              style={[
                styles.chip,
                { backgroundColor: active ? colors.primary : colors.cardBackground, borderColor: colors.border },
              ]}
            >
              <Text style={{ color: active ? '#FFFFFF' : colors.text }}>{s.name}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {showSearchResults ? (
        <>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Search results</Text>
          {filteredDoctors.length === 0 ? (
            <Card>
              <Text style={[styles.emptyText, { color: colors.textMuted }]}>
                No doctors found. Try a different name or specialty.
              </Text>
            </Card>
          ) : (
            filteredDoctors.map((item) => {
              const clinic = item.doctor_clinics[0]?.clinics;
              const specialtyNames = item.doctor_specialties
                .map((s) => s.specialties?.name)
                .filter(Boolean)
                .join(', ');
              return (
                <Pressable
                  key={item.id}
                  onPress={() => router.push({ pathname: '/doctor/[id]', params: { id: item.id } } as any)}
                >
                  <Card>
                    <Text style={[styles.doctorName, { color: colors.text }]}>{item.display_name}</Text>
                    {specialtyNames ? (
                      <Text style={[styles.detail, { color: colors.textMuted }]}>{specialtyNames}</Text>
                    ) : null}
                    {item.qualifications ? (
                      <Text style={[styles.detail, { color: colors.textMuted }]}>{item.qualifications}</Text>
                    ) : null}
                    {clinic ? (
                      <Text style={[styles.clinic, { color: colors.primary }]}>
                        {clinic.name}, {clinic.locality ? clinic.locality + ', ' : ''}
                        {clinic.city}
                      </Text>
                    ) : null}
                  </Card>
                </Pressable>
              );
            })
          )}
        </>
      ) : (
        <>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Your upcoming bookings</Text>
          {upcoming.length === 0 ? (
            <Card>
              <Text style={[styles.emptyText, { color: colors.textMuted }]}>
                You don't have any upcoming bookings yet. Search for a doctor above to get started.
              </Text>
            </Card>
          ) : (
            upcoming.map((b) => {
              const live = liveState[b.session_id];
              return (
                <Pressable key={b.id} onPress={() => router.push('/(tabs)/bookings' as any)}>
                  <Card>
                    <Text style={[styles.doctorName, { color: colors.primary }]}>
                      {b.doctor_clinics?.doctors?.display_name}
                    </Text>
                    <Text style={[styles.detail, { color: colors.textMuted }]}>
                      {b.doctor_clinics?.clinics?.name}
                    </Text>
                    {b.booking_mode === 'TOKEN' ? (
                      <>
                        <Text style={[styles.detail, { color: colors.text }]}>Your token #{b.token_number}</Text>
                        {live ? (
                          <Text style={[styles.liveStatus, { color: colors.success }]}>
                            Now serving #{live.current_token > 0 ? live.current_token : '-'}
                          </Text>
                        ) : null}
                      </>
                    ) : (
                      b.appointment_start && (
                        <Text style={[styles.detail, { color: colors.text }]}>
                          {formatDateTime(b.appointment_start)}
                        </Text>
                      )
                    )}
                  </Card>
                </Pressable>
              );
            })
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
  title: { fontSize: FontSize.title, fontWeight: 'bold', marginBottom: Spacing.md },
  chipRow: { flexGrow: 0, marginBottom: Spacing.lg },
  chip: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    marginRight: Spacing.sm,
  },
  sectionTitle: { fontSize: FontSize.heading, fontWeight: '600', marginBottom: Spacing.sm },
  doctorName: { fontSize: FontSize.heading, fontWeight: '600' },
  detail: { fontSize: FontSize.body, marginTop: Spacing.xs },
  clinic: { fontSize: FontSize.small, fontWeight: '600', marginTop: Spacing.sm },
  liveStatus: { fontSize: FontSize.body, fontWeight: '700', marginTop: Spacing.xs },
  emptyText: { fontSize: FontSize.body },
});   