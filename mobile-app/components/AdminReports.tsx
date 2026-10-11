import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, useColorScheme, RefreshControl } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { LoadingView, ErrorView } from './StateViews';
import { StatBox, Panel, Row, CountRows, BarChart } from './ReportParts';
import { supabase } from '../lib/supabase';
import Colors from '../constants/Colors';
import { Spacing, FontSize, BorderRadius } from '../constants/Spacing';

type Report = {
  days: number;
  since: string;
  users_by_role: Record<string, number>;
  doctors_by_status: Record<string, number>;
  active_clinics: number;
  new_patients: number;
  sessions_in_period: number;
  bookings_total: number;
  bookings_by_status: Record<string, number>;
  bookings_by_mode: Record<string, number>;
  bookings_per_day: { date: string; count: number }[];
  top_doctors: { name: string; clinic: string; count: number }[];
};

const PERIODS = [7, 30, 90];

export default function AdminReports() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme as 'light' | 'dark'];

  const [days, setDays] = useState(7);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('admin_report', { p_days: days });
    if (rpcError || !data) {
      console.log('Report error:', rpcError?.message);
      setError('Could not load the report.');
    } else {
      setReport(data as unknown as Report);
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

  const total = report?.bookings_total ?? 0;
  const cancelled = report?.bookings_by_status.CANCELLED ?? 0;
  const completed = report?.bookings_by_status.COMPLETED ?? 0;
  const cancelRate = total > 0 ? Math.round((cancelled / total) * 100) : 0;

  return (
    <View style={styles.container}>
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
              <Text style={{ color: active ? '#FFFFFF' : colors.text, fontWeight: '600' }}>{p} days</Text>
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
        <LoadingView message="Loading report..." />
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
            Bookings are counted by the day they were made. Each token or appointment is one booking.
          </Text>

          <View style={styles.statRow}>
            <StatBox label="Bookings" value={total} />
            <StatBox label="Completed" value={completed} />
            <StatBox label="Cancelled" value={`${cancelRate}%`} />
          </View>

          <Panel title="Bookings per day">
            <BarChart data={report.bookings_per_day} />
          </Panel>

          <Panel title="By status">
            <CountRows data={report.bookings_by_status} />
          </Panel>

          <Panel title="By type">
            <CountRows data={report.bookings_by_mode} />
          </Panel>

          <Panel title="Activity in this period">
            <Row label="New patients" value={report.new_patients} />
            <Row label="Sessions held or scheduled" value={report.sessions_in_period} />
            <Row label="Active clinics (total)" value={report.active_clinics} />
          </Panel>

          <Panel title="Accounts (all time)">
            <CountRows data={report.users_by_role} />
          </Panel>

          <Panel title="Doctors by verification">
            <CountRows data={report.doctors_by_status} />
          </Panel>

          <Panel title="Top doctors by bookings">
            {report.top_doctors.length === 0 ? (
              <Text style={{ color: colors.textMuted, fontSize: FontSize.body }}>No bookings in this period</Text>
            ) : (
              report.top_doctors.map((d, i) => (
                <View key={`${d.name}-${i}`} style={styles.topRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.rowLabel, { color: colors.text }]}>
                      {i + 1}. {d.name}
                    </Text>
                    <Text style={{ color: colors.textMuted, fontSize: FontSize.small }}>{d.clinic}</Text>
                  </View>
                  <Text style={[styles.rowValue, { color: colors.text }]}>{d.count}</Text>
                </View>
              ))
            )}
          </Panel>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
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
  statRow: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.md },
  rowLabel: { fontSize: FontSize.body, textTransform: 'capitalize' },
  rowValue: { fontSize: FontSize.body, fontWeight: '600' },
  topRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: Spacing.xs },
});   