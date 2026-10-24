import { useEffect, useState } from 'react';
import { Text, StyleSheet, ScrollView, useColorScheme, Alert, View } from 'react-native';
import { Stack, router } from 'expo-router';
import { TextField } from '../../components/TextField';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { LoadingView, ErrorView } from '../../components/StateViews';
import { supabase } from '../../lib/supabase';
import { formatRupees } from '../../lib/money';
import Colors from '../../constants/Colors';
import { Spacing, FontSize } from '../../constants/Spacing';

export default function RefundPolicyScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme as 'light' | 'dark'];

  const [cutoff, setCutoff] = useState('2');
  const [percent, setPercent] = useState('0');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('get_my_refund_policy');
    const row = Array.isArray(data) ? data[0] : data;
    if (rpcError || !row) {
      setError('Could not load your refund policy.');
    } else {
      setCutoff(String(row.cutoff_hours));
      setPercent(String(row.deduction_percent));
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const cutoffN = parseInt(cutoff, 10);
  const percentN = parseInt(percent, 10);
  const valid = cutoffN >= 0 && cutoffN <= 168 && percentN >= 0 && percentN <= 100;
  const exampleDeduction = valid ? Math.floor((32000 * percentN) / 100) : 0;

  async function handleSave() {
    if (!valid) {
      Alert.alert('Check the values', 'The window must be 0 to 168 hours and the deduction 0 to 100 percent.');
      return;
    }
    setSaving(true);
    const { error: saveError } = await supabase.rpc('set_my_refund_policy', {
      p_cutoff_hours: cutoffN,
      p_deduction_percent: percentN,
    });
    setSaving(false);
    if (saveError) {
      Alert.alert('Could not save', saveError.message);
      return;
    }
    Alert.alert('Saved', 'Your cancellation policy has been updated. It applies to all new cancellations.', [
      { text: 'OK', onPress: () => router.back() },
    ]);
  }

  if (loading) return <LoadingView message="Loading..." />;
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
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen options={{ title: 'Cancellation Policy' }} />
      <Text style={[styles.help, { color: colors.textMuted }]}>
        This applies only to patients who paid online and then cancel by themselves. If you close or cancel a session,
        patients are always refunded in full.
      </Text>

      <TextField
        label="Refund window (hours before the session)"
        keyboardType="number-pad"
        value={cutoff}
        onChangeText={(v) => setCutoff(v.replace(/\D/g, ''))}
      />
      <TextField
        label="Deduction from the refund (%)"
        keyboardType="number-pad"
        value={percent}
        onChangeText={(v) => setPercent(v.replace(/\D/g, ''))}
      />

      <Card>
        <Text style={[styles.cardTitle, { color: colors.text }]}>What patients will see</Text>
        {valid ? (
          <>
            <Text style={[styles.help, { color: colors.text }]}>
              Cancel {cutoffN === 0 ? 'before the session starts' : `at least ${cutoffN} hour(s) before the session`} and
              get a refund{percentN > 0 ? `, with ${percentN}% deducted` : ' in full'}. Later cancellations are not refunded.
            </Text>
            <Text style={[styles.help, { color: colors.textMuted }]}>
              Example: a patient who paid {formatRupees(32000)} and cancels in time gets back{' '}
              {formatRupees(32000 - exampleDeduction)}.
            </Text>
          </>
        ) : (
          <Text style={[styles.help, { color: colors.warning }]}>Enter valid numbers to see the preview.</Text>
        )}
      </Card>

      <View style={{ marginTop: Spacing.lg }}>
        <Button title="Save policy" onPress={handleSave} variant="primary" loading={saving} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
  help: { fontSize: FontSize.body, marginBottom: Spacing.md },
  cardTitle: { fontSize: FontSize.heading, fontWeight: '600', marginBottom: Spacing.xs },
});    