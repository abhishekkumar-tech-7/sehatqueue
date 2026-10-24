import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, useColorScheme, Alert } from 'react-native';
import { Stack } from 'expo-router';
import { TextField } from '../../components/TextField';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { LoadingView, ErrorView } from '../../components/StateViews';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/AuthContext';
import { formatRupees } from '../../lib/money';
import Colors from '../../constants/Colors';
import { Spacing, FontSize, BorderRadius } from '../../constants/Spacing';

export default function SetFeeScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme as 'light' | 'dark'];
  const { profile } = useAuth();

  const [doctorId, setDoctorId] = useState<string | null>(null);
  const [isFree, setIsFree] = useState(true);
  const [amount, setAmount] = useState('');
  const [amountError, setAmountError] = useState<string | undefined>();
  const [currentPaise, setCurrentPaise] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!profile) return;
    setLoadError(null);

    const { data, error } = await supabase
      .from('doctors')
      .select('id, consultation_fee_paise')
      .eq('profile_id', profile.id)
      .single();

    if (error || !data) {
      setLoadError('Could not load your fee. Please check your internet connection.');
      setLoading(false);
      return;
    }

    setDoctorId(data.id);
    setIsFree(data.consultation_fee_paise === 0);
    setAmount(data.consultation_fee_paise > 0 ? String(data.consultation_fee_paise / 100) : '');
    setCurrentPaise(data.consultation_fee_paise);
    setLoading(false);
  }, [profile]);

  useEffect(() => {
    load();
  }, [load]);

  async function save(rupees: number) {
    setSaving(true);
    const { error } = await supabase.rpc('set_my_consultation_fee', { p_rupees: rupees });
    setSaving(false);

    if (error) {
      Alert.alert('Could not save', error.message);
      return;
    }

    await load();
    Alert.alert(
      'Saved',
      rupees === 0
        ? 'Your consultations are now free.'
        : `Your consultation fee is now ${formatRupees(rupees * 100)}.`
    );
  }

  function handleSave() {
    let rupees = 0;

    if (!isFree) {
      if (!/^\d{1,8}$/.test(amount) || parseInt(amount, 10) < 1) {
        setAmountError('Enter a fee of at least \u20B91, or choose Free.');
        return;
      }
      rupees = parseInt(amount, 10);
    }
    setAmountError(undefined);

    // A large fee is allowed, but we ask once in case of a typing mistake.
    if (rupees >= 10000) {
      Alert.alert('Please confirm', `You are setting a fee of ${formatRupees(rupees * 100)}. Is this correct?`, [
        { text: 'Change it', style: 'cancel' },
        { text: 'Yes, save', onPress: () => save(rupees) },
      ]);
      return;
    }

    save(rupees);
  }

  if (loading) return <LoadingView message="Loading your fee..." />;
  if (loadError || !doctorId) {
    return (
      <ErrorView
        message={loadError ?? 'Doctor profile not found.'}
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
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen options={{ title: 'Consultation Fee' }} />

      <Text style={[styles.note, { color: colors.textMuted }]}>
        Set the fee for one consultation, in whole rupees. Changes apply to new bookings only. Bookings
        already made keep the fee they were booked at.
      </Text>

      <View style={styles.chipRow}>
        {[
          { label: 'Free', value: true },
          { label: 'Paid', value: false },
        ].map((o) => {
          const active = isFree === o.value;
          return (
            <Pressable
              key={o.label}
              onPress={() => setIsFree(o.value)}
              style={[
                styles.chip,
                { backgroundColor: active ? colors.primary : colors.cardBackground, borderColor: colors.border },
              ]}
            >
              <Text style={{ color: active ? '#FFFFFF' : colors.text, fontWeight: '600' }}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {!isFree && (
        <TextField
          label={'Consultation fee (\u20B9)'}
          placeholder="e.g. 500"
          keyboardType="number-pad"
          maxLength={8}
          value={amount}
          onChangeText={(v) => setAmount(v.replace(/\D/g, ''))}
          error={amountError}
        />
      )}

      <View style={styles.buttonGroup}>
        <Button title="Save Fee" onPress={handleSave} variant="primary" loading={saving} />
      </View>

      <View style={styles.preview}>
        <Text style={[styles.previewTitle, { color: colors.text }]}>Your current fee</Text>
        <Card>
          {currentPaise > 0 ? (
            <Text style={[styles.current, { color: colors.primary }]}>
              Consultation fee - {formatRupees(currentPaise)}
            </Text>
          ) : (
            <Text style={[styles.current, { color: colors.success }]}>Free consultation</Text>
          )}
        </Card>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
  note: { fontSize: FontSize.small, marginBottom: Spacing.md },
  chipRow: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.md },
  chip: {
    flex: 1,
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: BorderRadius.md,
    borderWidth: 1,
  },
  buttonGroup: { marginTop: Spacing.md },
  preview: { marginTop: Spacing.xl },
  previewTitle: { fontSize: FontSize.large, fontWeight: '600', marginBottom: Spacing.sm },
  current: { fontSize: FontSize.large, fontWeight: '600' },
});    