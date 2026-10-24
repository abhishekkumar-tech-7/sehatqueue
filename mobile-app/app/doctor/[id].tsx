import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, useColorScheme, Image } from 'react-native';
import { Stack, useLocalSearchParams, router } from 'expo-router';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { ClinicMap } from '../../components/ClinicMap';
import { LoadingView, ErrorView } from '../../components/StateViews';
import { supabase } from '../../lib/supabase';
import Colors from '../../constants/Colors';
import { Spacing, FontSize } from '../../constants/Spacing';
import { FeeQuote } from '../../lib/checkout';
import { formatRupees } from '../../lib/money';

type Session = {
  id: string;
  session_date: string;
  start_time: string;
  end_time: string;
  booking_mode: 'TOKEN' | 'SLOT';
  capacity: number;
  status: string;
  block_label: string | null;
};

type ClinicInfo = {
  id: string;
  name: string;
  address: string;
  locality: string | null;
  city: string;
  state: string;
  phone: string | null;
  latitude: number | null;
  longitude: number | null;
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
    clinics: ClinicInfo | null;
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

function nowTimeInIndia() {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(11, 16);
}

function addDays(ymd: string, n: number) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// The doctor's own name for the session, or one based on the start time.
function blockName(s: Session) {
  if (s.block_label) return s.block_label;
  const h = parseInt(s.start_time.slice(0, 2), 10);
  if (h < 12) return 'Morning';
  if (h < 17) return 'Afternoon';
  if (h < 21) return 'Evening';
  return 'Night';
}

function fullAddress(c: ClinicInfo) {
  return `${c.address}${c.locality ? ', ' + c.locality : ''}, ${c.city}, ${c.state}`;
}

export default function DoctorProfileScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme as 'light' | 'dark'];
  const { id } = useLocalSearchParams<{ id: string }>();

  const [doctor, setDoctor] = useState<DoctorDetail | null>(null);
  const [fee, setFee] = useState<FeeQuote | null>(null);
  const [openDays, setOpenDays] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const { data, error: queryError } = await supabase
      .from('doctors')
      .select(
        `id, display_name, bio, qualifications, photo_url, experience_years,
         doctor_specialties(specialties(name)),
         doctor_clinics(id, clinics(id, name, address, locality, city, state, phone, latitude, longitude),
           clinic_sessions(id, session_date, start_time, end_time, booking_mode, capacity, status, block_label))`
      )
      .eq('id', id)
      .single();

    if (queryError || !data) {
      setError('Could not load this doctor. Please check your internet connection.');
    } else {
      setDoctor(data as unknown as DoctorDetail);
      const { data: feeData } = await supabase.rpc('get_doctor_fee_quote', { p_doctor_id: id });
      const feeRow = Array.isArray(feeData) ? feeData[0] : feeData;
      setFee((feeRow as FeeQuote) ?? null);
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
  const tomorrow = addDays(today, 1);
  const nowTime = nowTimeInIndia();

  function dayLabel(date: string) {
    if (date === today) return 'Today';
    if (date === tomorrow) return 'Tomorrow';
    return formatDate(date);
  }

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
      {fee ? (
        <Text style={[styles.feeLine, { color: colors.text }]}>
          Consultation fee - {fee.consultation_paise === 0 ? 'Free' : formatRupees(fee.consultation_paise)}
        </Text>
      ) : null}

      {doctor.doctor_clinics.map((link) => {
        const sessions = link.clinic_sessions
          .filter(
            (s) =>
              s.status === 'OPEN' &&
              (s.session_date > today || (s.session_date === today && s.end_time.slice(0, 5) > nowTime))
          )
          .sort((a, b) => (a.session_date + a.start_time).localeCompare(b.session_date + b.start_time));

        // One group per date, in date order.
        const days: { date: string; items: Session[] }[] = [];
        sessions.forEach((s) => {
          const last = days[days.length - 1];
          if (last && last.date === s.session_date) last.items.push(s);
          else days.push({ date: s.session_date, items: [s] });
        });

        return (
          <View key={link.id}>
            {link.clinics ? (
              <>
                <Pressable
                  onPress={() => router.push({ pathname: '/clinic/[id]', params: { id: link.clinics!.id } } as any)}
                >
                  <Card>
                    <Text style={[styles.clinicName, { color: colors.primary }]}>{link.clinics.name}</Text>
                    <Text style={[styles.detail, { color: colors.text }]}>
                      {link.clinics.address}
                      {link.clinics.locality ? `, ${link.clinics.locality}` : ''}, {link.clinics.city}
                    </Text>
                  </Card>
                </Pressable>

                <View style={styles.directions}>
                  <ClinicMap
                    latitude={link.clinics.latitude}
                    longitude={link.clinics.longitude}
                    address={fullAddress(link.clinics)}
                  />
                </View>
              </>
            ) : null}

            <Text style={[styles.sectionTitle, { color: colors.text }]}>Available sessions</Text>

            {days.length === 0 ? (
              <Text style={[styles.detail, { color: colors.textMuted }]}>No open sessions right now.</Text>
            ) : (
              days.map((day) => {
                const key = `${link.id}:${day.date}`;
                const expanded = openDays[key] ?? days.length === 1;

                return (
                  <View key={key}>
                    <Pressable
                      onPress={() => setOpenDays((prev) => ({ ...prev, [key]: !expanded }))}
                      accessibilityRole="button"
                      accessibilityState={{ expanded }}
                    >
                      <Card>
                        <View style={styles.dayRow}>
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.sessionDate, { color: colors.text }]}>{dayLabel(day.date)}</Text>
                            <Text style={[styles.detail, { color: colors.textMuted }]}>
                              {day.items.map((s) => blockName(s)).join(', ')}
                            </Text>
                          </View>
                          <Text style={[styles.toggle, { color: colors.primary }]}>{expanded ? 'Hide' : 'View'}</Text>
                        </View>
                      </Card>
                    </Pressable>

                    {expanded
                      ? day.items.map((s) => (
                          <View key={s.id} style={styles.subCard}>
                            <Card>
                              <Text style={[styles.blockTitle, { color: colors.text }]}>{blockName(s)}</Text>
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
                          </View>
                        ))
                      : null}
                  </View>
                );
              })
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
  directions: { marginBottom: Spacing.xs },
  sectionTitle: { fontSize: FontSize.heading, fontWeight: '600', marginTop: Spacing.md, marginBottom: Spacing.sm },
  sessionDate: { fontSize: FontSize.large, fontWeight: '600' },
  dayRow: { flexDirection: 'row', alignItems: 'center' },
  toggle: { fontSize: FontSize.body, fontWeight: '600', marginLeft: Spacing.md },
  subCard: { marginLeft: Spacing.md },
  blockTitle: { fontSize: FontSize.heading, fontWeight: '600' },
  note: { fontSize: FontSize.small, marginTop: Spacing.sm },
  feeLine: { fontSize: FontSize.heading, fontWeight: '600', marginBottom: Spacing.md },
});    