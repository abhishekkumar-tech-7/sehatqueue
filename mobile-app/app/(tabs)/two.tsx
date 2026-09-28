import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, ScrollView, useColorScheme } from 'react-native';
import { TextField } from '../../components/TextField';
import { Card } from '../../components/Card';
import { LoadingView, EmptyView, ErrorView } from '../../components/StateViews';
import { supabase } from '../../lib/supabase';
import Colors from '../../constants/Colors';
import { Spacing, FontSize, BorderRadius } from '../../constants/Spacing';

type DoctorRow = {
  id: string;
  display_name: string;
  qualifications: string | null;
  doctor_specialties: { specialties: { name: string; slug: string } | null }[];
  doctor_clinics: { clinics: { name: string; locality: string | null; city: string } | null }[];
};

type Specialty = { id: string; name: string; slug: string };

export default function SearchScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme as 'light' | 'dark'];

  const [doctors, setDoctors] = useState<DoctorRow[]>([]);
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const [doctorsResult, specialtiesResult] = await Promise.all([
      supabase
        .from('doctors')
        .select(
          'id, display_name, qualifications, doctor_specialties(specialties(name, slug)), doctor_clinics(clinics(name, locality, city))'
        )
        .order('display_name'),
      supabase.from('specialties').select('id, name, slug').order('name'),
    ]);

    if (doctorsResult.error || specialtiesResult.error) {
      setError('Could not load doctors. Please check your internet connection.');
    } else {
      setDoctors(doctorsResult.data as unknown as DoctorRow[]);
      setSpecialties(specialtiesResult.data as Specialty[]);
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase();
    return doctors.filter((d) => {
      const matchesText = !text || d.display_name.toLowerCase().includes(text);
      const matchesSpecialty =
        !selectedSlug || d.doctor_specialties.some((s) => s.specialties?.slug === selectedSlug);
      return matchesText && matchesSpecialty;
    });
  }, [doctors, query, selectedSlug]);

  if (loading) return <LoadingView message="Finding doctors..." />;
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
      <TextField label="Search by doctor name" placeholder="e.g. Sharma" value={query} onChangeText={setQuery} />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
        {[{ id: 'all', name: 'All', slug: null as string | null }, ...specialties].map((s) => {
          const active = selectedSlug === s.slug;
          return (
            <Pressable
              key={s.id}
              onPress={() => setSelectedSlug(s.slug)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={[
                styles.chip,
                { backgroundColor: active ? colors.primary : colors.cardBackground, borderColor: colors.border },
              ]}
            >
              <Text style={{ color: active ? '#FFFFFF' : colors.text, fontSize: FontSize.body }}>{s.name}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        refreshing={refreshing}
        onRefresh={() => {
          setRefreshing(true);
          load();
        }}
        ListEmptyComponent={
          <EmptyView title="No doctors found" message="Try a different name or specialty, or pull down to refresh." />
        }
        renderItem={({ item }) => {
          const clinic = item.doctor_clinics[0]?.clinics;
          const specialtyNames = item.doctor_specialties
            .map((s) => s.specialties?.name)
            .filter(Boolean)
            .join(', ');
          return (
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
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: Spacing.lg, paddingBottom: 0 },
  chipRow: { flexGrow: 0, marginBottom: Spacing.md },
  chip: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    marginRight: Spacing.sm,
  },
  doctorName: { fontSize: FontSize.heading, fontWeight: '600' },
  detail: { fontSize: FontSize.body, marginTop: Spacing.xs },
  clinic: { fontSize: FontSize.small, fontWeight: '600', marginTop: Spacing.sm },
}); 