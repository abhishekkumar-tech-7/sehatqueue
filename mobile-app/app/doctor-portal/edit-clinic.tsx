import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, useColorScheme, Alert } from 'react-native';
import { Stack, router } from 'expo-router';
import { TextField } from '../../components/TextField';
import { Button } from '../../components/Button';
import { LoadingView, ErrorView } from '../../components/StateViews';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/AuthContext';
import Colors from '../../constants/Colors';
import { Spacing, FontSize, BorderRadius } from '../../constants/Spacing';

type ClinicRow = {
  id: string;
  name: string;
  address: string;
  locality: string | null;
  city: string;
  state: string;
  postal_code: string | null;
  phone: string | null;
};

type ClinicLink = { clinic_id: string; clinics: ClinicRow | null };

export default function EditClinicScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme as 'light' | 'dark'];
  const { profile } = useAuth();

  const [clinics, setClinics] = useState<ClinicRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [locality, setLocality] = useState('');
  const [city, setCity] = useState('');
  const [stateName, setStateName] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [phone, setPhone] = useState('');
  const [errors, setErrors] = useState<{ [key: string]: string }>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!profile) return;
    setLoadError(null);

    const { data: doctorRow } = await supabase
      .from('doctors')
      .select('id')
      .eq('profile_id', profile.id)
      .single();

    if (!doctorRow) {
      setLoadError('Doctor profile not found.');
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from('doctor_clinics')
      .select('clinic_id, clinics(id, name, address, locality, city, state, postal_code, phone)')
      .eq('doctor_id', doctorRow.id);

    if (error) {
      setLoadError('Could not load your clinic. Please check your internet connection.');
    } else {
      const list = ((data as unknown as ClinicLink[]) ?? [])
        .map((l) => l.clinics)
        .filter((c): c is ClinicRow => c !== null);
      setClinics(list);
      if (list.length > 0) setSelectedId((current) => current ?? list[0].id);
    }
    setLoading(false);
  }, [profile]);

  useEffect(() => {
    load();
  }, [load]);

  // Fill the form whenever the selected clinic changes.
  useEffect(() => {
    const clinic = clinics.find((c) => c.id === selectedId);
    if (!clinic) return;
    setName(clinic.name);
    setAddress(clinic.address);
    setLocality(clinic.locality ?? '');
    setCity(clinic.city);
    setStateName(clinic.state);
    setPostalCode(clinic.postal_code ?? '');
    setPhone(clinic.phone ?? '');
    setErrors({});
  }, [selectedId, clinics]);

  function validate() {
    const e: { [key: string]: string } = {};
    if (name.trim().length < 2) e.name = 'Enter the clinic name';
    if (address.trim().length < 5) e.address = 'Enter the full address';
    if (city.trim().length < 2) e.city = 'Enter the city';
    if (stateName.trim().length < 2) e.state = 'Enter the state';
    if (postalCode.trim() && !/^\d{6}$/.test(postalCode.trim())) e.postalCode = 'Postal code must be 6 digits';
    if (phone.trim() && !/^[0-9+ -]{5,15}$/.test(phone.trim())) e.phone = 'Enter a valid phone number';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSave() {
    if (!selectedId || !validate()) return;

    setSaving(true);
    const { error } = await supabase.rpc('update_my_clinic', {
      p_clinic_id: selectedId,
      p_name: name.trim(),
      p_address: address.trim(),
      p_locality: locality.trim() || null,
      p_city: city.trim(),
      p_state: stateName.trim(),
      p_postal_code: postalCode.trim() || null,
      p_phone: phone.trim() || null,
    });
    setSaving(false);

    if (error) {
      Alert.alert('Could not save', error.message);
      return;
    }

    Alert.alert('Saved', 'Your clinic details have been updated.', [
      { text: 'OK', onPress: () => router.back() },
    ]);
  }

  if (loading) return <LoadingView message="Loading your clinic..." />;
  if (loadError) {
    return (
      <ErrorView
        message={loadError}
        onRetry={() => {
          setLoading(true);
          load();
        }}
      />
    );
  }
  if (clinics.length === 0) {
    return <ErrorView message="You are not linked to a clinic yet. Create one from + New Session first." />;
  }

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen options={{ title: 'Edit Clinic' }} />

      {clinics.length > 1 && (
        <>
          <Text style={[styles.label, { color: colors.text }]}>Clinic</Text>
          <View style={styles.chipRow}>
            {clinics.map((c) => {
              const active = c.id === selectedId;
              return (
                <Pressable
                  key={c.id}
                  onPress={() => setSelectedId(c.id)}
                  style={[
                    styles.chip,
                    { backgroundColor: active ? colors.primary : colors.cardBackground, borderColor: colors.border },
                  ]}
                >
                  <Text style={{ color: active ? '#FFFFFF' : colors.text }}>{c.name}</Text>
                </Pressable>
              );
            })}
          </View>
        </>
      )}

      <Text style={[styles.note, { color: colors.textMuted }]}>
        Patients see this address on your profile. If you change the address, Get Directions will search
        for the new address.
      </Text>

      <TextField label="Clinic Name" value={name} onChangeText={setName} error={errors.name} />
      <TextField label="Address" value={address} onChangeText={setAddress} error={errors.address} />
      <TextField label="Locality (optional)" value={locality} onChangeText={setLocality} />
      <TextField label="City" value={city} onChangeText={setCity} error={errors.city} />
      <TextField label="State" value={stateName} onChangeText={setStateName} error={errors.state} />
      <TextField
        label="Postal Code (optional)"
        keyboardType="number-pad"
        maxLength={6}
        value={postalCode}
        onChangeText={(v) => setPostalCode(v.replace(/\D/g, ''))}
        error={errors.postalCode}
      />
      <TextField
        label="Clinic Phone (optional)"
        keyboardType="phone-pad"
        value={phone}
        onChangeText={setPhone}
        error={errors.phone}
      />

      <View style={styles.buttonGroup}>
        <Button title="Save Changes" onPress={handleSave} variant="primary" loading={saving} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
  label: { fontSize: FontSize.body, fontWeight: '600', marginBottom: Spacing.xs },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginBottom: Spacing.md },
  chip: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
  },
  note: { fontSize: FontSize.small, marginBottom: Spacing.md },
  buttonGroup: { marginTop: Spacing.lg },
});     