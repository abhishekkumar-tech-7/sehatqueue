import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, useColorScheme } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Card } from '../../components/Card';
import { LoadingView, ErrorView, EmptyView } from '../../components/StateViews';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/AuthContext';
import Colors from '../../constants/Colors';
import { Spacing, FontSize } from '../../constants/Spacing';

type NotificationRow = {
  id: string;
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
};

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

export default function NotificationsScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme as 'light' | 'dark'];
  const { profile } = useAuth();

  const [items, setItems] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!profile) return;
    setError(null);
    const { data, error: queryError } = await supabase
      .from('notifications')
      .select('id, title, body, read_at, created_at')
      .eq('recipient_profile_id', profile.id)
      .order('created_at', { ascending: false });

    if (queryError) {
      setError('Could not load notifications.');
    } else {
      setItems(data ?? []);
    }
    setLoading(false);
  }, [profile]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load();
    }, [load])
  );

  async function markRead(id: string) {
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id);
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)));
  }

  if (loading) return <LoadingView message="Loading notifications..." />;
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
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<EmptyView title="No notifications" message="Updates about your bookings will appear here." />}
        renderItem={({ item }) => (
          <Card
            onTouchStart={() => {
              if (!item.read_at) markRead(item.id);
            }}
          >
            <View style={styles.row}>
              {!item.read_at && <View style={[styles.dot, { backgroundColor: colors.primary }]} />}
              <View style={{ flex: 1 }}>
                <Text style={[styles.title, { color: colors.text }]}>{item.title}</Text>
                <Text style={[styles.body, { color: colors.textMuted }]}>{item.body}</Text>
                <Text style={[styles.when, { color: colors.textMuted }]}>{formatWhen(item.created_at)}</Text>
              </View>
            </View>
          </Card>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { padding: Spacing.lg },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 6, marginRight: Spacing.sm },
  title: { fontSize: FontSize.body, fontWeight: '600' },
  body: { fontSize: FontSize.body, marginTop: Spacing.xs },
  when: { fontSize: FontSize.small, marginTop: Spacing.xs },
});  