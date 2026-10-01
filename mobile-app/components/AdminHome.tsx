import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, useColorScheme, Alert } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Card } from './Card';
import { Button } from './Button';
import { LoadingView, ErrorView, EmptyView } from './StateViews';
import { supabase } from '../lib/supabase';
import { Profile } from '../lib/AuthContext';
import Colors from '../constants/Colors';
import { Spacing, FontSize } from '../constants/Spacing';

type PendingDoctor = {
  id: string;
  display_name: string;
  qualifications: string | null;
  bio: string | null;
  verification_status: string;
  profiles: { email: string | null; phone: string | null } | null;
};

export default function AdminHome({ profile }: { profile: Profile }) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme as 'light' | 'dark'];

  const [doctors, setDoctors] = useState<PendingDoctor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actioningId, setActioningId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const { data, error: queryError } = await supabase
      .from('doctors')
      .select('id, display_name, qualifications, bio, verification_status, profiles(email, phone)')
      .eq('verification_status', 'PENDING')
      .order('created_at');

    if (queryError) {
      setError('Could not load pending doctors.');
    } else {
      setDoctors(data as unknown as PendingDoctor[]);
    }
    setLoading(false);
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
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Text style={[styles.title, { color: colors.text }]}>Admin Dashboard</Text>
      <Text style={[styles.subtitle, { color: colors.textMuted }]}>Pending doctor approvals</Text>

      <FlatList
        data={doctors}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<EmptyView title="Nothing pending" message="No doctor registrations are waiting for review." />}
        renderItem={({ item }) => (
          <Card>
            <Text style={[styles.name, { color: colors.text }]}>{item.display_name}</Text>
            {item.qualifications ? (
              <Text style={[styles.detail, { color: colors.textMuted }]}>{item.qualifications}</Text>
            ) : null}
            {item.profiles?.email ? (
              <Text style={[styles.detail, { color: colors.textMuted }]}>{item.profiles.email}</Text>
            ) : null}
            {item.profiles?.phone ? (
              <Text style={[styles.detail, { color: colors.textMuted }]}>{item.profiles.phone}</Text>
            ) : null}
            {item.bio ? <Text style={[styles.detail, { color: colors.text }]}>{item.bio}</Text> : null}

            <View style={styles.actionRow}>
              <View style={styles.actionButton}>
                <Button
                  title="Approve"
                  onPress={() => handleDecision(item.id, 'APPROVED')}
                  variant="primary"
                  loading={actioningId === item.id}
                />
              </View>
              <View style={styles.actionButton}>
                <Button
                  title="Reject"
                  onPress={() => handleDecision(item.id, 'REJECTED')}
                  variant="danger"
                  loading={actioningId === item.id}
                />
              </View>
            </View>
          </Card>
        )}
      />

      <View style={styles.buttonGroup}>
        <Button title="Log Out" onPress={() => supabase.auth.signOut()} variant="secondary" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: Spacing.lg },
  title: { fontSize: FontSize.title, fontWeight: 'bold' },
  subtitle: { fontSize: FontSize.body, marginTop: Spacing.xs, marginBottom: Spacing.md, color: '#6B7280' },
  list: { paddingBottom: Spacing.md },
  name: { fontSize: FontSize.heading, fontWeight: '600' },
  detail: { fontSize: FontSize.body, marginTop: Spacing.xs },
  actionRow: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.md },
  actionButton: { flex: 1 },
  buttonGroup: { marginTop: Spacing.md },
});  