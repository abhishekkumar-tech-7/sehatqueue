import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, useColorScheme, RefreshControl } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { LoadingView, ErrorView } from '../../components/StateViews';
import { StatBox, Panel, Row, CountRows, BarChart, shortDate } from '../../components/ReportParts';
import { supabase } from '../../lib/supabase';
import Colors from '../../constants/Colors';
import { Spacing, FontSize, BorderRadius } from '../../constants/Spacing';

type DoctorReportData = {
  days: number;
  since: string;
  total: number;
  by_status: Record<string, number>;
  by_mode: Record<string, number>;
  per_day: { date: string; count: number }[];
  patients: { unique: number; seen: number; new: number; returning: number };
  age_groups: Record<string, number>;
};

const PERIODS = [1, 7, 30];

const AGE_ROWS: { key: string; label: string }[] = [
  { key: '0-17', label: 'Under 18' },
  { key: '18-39', label: '18 to 39' },
  { key: '40-59', label: '40 to 59' },
  { key: '60+', label: '60 and above' },
  { key: 'unknown', label: 'Age not given' },
];

export default function ReportScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme as 'light' | 'dark'];

  const [days, setDays] = useState(7);
  const [report, setReport] = useState<DoctorReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('doctor_report', { p_days: days });
    if (rpcError || !data) {
      console.log('Doctor report error:', rpcError?.message);
      setError('Could not load your report. Please check your internet connection.');
    } else {
      setReport(data as unknown as DoctorReportData);
    }
    setLoading(false);
    setRefreshing(false);
  }, [days]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load();
    }, [load])
  );

  const total = report?.total ?? 0;
  const completed = report?.by_status.COMPLETED ?? 0;
  const cancelled = report?.by_status.CANCELLED ?? 0;
  const cancelRate = total > 0 ? Math.round((cancelled / total) * 100) : 0;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.periodRow}>
        {PERIODS.map((p) => {
          const active = days === p;
          return (
            <Pressable
              key={p}
              onPress={() => setDays(p)}
              style={[
                styles.periodChip,
                { backgroundColor: active ? colors.primary : colors.cardBackground, borderColor: colors.border },
              ]}
            >
              <Text style={{ color: active ? '#FFFFFF' : colors.text, fontWeight: '600' }}>
                {p === 1 ? '1 day' : `${p} days`}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {error ? (
        <ErrorView
          message={error}
          onRetry={() => {
            setLoading(true);
            load();
          }}
        />
      ) : !report ? (
        <LoadingView message="Loading your report..." />
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, { opacity: loading ? 0.5 : 1 }]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                load();
              }}
              tintColor={colors.primary}
            />
          }
        >
          <Text style={[styles.note, { color: colors.textMuted }]}>
            {report.days === 1
              ? "Showing today's sessions."
              : `Showing sessions from ${shortDate(report.since)} to today.`}{' '}
            Total includes cancelled bookings.
          </Text>

          <View style={styles.statRow}>
            <StatBox label="Total" value={total} />
            <StatBox label="Completed" value={completed} />
            <StatBox label="Cancelled" value={cancelled} />
          </View>
          <Text style={[styles.rate, { color: colors.textMuted }]}>Cancellation rate: {cancelRate}%</Text>

          {total === 0 ? (
            <Panel title="No bookings">
              <Text style={{ color: colors.textMuted, fontSize: FontSize.body }}>
                There are no bookings for your sessions in this period.
              </Text>
            </Panel>
          ) : (
            <>
              {report.days > 1 && (
                <Panel title="Bookings per day">
                  <BarChart data={report.per_day} />
                </Panel>
              )}

              <Panel title="By status">
                <CountRows data={report.by_status} />
              </Panel>

              <Panel title="By type">
                <CountRows data={report.by_mode} />
              </Panel>

              <Panel title="Patients">
                <Row label="Unique patients" value={report.patients.unique} />
                <Row label="Patients seen (completed)" value={report.patients.seen} />
                <Row label="New patients" value={report.patients.new} />
                <Row label="Returning patients" value={report.patients.returning} />
              </Panel>

              <Panel title="Patient age (by booking)">
                {AGE_ROWS.map((a) => (
                  <Row key={a.key} label={a.label} value={report.age_groups[a.key] ?? 0} />
                ))}
              </Panel>
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: Spacing.lg },
  periodRow: { flexDirection: 'row', gap: Spacing.sm, paddingHorizontal: Spacing.lg, marginBottom: Spacing.md },
  periodChip: {
    flex: 1,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: BorderRadius.md,
    borderWidth: 1,
  },
  content: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.xxl },
  note: { fontSize: FontSize.small, marginBottom: Spacing.md },
  statRow: { flexDirection: 'row', gap: Spacing.sm },
  rate: { fontSize: FontSize.small, marginTop: Spacing.sm, marginBottom: Spacing.md },
});  