import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, useColorScheme } from 'react-native';
import { Card } from './Card';
import { FeeQuote } from '../lib/checkout';
import { supabase } from '../lib/supabase';
import { formatRupees } from '../lib/money';
import Colors from '../constants/Colors';
import { Spacing, FontSize } from '../constants/Spacing';

type Policy = { cutoff_hours: number; deduction_percent: number };

export function FeePanel({ quote, count = 1, sessionId }: { quote: FeeQuote; count?: number; sessionId?: string }) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme as 'light' | 'dark'];
  const [policy, setPolicy] = useState<Policy | null>(null);

  const consult = quote.consultation_paise * count;
  const platform = quote.platform_paise * count;
  const total = quote.total_paise * count;
  const online = quote.online_paise * count;
  const clinic = quote.clinic_paise * count;

  useEffect(() => {
    if (!sessionId || online <= 0) return;
    supabase.rpc('get_session_refund_policy', { p_session_id: sessionId }).then(({ data }) => {
      const row = Array.isArray(data) ? data[0] : data;
      if (row) setPolicy(row as Policy);
    });
  }, [sessionId, online]);

  if (total === 0) {
    return (
      <Card>
        <Text style={[styles.title, { color: colors.success }]}>Free consultation</Text>
        <Text style={[styles.muted, { color: colors.textMuted }]}>Nothing to pay.</Text>
      </Card>
    );
  }

  const row = (label: string, value: string, bold = false, color?: string) => (
    <View style={styles.row}>
      <Text style={[styles.label, { color: color ?? colors.text, fontWeight: bold ? '700' : '400' }]}>{label}</Text>
      <Text style={[styles.label, { color: color ?? colors.text, fontWeight: bold ? '700' : '400' }]}>{value}</Text>
    </View>
  );

  let refundNote = '';
  if (policy && online > 0) {
    const when =
      policy.cutoff_hours === 0
        ? 'before the session starts'
        : `at least ${policy.cutoff_hours} hour${policy.cutoff_hours === 1 ? '' : 's'} before the session`;
    refundNote =
      policy.deduction_percent > 0
        ? `Cancel ${when} for a refund, with ${policy.deduction_percent}% deducted. Later cancellations are not refunded.`
        : `Cancel ${when} for a full refund. Later cancellations are not refunded.`;
  }

  return (
    <Card>
      {row('Doctor consultation fee', formatRupees(consult))}
      {row('Platform fee', formatRupees(platform))}
      <View style={[styles.line, { backgroundColor: colors.border }]} />
      {row('Total', formatRupees(total), true)}
      <View style={{ height: Spacing.sm }} />
      {online > 0 ? row('Pay now (online)', formatRupees(online), true, colors.primary) : null}
      {clinic > 0 ? row('Pay at Clinic', formatRupees(clinic), true) : null}
      <Text style={[styles.muted, { color: colors.textMuted }]}>
        The price is locked when you book. It will not change later.
      </Text>
      {refundNote ? <Text style={[styles.muted, { color: colors.textMuted }]}>{refundNote}</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: FontSize.heading, fontWeight: '600' },
  muted: { fontSize: FontSize.small, marginTop: Spacing.xs },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginTop: Spacing.xs },
  label: { fontSize: FontSize.body },
  line: { height: 1, marginVertical: Spacing.sm },
});     