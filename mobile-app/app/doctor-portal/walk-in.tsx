import { useEffect, useState } from 'react';
import { Text, StyleSheet, ScrollView, useColorScheme, Alert, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { TextField } from '../../components/TextField';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { LoadingView, ErrorView } from '../../components/StateViews';
import { supabase } from '../../lib/supabase';
import { formatRupees } from '../../lib/money';
import Colors from '../../constants/Colors';
import { Spacing, FontSize } from '../../constants/Spacing';

export default function WalkInScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme as 'light' | 'dark'];
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();

  const [fee, setFee] = useState(0);
  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [nameError, setNameError] = useState<string | undefined>();
  const [ageError, setAgeError] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('get_walk_in_fee', { p_session_id: sessionId });
    if (rpcError) setError(rpcError.message);
    else setFee(Number(data ?? 0));
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  function reset() {
    setName('');
    setAge('');
    setNameError(undefined);
    setAgeError(undefined);
  }

  async function handleAdd() {
    const trimmed = name.trim();
    const ageN = parseInt(age, 10);
    let bad = false;
    if (trimmed.length < 2) {
      setNameError('Enter the patient\u2019s name.');
      bad = true;
    } else setNameError(undefined);
    if (!/^\d{1,3}$/.test(age) || ageN > 120) {
      setAgeError('Enter an age from 0 to 120.');
      bad = true;
    } else setAgeError(undefined);
    if (bad) return;

    setSaving(true);
    const { data, error: addError } = await supabase.rpc('add_walk_in', {
      p_session_id: sessionId,
      p_name: trimmed,
      p_age: ageN,
    });
    setSaving(false);

    if (addError) {
      Alert.alert('Could not add', addError.message);
      return;
    }

    const r = (Array.isArray(data) ? data[0] : data) as {
      out_token: number;
      out_reference: string;
      out_fee_paise: number;
    };
    Alert.alert(
      `Token #${r.out_token}`,
      `${trimmed} is in the queue.\nReference: ${r.out_reference}` +
        (r.out_fee_paise > 0 ? `\nFee collected: ${formatRupees(r.out_fee_paise)}` : ''),
      [
        { text: 'Add another', onPress: reset },
        { text: 'Done', onPress: () => router.back() },
      ]
    );
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
      <Stack.Screen options={{ title: 'Add Walk-in' }} />

      <Card>
        <Text style={[styles.cardTitle, { color: colors.text }]}>
          {fee > 0 ? `Collect ${formatRupees(fee)} at the counter` : 'Free consultation'}
        </Text>
        <Text style={[styles.help, { color: colors.textMuted }]}>
          Consultation fee only. There is no platform fee for walk-ins. The patient gets the next free token in the queue.
        </Text>
      </Card>

      <View style={{ height: Spacing.md }} />
      <TextField label="Patient name" value={name} onChangeText={setName} error={nameError} maxLength={60} />
      <TextField
        label="Age"
        keyboardType="number-pad"
        maxLength={3}
        value={age}
        onChangeText={(v) => setAge(v.replace(/\D/g, ''))}
        error={ageError}
      />

      <View style={{ marginTop: Spacing.md }}>
        <Button
          title={fee > 0 ? 'Fee collected - Add to queue' : 'Add to queue'}
          onPress={handleAdd}
          variant="primary"
          loading={saving}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
  cardTitle: { fontSize: FontSize.heading, fontWeight: '600' },
  help: { fontSize: FontSize.small, marginTop: Spacing.xs },
});    