import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, useColorScheme } from 'react-native';
import { router } from 'expo-router';
import { Button } from '../../components/Button';
import { supabase } from '../../lib/supabase';
import Colors from '../../constants/Colors';
import { Spacing, FontSize } from '../../constants/Spacing';

export default function WelcomeScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme as 'light' | 'dark'];
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setEmail(data.session?.user.email ?? null);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user.email ?? null);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Text style={[styles.title, { color: colors.text }]}>SehatQueue</Text>
      <Text style={[styles.subtitle, { color: colors.textMuted }]}>
        {email ? `Logged in as ${email}` : "Book your doctor's appointment or clinic token from home"}
      </Text>

      <View style={styles.buttonGroup}>
        {email ? (
          <Button title="Log Out" onPress={() => supabase.auth.signOut()} variant="secondary" />
        ) : (
          <>
            <Button title="Log In" onPress={() => router.push('/(auth)/login' as any)} variant="primary" />
            <View style={{ height: Spacing.md }} />
            <Button title="Create Account" onPress={() => router.push('/(auth)/choose-role' as any)} variant="secondary" />
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.lg,
  },
  title: {
    fontSize: FontSize.title,
    fontWeight: 'bold',
    marginBottom: Spacing.sm,
  },
  subtitle: {
    fontSize: FontSize.body,
    textAlign: 'center',
    marginBottom: Spacing.xl,
  },
  buttonGroup: {
    width: '100%',
  },
});  