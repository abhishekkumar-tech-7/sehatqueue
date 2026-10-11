import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, useColorScheme, Alert } from 'react-native';
import { Stack, useLocalSearchParams, router } from 'expo-router';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { TextField } from '../../components/TextField';
import { LoadingView, ErrorView } from '../../components/StateViews';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/AuthContext';
import Colors from '../../constants/Colors';
import { Spacing, FontSize, BorderRadius } from '../../constants/Spacing';

type TokenStatus = {
  token_number: number;
  is_booked: boolean;
  estimated_time: string;
};

type PatientDetail = { name: string; age: string };
type DetailErrors = { name?: string; age?: string };

function formatEstimatedTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
}

const MAX_SELECTABLE = 5;

export default function TokenBookingScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme as 'light' | 'dark'];
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const { profile } = useAuth();

  const [tokens, setTokens] = useState<TokenStatus[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [step, setStep] = useState<'select' | 'details'>('select');
  const [details, setDetails] = useState<Record<number, PatientDetail>>({});
  const [detailErrors, setDetailErrors] = useState<Record<number, DetailErrors>>({});
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

  const selectedList = Array.from(selected).sort((a, b) => a - b);

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

  function handleContinue() {
    if (selectedList.length === 0) return;

    // Keep anything already typed; pre-fill the first token with the account holder's name.
    const next: Record<number, PatientDetail> = {};
    selectedList.forEach((tokenNumber, index) => {
      next[tokenNumber] =
        details[tokenNumber] ?? { name: index === 0 ? profile?.full_name ?? '' : '', age: '' };
    });
    setDetails(next);
    setDetailErrors({});
    setStep('details');
  }

  function updateDetail(tokenNumber: number, field: keyof PatientDetail, value: string) {
    setDetails((prev) => ({ ...prev, [tokenNumber]: { ...prev[tokenNumber], [field]: value } }));
  }

  function validateDetails() {
    const errors: Record<number, DetailErrors> = {};
    selectedList.forEach((tokenNumber) => {
      const d = details[tokenNumber];
      const entryErrors: DetailErrors = {};
      const name = d?.name.trim() ?? '';
      if (name.length < 2) entryErrors.name = 'Enter the patient name';
      else if (name.length > 60) entryErrors.name = 'Name is too long';

      const age = d?.age ?? '';
      if (!/^\d{1,3}$/.test(age) || parseInt(age, 10) > 120) entryErrors.age = 'Enter an age from 0 to 120';

      if (Object.keys(entryErrors).length > 0) errors[tokenNumber] = entryErrors;
    });
    setDetailErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleConfirm() {
    if (!validateDetails()) return;

    setBooking(true);
    const { data, error: bookError } = await supabase.rpc('book_tokens', {
      p_session_id: sessionId,
      p_patients: selectedList.map((tokenNumber) => ({
        token_number: tokenNumber,
        name: details[tokenNumber].name.trim(),
        age: parseInt(details[tokenNumber].age, 10),
      })),
    });
    setBooking(false);

    if (bookError) {
      Alert.alert('Could not book', bookError.message);
      load();
      setSelected(new Set());
      setDetails({});
      setStep('select');
      return;
    }

    const results = data as { token_number: number; booking_reference: string }[];
    const summary = results
      .map((r) => `Token #${r.token_number} (${details[r.token_number]?.name.trim()}) - Ref: ${r.booking_reference}`)
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

  if (step === 'details') {
    return (
      <ScrollView
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={styles.detailsContainer}
        keyboardShouldPersistTaps="handled"
      >
        <Stack.Screen options={{ title: 'Patient Details' }} />
        <Text style={[styles.subtitle, { color: colors.textMuted }]}>
          Enter the name and age of the person each token is for.
        </Text>

        {selectedList.map((tokenNumber) => {
          const token = tokens.find((t) => t.token_number === tokenNumber);
          return (
            <Card key={tokenNumber}>
              <Text style={[styles.cardTitle, { color: colors.primary }]}>
                Token #{tokenNumber}
                {token ? `  ·  about ${formatEstimatedTime(token.estimated_time)}` : ''}
              </Text>
              <TextField
                label="Patient Name"
                placeholder="e.g. Ramesh Kumar"
                value={details[tokenNumber]?.name ?? ''}
                onChangeText={(v) => updateDetail(tokenNumber, 'name', v)}
                error={detailErrors[tokenNumber]?.name}
              />
              <TextField
                label="Age"
                placeholder="e.g. 45"
                keyboardType="number-pad"
                maxLength={3}
                value={details[tokenNumber]?.age ?? ''}
                onChangeText={(v) => updateDetail(tokenNumber, 'age', v.replace(/\D/g, ''))}
                error={detailErrors[tokenNumber]?.age}
              />
            </Card>
          );
        })}

        <View style={styles.footer}>
          <Button
            title={`Confirm ${selectedList.length} Token${selectedList.length > 1 ? 's' : ''}`}
            onPress={handleConfirm}
            variant="primary"
            loading={booking}
          />
        </View>
        <View style={styles.footer}>
          <Button title="Back" onPress={() => setStep('select')} variant="secondary" disabled={booking} />
        </View>
      </ScrollView>
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
              disabled={t.is_booked}
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
            title={`Continue with ${selected.size} Token${selected.size > 1 ? 's' : ''}`}
            onPress={handleContinue}
            variant="primary"
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: Spacing.lg },
  detailsContainer: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
  subtitle: { fontSize: FontSize.body, marginBottom: Spacing.md },
  cardTitle: { fontSize: FontSize.heading, fontWeight: '600', marginBottom: Spacing.sm },
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