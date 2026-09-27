import { View, Text, StyleSheet, ActivityIndicator, useColorScheme } from 'react-native';
import { Button } from './Button';
import Colors from '../constants/Colors';
import { Spacing, FontSize } from '../constants/Spacing';

// Shown while data is being fetched (e.g. searching doctors, loading bookings)
export function LoadingView({ message = 'Loading...' }: { message?: string }) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme as 'light' | 'dark'];

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={[styles.message, { color: colors.textMuted }]}>{message}</Text>
    </View>
  );
}

// Shown when a list has no results (e.g. no doctors found, no bookings yet)
export function EmptyView({
  title = 'Nothing here yet',
  message,
}: {
  title?: string;
  message?: string;
}) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme as 'light' | 'dark'];

  return (
    <View style={styles.container}>
      <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
      {message ? (
        <Text style={[styles.message, { color: colors.textMuted }]}>{message}</Text>
      ) : null}
    </View>
  );
}

// Shown when something fails (e.g. network error, booking failed)
export function ErrorView({
  message = 'Something went wrong. Please try again.',
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme as 'light' | 'dark'];

  return (
    <View style={styles.container}>
      <Text style={[styles.title, { color: colors.error }]}>Oops</Text>
      <Text style={[styles.message, { color: colors.textMuted }]}>{message}</Text>
      {onRetry ? (
        <View style={styles.retryButton}>
          <Button title="Try Again" onPress={onRetry} variant="secondary" />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl,
  },
  title: {
    fontSize: FontSize.heading,
    fontWeight: '600',
    marginBottom: Spacing.sm,
    textAlign: 'center',
  },
  message: {
    fontSize: FontSize.body,
    textAlign: 'center',
    marginTop: Spacing.sm,
  },
  retryButton: {
    marginTop: Spacing.lg,
    width: '100%',
  },
});  