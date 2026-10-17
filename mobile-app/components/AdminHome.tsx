import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, useColorScheme, Alert } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Card } from './Card';
import { Button } from './Button';
import { LoadingView, ErrorView, EmptyView } from './StateViews';
import AdminReports from './AdminReports';
import AdminAuditLog from './AdminAuditLog';
import AdminFees from './AdminFees';
import { supabase } from '../lib/supabase'; 
import { Profile } from '../lib/AuthContext';
import Colors from '../constants/Colors';
import { Spacing, FontSize, BorderRadius } from '../constants/Spacing';

type Section = 'approvals' | 'reports' | 'audit' | 'fees';

const SECTIONS: { key: Section; label: string }[] = [
  { key: 'approvals', label: 'Approvals' },
  { key: 'reports', label: 'Reports' },
  { key: 'audit', label: 'Audit' },
  { key: 'fees', label: 'Fees'},
];    

type PendingDoctor = {
  doctor_id: string;
  doctor_name: string;
  doctor_qualifications: string | null;
  doctor_bio: string | null;
  doctor_email: string | null;
  doctor_phone: string | null;
  registered_at: string;
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function ApprovalsSection() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme as 'light' | 'dark'];

  const [doctors, setDoctors] = useState<PendingDoctor[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actioningId, setActioningId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('admin_get_pending_doctors');

    if (rpcError) {
      console.log('Pending doctors error:', rpcError.message);
      setError('Could not load pending doctors.');
    } else {
      setDoctors((data as PendingDoctor[]) ?? []);
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load();
    }, [load])
  );

  async function handleDecision(doctorId: string, status: 'APPROVED' | 'REJECTED') {
    setActioningId(doctorId);
    const { error: updateError } = await supabase
      .from('doctors')
      .update({ verification_status: status })
      .eq('id', doctorId);
    setActioningId(null);

    if (updateError) {
      Alert.alert('Could not update', updateError.message);
      return;
    }
    load();
  }

  if (loading) return <LoadingView message="Loading pending doctors..." />;
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
    <FlatList
      data={doctors}
      keyExtractor={(item) => item.doctor_id}
      contentContainerStyle={styles.list}
      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true);
        load();
      }}
      ListEmptyComponent={
        <EmptyView title="Nothing pending" message="No doctor registrations are waiting for review." />
      }
      renderItem={({ item }) => (
        <Card>
          <Text style={[styles.name, { color: colors.text }]}>{item.doctor_name}</Text>
          {item.doctor_qualifications ? (
            <Text style={[styles.detail, { color: colors.textMuted }]}>{item.doctor_qualifications}</Text>
          ) : null}
          {item.doctor_email ? (
            <Text style={[styles.detail, { color: colors.text }]}>Email: {item.doctor_email}</Text>
          ) : null}
          {item.doctor_phone ? (
            <Text style={[styles.detail, { color: colors.text }]}>Phone: {item.doctor_phone}</Text>
          ) : null}
          {item.doctor_bio ? (
            <Text style={[styles.detail, { color: colors.text }]}>{item.doctor_bio}</Text>
          ) : null}
          <Text style={[styles.detail, { color: colors.textMuted }]}>
            Registered {formatDate(item.registered_at)}
          </Text>

          <View style={styles.actionRow}>
            <View style={styles.actionButton}>
              <Button
                title="Approve"
                onPress={() => handleDecision(item.doctor_id, 'APPROVED')}
                variant="primary"
                loading={actioningId === item.doctor_id}
                disabled={actioningId !== null}
              />
            </View>
            <View style={styles.actionButton}>
              <Button
                title="Reject"
                onPress={() => handleDecision(item.doctor_id, 'REJECTED')}
                variant="danger"
                loading={actioningId === item.doctor_id}
                disabled={actioningId !== null}
              />
            </View>
          </View>
        </Card>
      )}
    />
  );
}

export default function AdminHome({ profile }: { profile: Profile }) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme as 'light' | 'dark'];
  const [section, setSection] = useState<Section>('approvals');

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>Admin Dashboard</Text>
        <Text style={[styles.subtitle, { color: colors.textMuted }]}>{profile.full_name}</Text>

        <View style={styles.switchRow}>
          {SECTIONS.map((s) => {
            const active = section === s.key;
            return (
              <Pressable
                key={s.key}
                onPress={() => setSection(s.key)}
                style={[
                  styles.switchChip,
                  { backgroundColor: active ? colors.primary : colors.cardBackground, borderColor: colors.border },
                ]}
              >
                <Text style={{ color: active ? '#FFFFFF' : colors.text, fontWeight: '600' }}>{s.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={{ flex: 1 }}>
        {section === 'approvals' && <ApprovalsSection />}
        {section === 'reports' && <AdminReports />}
        {section === 'audit' && <AdminAuditLog />}
        {section === 'fees' && <AdminFees />}    
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { padding: Spacing.lg, paddingBottom: Spacing.sm },
  title: { fontSize: FontSize.title, fontWeight: 'bold' },
  subtitle: { fontSize: FontSize.body, marginTop: Spacing.xs, marginBottom: Spacing.md },
  switchRow: { flexDirection: 'row', gap: Spacing.sm },
  switchChip: {
    flex: 1,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: BorderRadius.md,
    borderWidth: 1,
  },
  list: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.xxl },
  name: { fontSize: FontSize.heading, fontWeight: '600' },
  detail: { fontSize: FontSize.body, marginTop: Spacing.xs },
  actionRow: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.md },
  actionButton: { flex: 1 },
});   