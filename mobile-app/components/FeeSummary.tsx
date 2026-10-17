import { View, Text, StyleSheet, useColorScheme } from 'react-native';
import { Card } from './Card';
import { formatRupees } from '../lib/money';
import Colors from '../constants/Colors';
import { Spacing, FontSize } from '../constants/Spacing';

type FeeSummaryProps = {
  consultationPaise: number;
  platformPaise: number;
  totalPaise: number;
};

export function FeeSummary({ consultationPaise, platformPaise, totalPaise }: FeeSummaryProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme as 'light' | 'dark'];

  if (totalPaise === 0) {
    return (
      <Card>
        <Text style={[styles.free, { color: colors.success }]}>Free consultation</Text>
      </Card>
    );
  }

  return (
    <Card>
      <View style={styles.row}>
        <Text style={[styles.label, { color: colors.text }]}>Consultation fee</Text>
        <Text style={[styles.value, { color: colors.text }]}>{formatRupees(consultationPaise)}</Text>
      </View>
      {platformPaise > 0 ? (
        <View style={styles.row}>
          <Text style={[styles.label, { color: colors.text }]}>Platform fee</Text>
          <Text style={[styles.value, { color: colors.text }]}>{formatRupees(platformPaise)}</Text>
        </View>
      ) : null}
      <View style={[styles.divider, { backgroundColor: colors.border }]} />
      <View style={styles.row}>
        <Text style={[styles.total, { color: colors.text }]}>Total</Text>
        <Text style={[styles.total, { color: colors.primary }]}>{formatRupees(totalPaise)}</Text>
      </View>
      <Text style={[styles.caption, { color: colors.textMuted }]}>Pay at Clinic</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: Spacing.xs },
  label: { fontSize: FontSize.body },
  value: { fontSize: FontSize.body, fontWeight: '600' },
  divider: { height: 1, marginVertical: Spacing.xs },
  total: { fontSize: FontSize.large, fontWeight: 'bold' },
  caption: { fontSize: FontSize.small, marginTop: Spacing.xs },
  free: { fontSize: FontSize.large, fontWeight: '600' },
});    