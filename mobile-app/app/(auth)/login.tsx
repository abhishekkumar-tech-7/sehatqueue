import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, useColorScheme, Alert } from 'react-native';
import { router } from 'expo-router';
import { TextField } from '../../components/TextField';
import { Button } from '../../components/Button';
import { PhoneOtpForm } from '../../components/PhoneOtpForm';
import { supabase } from '../../lib/supabase';
import Colors from '../../constants/Colors';
import { Spacing, FontSize, BorderRadius } from '../../constants/Spacing';

function EmailLoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<{ [key: string]: string }>({});

  function validate() {
    const newErrors: { [key: string]: string } = {};
    if (!email.includes('@')) newErrors.email = 'Enter a valid email address';
    if (!password) newErrors.password = 'Password is required';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function handleLogin() {
    if (!validate()) return;

    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setLoading(false);

    if (error) {
      Alert.alert('Login failed', error.message);
      return;
    }
    router.replace('/(tabs)');
  }

  return (
    <View>
      <TextField
        label="Email"
        placeholder="you@example.com"
        keyboardType="email-address"
        autoCapitalize="none"
        value={email}
        onChangeText={setEmail}
        error={errors.email}
      />
      <TextField
        label="Password"
        placeholder="Your password"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        error={errors.password}
      />
      <View style={{ marginTop: Spacing.md }}>
        <Button title="Log In" onPress={handleLogin} variant="primary" loading={loading} />
      </View>
    </View>
  );
}

export default function LoginScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme as 'light' | 'dark'];
  const [mode, setMode] = useState<'phone' | 'email'>('phone');

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.title, { color: colors.text }]}>Welcome back</Text>
      <Text style={[styles.subtitle, { color: colors.textMuted }]}>Log in to manage your bookings</Text>

      <View style={styles.toggleRow}>
        {(['phone', 'email'] as const).map((m) => {
          const active = mode === m;
          return (
            <Pressable
              key={m}
              onPress={() => setMode(m)}
              style={[
                styles.toggle,
                { backgroundColor: active ? colors.primary : colors.cardBackground, borderColor: colors.border },
              ]}
            >
              <Text style={{ color: active ? '#FFFFFF' : colors.text, fontWeight: '600' }}>
                {m === 'phone' ? 'Phone (OTP)' : 'Email'}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {mode === 'phone' ? <PhoneOtpForm collectName={false} /> : <EmailLoginForm />}

      <Text style={[styles.hint, { color: colors.textMuted }]}>
        Patients use Phone (OTP). Doctors, receptionists and admins use Email.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: Spacing.lg, paddingTop: Spacing.xl },
  title: { fontSize: FontSize.title, fontWeight: 'bold', marginBottom: Spacing.sm },
  subtitle: { fontSize: FontSize.body, marginBottom: Spacing.lg },
  toggleRow: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.lg },
  toggle: {
    flex: 1,
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: BorderRadius.md,
    borderWidth: 1,
  },
  hint: { fontSize: FontSize.small, marginTop: Spacing.lg },
});   