import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, useColorScheme, Alert } from 'react-native';
import { Card } from './Card';
import { Button } from './Button';
import { LoadingView, ErrorView } from './StateViews';
import { supabase } from '../lib/supabase';
import { formatRupees } from '../lib/money';
import Colors from '../constants/Colors';
import { Spacing, FontSize } from '../constants/Spacing';

type RefundRow = {
  refund_id: string;
  booking_reference: string | null;
  amount_paise: number;
  deduction_paise: number;
  reason: string;
  status: string;
  failure_reason: string | null;
  attempts: number;
  created_at: string;
};

const REASON: Record<string, string> = {
  PATIENT_CANCEL: 'Patient cancelled',
  CLINIC_CANCEL: 'Clinic closed session',
  PAYMENT_UNCONFIRMED: 'Paid but not confirmed',
  ADMIN: 'Admin',
};

export default function AdminRefunds() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme as 'light' | 'dark'];
  const [rows, setRows] = useState<RefundRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('admin_list_refunds');
    if (rpcError) setError('Could not load refunds. ' + rpcError.message);
    else setRows((data ?? []) as RefundRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function processNow() {
    setBusy(true);
    const { error: fnError } = await supabase.functions.invoke('process-refunds');
    setBusy(false);
    if (fnError) Alert.alert('Could not process', 'The refund service did not respond. Try again.');
    load();
  }

  async function retry(id: string) {
    const { error: retryError } = await supabase.rpc('admin_retry_refund', { p_refund_id: id });
    if (retryError) {
      Alert.alert('Could not retry', retryError.message);
      return;
    }
    processNow();
  }

  if (loading) return <LoadingView message="Loading refunds..." />;
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

  const color = (s: string) =>
    s === 'SUCCESS' ? colors.success : s === 'FAILED' ? colors.error : colors.warning;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Button title="Process refunds now" onPress={processNow} variant="primary" loading={busy} />
      <Text style={[styles.help, { color: colors.textMuted }]}>
        Refunds are sent automatically. Use this button to check on refunds that are still processing.
      </Text>

      {rows.length === 0 ? (
        <Text style={[styles.help, { color: colors.textMuted }]}>No refunds yet.</Text>
      ) : (
        rows.map((r) => (
          <Card key={r.refund_id}>
            <Text style={[styles.title, { color: colors.text }]}>
              {formatRupees(r.amount_paise)} - {r.booking_reference ?? 'whole order'}
            </Text>
            <Text style={[styles.help, { color: colors.textMuted }]}>
              {REASON[r.reason] ?? r.reason}
              {r.deduction_paise > 0 ? ` (${formatRupees(r.deduction_paise)} deducted)` : ''}
            </Text>
            <Text style={[styles.status, { color: color(r.status) }]}>{r.status}</Text>
            {r.failure_reason ? <Text style={[styles.help, { color: colors.error }]}>{r.failure_reason}</Text> : null}
            <Text style={[styles.help, { color: colors.textMuted }]}>
              {new Date(r.created_at).toLocaleString('en-IN')}
            </Text>
            {r.status === 'FAILED' ? (
              <View style={{ marginTop: Spacing.sm }}>
                <Button title="Retry" onPress={() => retry(r.refund_id)} variant="secondary" />
              </View>
            ) : null}
          </Card>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
  title: { fontSize: FontSize.heading, fontWeight: '600' },
  help: { fontSize: FontSize.small, marginTop: Spacing.xs, marginBottom: Spacing.xs },
  status: { fontSize: FontSize.body, fontWeight: '700', marginTop: Spacing.xs },
});    