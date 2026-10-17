import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, ScrollView, Pressable, useColorScheme, Alert } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Card } from './Card';
import { Button } from './Button';
import { LoadingView, ErrorView, EmptyView } from './StateViews';
import { supabase } from '../lib/supabase';
import Colors from '../constants/Colors';
import { Spacing, FontSize, BorderRadius } from '../constants/Spacing';
import { formatRupees } from '../lib/money';

type LogRow = {
  log_id: string;
  logged_at: string;
  log_action: string;
  log_entity_type: string;
  log_entity_id: string | null;
  log_metadata: Record<string, any> | null;
  actor_name: string | null;
  actor_role: string | null;
};

const PAGE = 30;

const FILTERS: { label: string; value: string | null }[] = [
  { label: 'All', value: null },
  { label: 'Doctors', value: 'doctor' },
  { label: 'Users', value: 'profile' },
  { label: 'Bookings', value: 'booking' },
  { label: 'Sessions', value: 'session' },
  { label: 'Staff', value: 'clinic_staff' },
  { label: 'Clinics', value: 'clinic' },
  { label: 'Settings', value: 'platform_settings' },
];

function nice(value: unknown) {
  return typeof value === 'string' ? value.replace(/_/g, ' ').toLowerCase() : String(value ?? '');
}

function describe(row: LogRow): string {
  const m = row.log_metadata ?? {};
  switch (row.log_action) {
    case 'DOCTOR_VERIFICATION_CHANGED':
      return `Doctor ${m.doctor_name ?? ''}: ${nice(m.from)} to ${nice(m.to)}`;
    case 'ROLE_CHANGED':
      return `User role changed: ${nice(m.from)} to ${nice(m.to)}`;
    case 'ACCOUNT_ACTIVE_CHANGED':
      return m.to ? 'Account activated' : 'Account deactivated';
    case 'BOOKING_STATUS_CHANGED':
      return `${m.booking_mode === 'TOKEN' ? `Token #${m.token_number ?? ''}` : 'Appointment'} booking: ${nice(m.from)} to ${nice(m.to)}`;
    case 'SESSION_CREATED':
      return `Session created for ${m.session_date ?? ''} (${nice(m.booking_mode)}, capacity ${m.capacity ?? '?'})`;
    case 'SESSION_STATUS_CHANGED':
      return `Session ${nice(m.from)} to ${nice(m.to)}`;
    case 'STAFF_ADDED':
      return 'Staff member added to a clinic';
    case 'STAFF_STATUS_CHANGED':
      return m.to ? 'Staff member reactivated' : 'Staff member deactivated';
    case 'CLINIC_CREATED':
      return `Clinic created: ${m.name ?? ''}${m.city ? `, ${m.city}` : ''}`;
    case 'DOCTOR_FEE_CHANGED':
      return `Doctor ${m.doctor_name ?? ''} fee: ${formatRupees(m.from_paise ?? 0)} to ${formatRupees(m.to_paise ?? 0)}`;
    case 'PLATFORM_FEE_CHANGED': {
      const to = m.to ?? {};
      return `Platform fee set to ${to.percent ?? 0}% (min ${formatRupees(to.min_paise ?? 0)}, max ${formatRupees(to.max_paise ?? 0)})`;
    }  
    default:
      return nice(row.log_action);     
  }
}

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

export default function AdminAuditLog() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme as 'light' | 'dark'];

  const [filter, setFilter] = useState<string | null>(null);
  const [rows, setRows] = useState<LogRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPage = useCallback(
    (before: string | null) =>
      supabase.rpc('admin_get_audit_logs', {
        p_limit: PAGE,
        p_before: before,
        p_entity_type: filter,
      }),
    [filter]
  );

  const loadFirst = useCallback(async () => {
    setError(null);
    const { data, error: rpcError } = await fetchPage(null);
    if (rpcError) {
      console.log('Audit log error:', rpcError.message);
      setError('Could not load the audit log.');
    } else {
      const list = (data as LogRow[]) ?? [];
      setRows(list);
      setHasMore(list.length === PAGE);
    }
    setLoading(false);
    setRefreshing(false);
  }, [fetchPage]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      loadFirst();
    }, [loadFirst])
  );

  async function loadMore() {
    if (loadingMore || !hasMore || rows.length === 0) return;
    setLoadingMore(true);
    // Pass the timestamp back exactly as received (keeps microseconds, so no rows are skipped).
    const { data, error: rpcError } = await fetchPage(rows[rows.length - 1].logged_at);
    setLoadingMore(false);

    if (rpcError) {
      Alert.alert('Could not load more', rpcError.message);
      return;
    }
    const list = (data as LogRow[]) ?? [];
    setRows((prev) => [...prev, ...list]);
    setHasMore(list.length === PAGE);
  }

  return (
    <View style={styles.container}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
        {FILTERS.map((f) => {
          const active = filter === f.value;
          return (
            <Pressable
              key={f.label}
              onPress={() => setFilter(f.value)}
              style={[
                styles.chip,
                { backgroundColor: active ? colors.primary : colors.cardBackground, borderColor: colors.border },
              ]}
            >
              <Text style={{ color: active ? '#FFFFFF' : colors.text }}>{f.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {error ? (
        <ErrorView
          message={error}
          onRetry={() => {
            setLoading(true);
            loadFirst();
          }}
        />
      ) : loading ? (
        <LoadingView message="Loading audit log..." />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.log_id}
          contentContainerStyle={styles.list}
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            loadFirst();
          }}
          ListEmptyComponent={
            <EmptyView title="No activity yet" message="Important actions will be recorded here." />
          }
          ListFooterComponent={
            hasMore ? (
              <Button title="Load more" onPress={loadMore} variant="secondary" loading={loadingMore} />
            ) : null
          }
          renderItem={({ item }) => (
            <Card>
              <Text style={[styles.what, { color: colors.text }]}>{describe(item)}</Text>
              <Text style={[styles.who, { color: colors.textMuted }]}>
                {item.actor_name
                  ? `By ${item.actor_name} (${(item.actor_role ?? '').toLowerCase()})`
                  : 'By system (automatic or SQL editor)'}
              </Text>
              <Text style={[styles.when, { color: colors.textMuted }]}>{formatWhen(item.logged_at)}</Text>
            </Card>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  chipRow: { flexGrow: 0, paddingHorizontal: Spacing.lg, marginBottom: Spacing.md },
  chip: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    marginRight: Spacing.sm,
  },
  list: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.xxl },
  what: { fontSize: FontSize.body, fontWeight: '600' },
  who: { fontSize: FontSize.small, marginTop: Spacing.xs },
  when: { fontSize: FontSize.small, marginTop: Spacing.xs },
});   