import { View, Text, StyleSheet, useColorScheme } from 'react-native';
import { Card } from './Card';
import { FeeQuote } from '../lib/checkout';
import { formatRupees } from '../lib/money';
import Colors from '../constants/Colors';
import { Spacing, FontSize } from '../constants/Spacing';

export function FeePanel({ quote, count = 1 }: { quote: FeeQuote; count?: number }) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme as 'light' | 'dark'];

  const consult = quote.consultation_paise * count;
  const platform = quote.platform_paise * count;
  const total = quote.total_paise * count;
  const online = quote.online_paise * count;
  const clinic = quote.clinic_paise * count;

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