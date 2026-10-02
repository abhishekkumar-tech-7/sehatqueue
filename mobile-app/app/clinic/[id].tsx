import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, useColorScheme } from 'react-native';
import { Stack, useLocalSearchParams, router } from 'expo-router';
import { Card } from '../../components/Card';
import { LoadingView, ErrorView } from '../../components/StateViews';
import { supabase } from '../../lib/supabase';
import Colors from '../../constants/Colors';
import { Spacing, FontSize } from '../../constants/Spacing';

type ClinicDetail = {
  id: string;
  name: string;
  address: string;
  locality: string | null;
  city: string;
  state: string;
  phone: string | null;
  doctor_clinics: {
    relationship_status: string;
    doctors: {
      id: string;
      display_name: string;
      qualifications: string | null;
      verification_status: string;
      doctor_specialties: { specialties: { name: string } | null }[];
    } | null;
  }[];
};

export default function ClinicProfileScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme as 'light' | 'dark'];
  const { id } = useLocalSearchParams<{ id: string }>();

  const [clinic, setClinic] = useState<ClinicDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const { data, error: queryError } = await supabase
      .from('clinics')
      .select(
        `id, name, address, locality, city, state, phone,
         doctor_clinics(relationship_status,
           doctors(id, display_name, qualifications, verification_status,
             doctor_specialties(specialties(name))))`
      )
      .eq('id', id)
      .single();

    if (queryError || !data) {
      setError('Could not load this clinic. Please check your internet connection.');
    } else {
      setClinic(data as unknown as ClinicDetail);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <LoadingView message="Loading clinic..." />;
  if (error || !clinic) {
    return (
      <ErrorView
        message={error ?? 'Clinic not found.'}
        onRetry={() => {
          setLoading(true);
          load();
        }}
      />
    );
  }

  const approvedDoctors = clinic.doctor_clinics.filter(
    (link) => link.relationship_status === 'ACTIVE' && link.doctors?.verification_status === 'APPROVED'
  );

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.container}>
      <Stack.Screen options={{ title: clinic.name }} />

      <Text style={[styles.name, { color: colors.text }]}>{clinic.name}</Text>
      <Text style={[styles.detail, { color: colors.textMuted }]}>
        {clinic.address}
        {clinic.locality ? `, ${clinic.locality}` : ''}, {clinic.city}, {clinic.state}
      </Text>
      {clinic.phone ? (
        <Text style={[styles.detail, { color: colors.textMuted }]}>Phone: {clinic.phone}</Text>
      ) : null}

      <Text style={[styles.sectionTitle, { color: colors.text }]}>Doctors at this clinic</Text>

      {approvedDoctors.length === 0 ? (
        <Text style={[styles.detail, { color: colors.textMuted }]}>No doctors listed here yet.</Text>
      ) : (
        approvedDoctors.map((link) => {
          const doctor = link.doctors!;
          const specialties = doctor.doctor_specialties
            .map((s) => s.specialties?.name)
            .filter(Boolean)
            .join(', ');
          return (
            <Pressable
              key={doctor.id}
              onPress={() => router.push({ pathname: '/doctor/[id]', params: { id: doctor.id } } as any)}
            >
              <Card>
                <Text style={[styles.doctorName, { color: colors.primary }]}>{doctor.display_name}</Text>
                {specialties ? (
                  <Text style={[styles.detail, { color: colors.textMuted }]}>{specialties}</Text>
                ) : null}
                {doctor.qualifications ? (
                  <Text style={[styles.detail, { color: colors.textMuted }]}>{doctor.qualifications}</Text>
                ) : null}
              </Card>
            </Pressable>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
  name: { fontSize: FontSize.title, fontWeight: 'bold' },
  detail: { fontSize: FontSize.body, marginTop: Spacing.xs },
  sectionTitle: { fontSize: FontSize.heading, fontWeight: '600', marginTop: Spacing.lg, marginBottom: Spacing.sm },
  doctorName: { fontSize: FontSize.heading, fontWeight: '600' },
});  