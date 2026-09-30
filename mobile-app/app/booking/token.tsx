import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet,ScrollView, Pressable, useColorScheme, Alert } from 'react-native';
import { Stack, useLocalSearchParams, router } from 'expo-router';
import { Button } from '../../components/Button';
import { LoadingView, ErrorView } from '../../components/StateViews';
import { supabase } from '../../lib/supabase';
import Colors from '../../constants/Colors';
import { Spacing, FontSize, BorderRadius } from '../../constants/Spacing';

type TokenStatus = {
  token_number: number;
  is_booked: boolean;
  estimated_time: string;
};

function formatEstimatedTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
}

const MAX_SELECTABLE = 5;

export default function TokenBookingScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme as 'light' | 'dark'];
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();

  const [tokens, setTokens] = useState<TokenStatus[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [booking, setBooking] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const { data, error: queryError } = await supabase.rpc('get_session_token_status', {
      p_session_id: sessionId,
    });

    if (queryError || !data) {
      setError('Could not load token availability. Please check your internet connection.');
    } else {
      setTokens(data as TokenStatus[]);
    }
    setLoading(false);
  }, [sessionId]);

  useEffect(() => {
    load();
  }, [load]);

  function toggleToken(tokenNumber: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(tokenNumber)) {
        next.delete(tokenNumber);
      } else {
        if (next.size >= MAX_SELECTABLE) {
          Alert.alert('Limit reached', `You can select up to ${MAX_SELECTABLE} tokens at a time.`);
          return prev;
        }
        next.add(tokenNumber);
      }
      return next;
    });
  }

  async function handleConfirm() {
    if (selected.size === 0) return;

    setBooking(true);
    const { data, error: bookError } = await supabase.rpc('book_tokens', {
      p_session_id: sessionId,
      p_token_numbers: Array.from(selected),
    });
    setBooking(false);

    if (bookError) {
      Alert.alert('Could not book', bookError.message);
      load();
      setSelected(new Set());
      return;
    }

    const results = data as { token_number: number; booking_reference: string }[];
    const summary = results
      .map((r) => `Token #${r.token_number} - Ref: ${r.booking_reference}`)
      .join('\n');

    Alert.alert('Tokens booked', summary, [{ text: 'OK', onPress: () => router.back() }]);
  }

  if (loading) return <LoadingView message="Loading tokens..." />;
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
      <Stack.Screen options={{ title: 'Choose Tokens' }} />
      <Text style={[styles.subtitle, { color: colors.textMuted }]}>
        Select up to {MAX_SELECTABLE} tokens (e.g. for family members). Times shown are estimates, not guaranteed.
      </Text>

      <ScrollView contentContainerStyle={styles.grid}>
        {tokens.map((t) => {
          const isSelected = selected.has(t.token_number);
          return (
            <Pressable
              key={t.token_number}
              disabled={t.is_booked || booking}
              onPress={() => toggleToken(t.token_number)}
              accessibilityRole="button"
              accessibilityState={{ disabled: t.is_booked, selected: isSelected }}
              style={[
                styles.token,
                {
                  backgroundColor: t.is_booked
                    ? colors.border
                    : isSelected
                      ? colors.primary
                      : colors.cardBackground,
                  borderColor: isSelected ? colors.primary : colors.border,
                },
              ]}
            >
              <Text
                style={{
                  color: t.is_booked ? colors.textMuted : isSelected ? '#FFFFFF' : colors.text,
                  fontSize: FontSize.large,
                  fontWeight: '600',
                }}
              >
                #{t.token_number}
              </Text>
              <Text
                style={{
                  color: t.is_booked ? colors.textMuted : isSelected ? '#FFFFFF' : colors.textMuted,
                  fontSize: FontSize.small,
                  marginTop: 2,
                }}
              >
                {t.is_booked ? 'Booked' : formatEstimatedTime(t.estimated_time)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {selected.size > 0 && (
        <View style={styles.footer}>
          <Button
            title={`Book ${selected.size} Token${selected.size > 1 ? 's' : ''}`}
            onPress={handleConfirm}
            variant="primary"
            loading={booking}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: Spacing.lg },
  subtitle: { fontSize: FontSize.body, marginBottom: Spacing.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  token: {
    minWidth: 84,
    minHeight: 56,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    paddingHorizontal: Spacing.sm,
  },
  footer: { marginTop: Spacing.lg },
});     