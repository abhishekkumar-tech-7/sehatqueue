import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, useColorScheme, Alert } from 'react-native';
import { Card } from './Card';
import { Button } from './Button';
import { TextField } from './TextField';
import { LoadingView, ErrorView } from './StateViews';
import { supabase } from '../lib/supabase';
import Colors from '../constants/Colors';
import { Spacing, FontSize } from '../constants/Spacing';

type Settings = { fee_percent: number | string; fee_min_paise: number; fee_max_paise: number };

export default function AdminFees() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme as 'light' | 'dark'];

  const [percent, setPercent] = useState('');
  const [minRupees, setMinRupees] = useState('');
  const [maxRupees, setMaxRupees] = useState('');
  const [errors, setErrors] = useState<{ [key: string]: string }>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    const { data, error } = await supabase.rpc('admin_get_platform_settings');
    const row = (Array.isArray(data) ? data[0] : data) as Settings | undefined;

    if (error || !row) {
      console.log('Platform settings error:', error?.message);
      setLoadError('Could not load the platform fee settings.');
    } else {
      setPercent(String(Number(row.fee_percent)));
      setMinRupees(String(row.fee_min_paise / 100));
      setMaxRupees(String(row.fee_max_paise / 100));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function validate() {
    const e: { [key: string]: string } = {};
    if (!/^\d{1,3}(\.\d{1,2})?$/.test(percent) || Number(percent) > 100) {
      e.percent = 'Enter a percentage from 0 to 100';
    }
    if (!/^\d{1,8}$/.test(minRupees)) e.min = 'Enter whole rupees (0 or more)';
    if (!/^\d{1,8}$/.test(maxRupees)) e.max = 'Enter whole rupees (0 or more)';
    if (!e.min && !e.max && Number(maxRupees) < Number(minRupees)) {
      e.max = 'The maximum cannot be less than the minimum';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSave() {
    if (!validate()) return;

    setSaving(true);
    const { error } = await supabase.rpc('admin_set_platform_settings', {
      p_percent: Number(percent),
      p_min_rupees: parseInt(minRupees, 10),
      p_max_rupees: parseInt(maxRupees, 10),
    });
    setSaving(false);

    if (error) {
      Alert.alert('Could not save', error.message);
      return;
    }
    Alert.alert('Saved', 'The platform fee has been updated. It applies to new bookings only.');
    load();
  }

  if (loading) return <LoadingView message="Loading fee settings..." />;
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

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <Card>
        <Text style={[styles.title, { color: colors.text }]}>How the platform fee works</Text>
        <Text style={[styles.body, { color: colors.textMuted }]}>
          The platform fee is a percentage of the doctor's consultation fee, but never less than the minimum
          or more than the maximum below. It is added on top of the doctor's fee. Free consultations have no
          platform fee. Set the maximum to 0 to turn the platform fee off.
        </Text>
      </Card>

      <TextField
        label="Platform fee (% of consultation fee)"
        keyboardType="decimal-pad"
        value={percent}
        onChangeText={setPercent}
        error={errors.percent}
      />
      <TextField
        label={'Minimum platform fee (\u20B9)'}
        keyboardType="number-pad"
        value={minRupees}
        onChangeText={(v) => setMinRupees(v.replace(/\D/g, ''))}
        error={errors.min}
      />
      <TextField
        label={'Maximum platform fee (\u20B9)'}
        keyboardType="number-pad"
        value={maxRupees}
        onChangeText={(v) => setMaxRupees(v.replace(/\D/g, ''))}
        error={errors.max}
      />

      <View style={styles.buttonGroup}>
        <Button title="Save Platform Fee" onPress={handleSave} variant="primary" loading={saving} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.xxl },
  title: { fontSize: FontSize.large, fontWeight: '600', marginBottom: Spacing.xs },
  body: { fontSize: FontSize.body },
  buttonGroup: { marginTop: Spacing.md },
});     