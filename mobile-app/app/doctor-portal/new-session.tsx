import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, useColorScheme, Alert } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { TextField } from '../../components/TextField';
import { Button } from '../../components/Button';
import { LoadingView, ErrorView } from '../../components/StateViews';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/AuthContext';
import Colors from '../../constants/Colors';
import { Spacing, FontSize, BorderRadius } from '../../constants/Spacing';

type ClinicLink = { id: string; clinics: { name: string } | null };

type Block = {
  key: string;
  label: string;
  start: string;
  end: string;
  mode: 'TOKEN' | 'SLOT';
  capacity: string;
  avg: string;
};

type RangeKey = 'TODAY' | 'TOMORROW' | 'WEEK' | 'CUSTOM';

const PRESETS = [
  { label: 'Morning', start: '09:00', end: '13:00' },
  { label: 'Evening', start: '17:00', end: '20:00' },
  { label: 'Night', start: '20:00', end: '22:00' },
];

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function todayInIndia() {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function addDays(ymd: string, n: number) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function newBlock(index: number): Block {
  const p = PRESETS[index] ?? { label: '', start: '09:00', end: '13:00' };
  return {
    key: Math.random().toString(36).slice(2),
    label: p.label,
    start: p.start,
    end: p.end,
    mode: 'TOKEN',
    capacity: '30',
    avg: '5',
  };
}

export default function NewSessionScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme as 'light' | 'dark'];
  const { profile } = useAuth();

  const [clinics, setClinics] = useState<ClinicLink[]>([]);
  const [selectedClinic, setSelectedClinic] = useState<string | null>(null);
    const params = useLocalSearchParams<{ date?: string; clinicId?: string }>();
  const [range, setRange] = useState<RangeKey>(params.date ? 'CUSTOM' : 'TODAY');
  const [customStart, setCustomStart] = useState(params.date ?? todayInIndia());
  const [customDays, setCustomDays] = useState(params.date ? '1' : '7');
  const [skipSat, setSkipSat] = useState(false);
  const [skipSun, setSkipSun] = useState(false);
  const [blocks, setBlocks] = useState<Block[]>([newBlock(0)]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!profile) return;
    setError(null);

    if (profile.role === 'RECEPTIONIST') {
      const { data: staffRows } = await supabase
        .from('clinic_staff')
        .select('clinic_id')
        .eq('profile_id', profile.id)
        .eq('is_active', true);

      const clinicIds = (staffRows ?? []).map((r) => r.clinic_id);
      if (clinicIds.length === 0) {
        setClinics([]);
        setLoading(false);
        return;
      }

      const { data, error: queryError } = await supabase
        .from('doctor_clinics')
        .select('id, clinics(name)')
        .in('clinic_id', clinicIds);

      if (queryError) {
        setError('Could not load your clinics.');
      } else {
        const list = data as unknown as ClinicLink[];
        setClinics(list);
        if (list.length > 0) setSelectedClinic(list[0].id);
      }
      setLoading(false);
      return;
    }

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

  useEffect(() => {
    if (params.clinicId && clinics.some((c) => c.id === params.clinicId)) setSelectedClinic(params.clinicId);
  }, [clinics, params.clinicId]);

  function updateBlock(key: string, patch: Partial<Block>) {
    setBlocks((prev) => prev.map((b) => (b.key === key ? { ...b, ...patch } : b)));
  }

  function addBlock() {
    if (blocks.length >= 8) return;
    setBlocks((prev) => [...prev, newBlock(prev.length)]);
  }

  function removeBlock(key: string) {
    setBlocks((prev) => (prev.length > 1 ? prev.filter((b) => b.key !== key) : prev));
  }

  function getPlan(): { from: string; days: number } | string {
    const today = todayInIndia();
    if (range === 'TODAY') return { from: today, days: 1 };
    if (range === 'TOMORROW') return { from: addDays(today, 1), days: 1 };
    if (range === 'WEEK') return { from: today, days: 7 };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(customStart) || isNaN(new Date(customStart).getTime())) {
      return 'Enter the start date as YYYY-MM-DD.';
    }
    const days = parseInt(customDays, 10);
    if (!days || days < 1 || days > 30) return 'Choose between 1 and 30 days.';
    return { from: customStart, days };
  }

  function validate(): string | null {
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const n = `Session ${i + 1}`;
      if (!TIME_RE.test(b.start) || !TIME_RE.test(b.end)) return `${n}: enter times as HH:MM, 24-hour (for example 17:30).`;
      if (b.end <= b.start) return `${n}: the end time must be after the start time. A session cannot run past midnight.`;
      if (!(parseInt(b.capacity, 10) >= 1)) return `${n}: capacity must be at least 1.`;
      for (let j = i + 1; j < blocks.length; j++) {
        const o = blocks[j];
        if (TIME_RE.test(o.start) && TIME_RE.test(o.end) && b.start < o.end && b.end > o.start) {
          return `Session ${i + 1} and session ${j + 1} overlap in time.`;
        }
      }
    }
    return null;
  }

  async function handleCreate() {
    if (!selectedClinic) {
      Alert.alert('Select a clinic', 'Please choose which clinic this is for.');
      return;
    }
    const plan = getPlan();
    if (typeof plan === 'string') {
      Alert.alert('Check the dates', plan);
      return;
    }
    const problem = validate();
    if (problem) {
      Alert.alert('Check your sessions', problem);
      return;
    }

    const skip: number[] = [];
    if (skipSat) skip.push(6);
    if (skipSun) skip.push(7);

    setSaving(true);
    const { data, error: createError } = await supabase.rpc('create_sessions_bulk', {
      p_doctor_clinic_id: selectedClinic,
      p_from: plan.from,
      p_days: plan.days,
      p_skip_weekdays: skip,
      p_blocks: blocks.map((b) => ({
        label: b.label.trim(),
        start: b.start,
        end: b.end,
        mode: b.mode,
        capacity: parseInt(b.capacity, 10),
        avg: parseInt(b.avg, 10) || 5,
      })),
    });
    setSaving(false);

    if (createError) {
      Alert.alert('Could not create sessions', createError.message);
      return;
    }

    const r = (Array.isArray(data) ? data[0] : data) as {
      created_count: number;
      holiday_count: number;
      overlap_count: number;
      past_count: number;
    };
    const lines = [`${r.created_count} session(s) created.`];
    if (r.holiday_count > 0) lines.push(`${r.holiday_count} skipped because the doctor is on holiday.`);
    if (r.overlap_count > 0) lines.push(`${r.overlap_count} skipped because a session already exists at that time.`);
    if (r.past_count > 0) lines.push(`${r.past_count} skipped because the time has already passed.`);

    if (r.created_count === 0) {
      Alert.alert('Nothing was created', lines.slice(1).join('\n') || 'No sessions were created.');
      return;
    }
    Alert.alert('Done', lines.join('\n'), [{ text: 'OK', onPress: () => router.back() }]);
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
    if (profile?.role === 'RECEPTIONIST') {
      return (
        <ErrorView message="You are not assigned to a clinic yet. Ask a doctor to add you as a receptionist first." />
      );
    }
    return <ClinicSetupForm onDone={load} />;
  }

  const chip = (label: string, active: boolean, onPress: () => void, key?: string) => (
    <Pressable
      key={key ?? label}
      onPress={onPress}
      style={[
        styles.chip,
        { backgroundColor: active ? colors.primary : colors.cardBackground, borderColor: colors.border },
      ]}
    >
      <Text style={{ color: active ? '#FFFFFF' : colors.text }}>{label}</Text>
    </Pressable>
  );

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen options={{ title: 'New Sessions' }} />

      <Text style={[styles.label, { color: colors.text }]}>Clinic</Text>
      <View style={styles.chipRow}>
        {clinics.map((c) => chip(c.clinics?.name ?? 'Clinic', selectedClinic === c.id, () => setSelectedClinic(c.id), c.id))}
      </View>

      <Text style={[styles.label, { color: colors.text }]}>For which days?</Text>
      <View style={styles.chipRow}>
        {chip('Today', range === 'TODAY', () => setRange('TODAY'))}
        {chip('Tomorrow', range === 'TOMORROW', () => setRange('TOMORROW'))}
        {chip('Next 7 days', range === 'WEEK', () => setRange('WEEK'))}
        {chip('Custom', range === 'CUSTOM', () => setRange('CUSTOM'))}
      </View>

      {range === 'CUSTOM' && (
        <>
          <TextField label="Start date (YYYY-MM-DD)" value={customStart} onChangeText={setCustomStart} />
          <TextField
            label="Number of days (1 to 30)"
            keyboardType="number-pad"
            value={customDays}
            onChangeText={(v) => setCustomDays(v.replace(/\D/g, ''))}
          />
        </>
      )}

      {(range === 'WEEK' || range === 'CUSTOM') && (
        <View style={styles.chipRow}>
          {chip('Skip Saturdays', skipSat, () => setSkipSat((v) => !v))}
          {chip('Skip Sundays', skipSun, () => setSkipSun((v) => !v))}
        </View>
      )}

      <Text style={[styles.help, { color: colors.textMuted }]}>
        Days marked as a holiday are skipped automatically, and so is any time that overlaps a session you already have.
      </Text>

      {blocks.map((b, index) => (
        <View
          key={b.key}
          style={[styles.blockCard, { backgroundColor: colors.cardBackground, borderColor: colors.border }]}
        >
          <View style={styles.blockHeader}>
            <Text style={[styles.blockTitle, { color: colors.text }]}>Session {index + 1}</Text>
            {blocks.length > 1 ? (
              <Pressable onPress={() => removeBlock(b.key)}>
                <Text style={{ color: colors.error, fontWeight: '600' }}>Remove</Text>
              </Pressable>
            ) : null}
          </View>

          <View style={styles.chipRow}>
            {PRESETS.map((p) =>
              chip(p.label, b.label === p.label, () => updateBlock(b.key, { label: p.label, start: p.start, end: p.end }), p.label)
            )}
          </View>
          <TextField
            label="Session name (shown to patients)"
            placeholder="e.g. Morning"
            maxLength={30}
            value={b.label}
            onChangeText={(v) => updateBlock(b.key, { label: v })}
          />
          <TextField label="Start (HH:MM, 24-hour)" value={b.start} onChangeText={(v) => updateBlock(b.key, { start: v })} />
          <TextField label="End (HH:MM, 24-hour)" value={b.end} onChangeText={(v) => updateBlock(b.key, { end: v })} />

          <View style={styles.chipRow}>
            {chip('Token Queue', b.mode === 'TOKEN', () => updateBlock(b.key, { mode: 'TOKEN' }), 'tk')}
            {chip('Time Slots', b.mode === 'SLOT', () => updateBlock(b.key, { mode: 'SLOT' }), 'sl')}
          </View>
          <TextField
            label="Capacity"
            keyboardType="number-pad"
            value={b.capacity}
            onChangeText={(v) => updateBlock(b.key, { capacity: v.replace(/\D/g, '') })}
          />
          {b.mode === 'TOKEN' && (
            <TextField
              label="Average minutes per patient"
              keyboardType="number-pad"
              value={b.avg}
              onChangeText={(v) => updateBlock(b.key, { avg: v.replace(/\D/g, '') })}
            />
          )}
        </View>
      ))}

      {blocks.length < 8 ? <Button title="+ Add another session in the day" onPress={addBlock} variant="secondary" /> : null}

      <View style={styles.buttonGroup}>
        <Button title="Create Sessions" onPress={handleCreate} variant="primary" loading={saving} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
  label: { fontSize: FontSize.body, fontWeight: '600', marginBottom: Spacing.xs, marginTop: Spacing.sm },
  help: { fontSize: FontSize.small, marginBottom: Spacing.md },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginBottom: Spacing.md },
  chip: { minHeight: 44, justifyContent: 'center', paddingHorizontal: Spacing.md, borderRadius: BorderRadius.lg, borderWidth: 1 },
  blockCard: { borderWidth: 1, borderRadius: BorderRadius.lg, padding: Spacing.md, marginBottom: Spacing.md },
  blockHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.sm },
  blockTitle: { fontSize: FontSize.heading, fontWeight: '600' },
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