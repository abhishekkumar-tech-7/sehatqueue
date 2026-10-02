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

type ClinicLink = { id: string; clinics: { name: string } | null };

function todayInIndia() {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export default function NewSessionScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme as 'light' | 'dark'];
  const { profile } = useAuth();

  const [clinics, setClinics] = useState<ClinicLink[]>([]);
  const [selectedClinic, setSelectedClinic] = useState<string | null>(null);
  const [date, setDate] = useState(todayInIndia());
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('13:00');
  const [mode, setMode] = useState<'TOKEN' | 'SLOT'>('TOKEN');
  const [capacity, setCapacity] = useState('30');
  const [avgMinutes, setAvgMinutes] = useState('5');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!profile) return;
    setError(null);
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
      .from('doctor_clinics')
      .select('id, clinics(name)')
      .eq('doctor_id', doctorRow.id);

    if (queryError) {
      setError('Could not load your clinics.');
    } else {
      const list = data as unknown as ClinicLink[];
      setClinics(list);
      if (list.length > 0) setSelectedClinic(list[0].id);
    }
    setLoading(false);
  }, [profile]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate() {
    if (!selectedClinic) {
      Alert.alert('Select a clinic', 'Please choose which clinic this session is for.');
      return;
    }
    const capacityNum = parseInt(capacity, 10);
    const avgMinutesNum = parseInt(avgMinutes, 10);
    if (!capacityNum || capacityNum < 1) {
      Alert.alert('Invalid capacity', 'Enter a capacity of at least 1.');
      return;
    }

    setSaving(true);
    const { data, error: createError } = await supabase.rpc('create_clinic_session', {
      p_doctor_clinic_id: selectedClinic,
      p_session_date: date,
      p_start_time: startTime,
      p_end_time: endTime,
      p_booking_mode: mode,
      p_capacity: capacityNum,
      p_avg_consultation_minutes: mode === 'TOKEN' ? avgMinutesNum || 5 : 5,
    });
    setSaving(false);

    if (createError) {
      Alert.alert('Could not create session', createError.message);
      return;
    }

    Alert.alert('Session created', 'Your session is now open for booking.', [
      { text: 'OK', onPress: () => router.back() },
    ]);
  }

  if (loading) return <LoadingView message="Loading your clinics..." />;
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
  if (clinics.length === 0) {
    return <ClinicSetupForm onDone={load} />;
  }

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.container}>
      <Stack.Screen options={{ title: 'New Session' }} />

      <Text style={[styles.label, { color: colors.text }]}>Clinic</Text>
      <View style={styles.chipRow}>
        {clinics.map((c) => {
          const active = selectedClinic === c.id;
          return (
            <Pressable
              key={c.id}
              onPress={() => setSelectedClinic(c.id)}
              style={[
                styles.chip,
                { backgroundColor: active ? colors.primary : colors.cardBackground, borderColor: colors.border },
              ]}
            >
              <Text style={{ color: active ? '#FFFFFF' : colors.text }}>{c.clinics?.name}</Text>
            </Pressable>
          );
        })}
      </View>

      <TextField label="Date (YYYY-MM-DD)" value={date} onChangeText={setDate} />
      <TextField label="Start Time (HH:MM, 24-hour)" value={startTime} onChangeText={setStartTime} />
      <TextField label="End Time (HH:MM, 24-hour)" value={endTime} onChangeText={setEndTime} />

      <Text style={[styles.label, { color: colors.text }]}>Booking Mode</Text>
      <View style={styles.chipRow}>
        <Pressable
          onPress={() => setMode('TOKEN')}
          style={[
            styles.chip,
            { backgroundColor: mode === 'TOKEN' ? colors.primary : colors.cardBackground, borderColor: colors.border },
          ]}
        >
          <Text style={{ color: mode === 'TOKEN' ? '#FFFFFF' : colors.text }}>Token Queue</Text>
        </Pressable>
        <Pressable
          onPress={() => setMode('SLOT')}
          style={[
            styles.chip,
            { backgroundColor: mode === 'SLOT' ? colors.primary : colors.cardBackground, borderColor: colors.border },
          ]}
        >
          <Text style={{ color: mode === 'SLOT' ? '#FFFFFF' : colors.text }}>Time Slots</Text>
        </Pressable>
      </View>

      <TextField
        label="Capacity"
        keyboardType="number-pad"
        value={capacity}
        onChangeText={setCapacity}
      />
      {mode === 'TOKEN' && (
        <TextField
          label="Average minutes per patient"
          keyboardType="number-pad"
          value={avgMinutes}
          onChangeText={setAvgMinutes}
        />
      )}

      <View style={styles.buttonGroup}>
        <Button title="Create Session" onPress={handleCreate} variant="primary" loading={saving} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
  label: { fontSize: FontSize.body, fontWeight: '600', marginBottom: Spacing.xs, marginTop: Spacing.sm },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginBottom: Spacing.md },
  chip: { minHeight: 44, justifyContent: 'center', paddingHorizontal: Spacing.md, borderRadius: BorderRadius.lg, borderWidth: 1 },
  buttonGroup: { marginTop: Spacing.lg },
});  
function ClinicSetupForm({ onDone }: { onDone: () => void }) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme as 'light' | 'dark'];

  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [locality, setLocality] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleCreate() {
    if (!name.trim() || !address.trim() || !city.trim() || !state.trim()) {
      Alert.alert('Missing details', 'Please fill in at least name, address, city and state.');
      return;
    }

    setSaving(true);
    const { error: createError } = await supabase.rpc('create_my_clinic', {
      p_name: name.trim(),
      p_address: address.trim(),
      p_locality: locality.trim() || null,
      p_city: city.trim(),
      p_state: state.trim(),
      p_postal_code: postalCode.trim() || null,
      p_phone: phone.trim() || null,
    });
    setSaving(false);

    if (createError) {
      Alert.alert('Could not create clinic', createError.message);
      return;
    }

    onDone();
  }

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.container}>
      <Stack.Screen options={{ title: 'Set Up Your Clinic' }} />
      <Text style={[styles.label, { color: colors.text, marginTop: 0 }]}>
        You're not linked to a clinic yet. Add your clinic details to get started.
      </Text>

      <TextField label="Clinic Name" value={name} onChangeText={setName} />
      <TextField label="Address" value={address} onChangeText={setAddress} />
      <TextField label="Locality (optional)" value={locality} onChangeText={setLocality} />
      <TextField label="City" value={city} onChangeText={setCity} />
      <TextField label="State" value={state} onChangeText={setState} />
      <TextField label="Postal Code (optional)" value={postalCode} onChangeText={setPostalCode} />
      <TextField label="Phone (optional)" keyboardType="phone-pad" value={phone} onChangeText={setPhone} />

      <View style={styles.buttonGroup}>
        <Button title="Create Clinic" onPress={handleCreate} variant="primary" loading={saving} />
      </View>
    </ScrollView>
  );
}     