import { ReactNode } from 'react';
import { View, Text, StyleSheet, useColorScheme } from 'react-native';
import Colors from '../constants/Colors';
import { Spacing, FontSize, BorderRadius } from '../constants/Spacing';

function useColors() {
  const scheme = useColorScheme() ?? 'light';
  return Colors[scheme as 'light' | 'dark'];
}

export function shortDate(value: string) {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export function pretty(value: string) {
  return value.replace(/_/g, ' ').toLowerCase();
}

export function StatBox({ label, value }: { label: string; value: string | number }) {
  const colors = useColors();
  return (
    <View style={[styles.statBox, { backgroundColor: colors.cardBackground, borderColor: colors.border }]}>
      <Text style={[styles.statValue, { color: colors.primary }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: colors.textMuted }]}>{label}</Text>
    </View>
  );
}

export function Panel({ title, children }: { title: string; children: ReactNode }) {
  const colors = useColors();
  return (
    <View style={[styles.panel, { backgroundColor: colors.cardBackground, borderColor: colors.border }]}>
      <Text style={[styles.panelTitle, { color: colors.text }]}>{title}</Text>
      {children}
    </View>
  );
}

export function Row({ label, value }: { label: string; value: string | number }) {
  const colors = useColors();
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, { color: colors.text }]}>{label}</Text>
      <Text style={[styles.rowValue, { color: colors.text }]}>{value}</Text>
    </View>
  );
}

export function CountRows({ data }: { data: Record<string, number> }) {
  const colors = useColors();
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) {
    return <Text style={{ color: colors.textMuted, fontSize: FontSize.body }}>No data yet</Text>;
  }
  return (
    <>
      {entries.map(([key, count]) => (
        <Row key={key} label={pretty(key)} value={count} />
      ))}
    </>
  );
}

export function BarChart({ data }: { data: { date: string; count: number }[] }) {
  const colors = useColors();
  if (data.length === 0) return null;
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <View>
      <View style={[styles.bars, { gap: data.length > 31 ? 1 : 3 }]}>
        {data.map((d) => (
          <View
            key={d.date}
            style={{
              flex: 1,
              height: Math.max(3, (d.count / max) * 100),
              borderRadius: 2,
              backgroundColor: d.count > 0 ? colors.primary : colors.border,
            }}
          />
        ))}
      </View>
      <View style={styles.axis}>
        <Text style={{ color: colors.textMuted, fontSize: FontSize.small }}>{shortDate(data[0].date)}</Text>
        <Text style={{ color: colors.textMuted, fontSize: FontSize.small }}>Peak: {max} / day</Text>
        <Text style={{ color: colors.textMuted, fontSize: FontSize.small }}>
          {shortDate(data[data.length - 1].date)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  statBox: {
    flex: 1,
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    alignItems: 'center',
  },
  statValue: { fontSize: FontSize.title, fontWeight: 'bold' },
  statLabel: { fontSize: FontSize.small, marginTop: Spacing.xs },
  panel: {
    borderWidth: 1,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  panelTitle: { fontSize: FontSize.large, fontWeight: '600', marginBottom: Spacing.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: Spacing.xs },
  rowLabel: { fontSize: FontSize.body, textTransform: 'capitalize' },
  rowValue: { fontSize: FontSize.body, fontWeight: '600' },
  bars: { flexDirection: 'row', alignItems: 'flex-end', height: 100 },
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: Spacing.xs },
});    