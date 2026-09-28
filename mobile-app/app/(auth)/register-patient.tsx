import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, useColorScheme, Alert } from 'react-native';
import { router } from 'expo-router';
import { TextField } from '../../components/TextField';
import { Button } from '../../components/Button';
import { supabase } from '../../lib/supabase';
import Colors from '../../constants/Colors';
import { Spacing, FontSize } from '../../constants/Spacing';

export default function RegisterPatientScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme as 'light' | 'dark'];

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<{ [key: string]: string }>({});

  function validate() {
    const newErrors: { [key: string]: string } = {};
    if (!fullName.trim()) newErrors.fullName = 'Full name is required';
    if (phone.length !== 10) newErrors.phone = 'Enter a valid 10-digit phone number';
    if (!email.includes('@')) newErrors.email = 'Enter a valid email address';
    if (password.length < 6) newErrors.password = 'Password must be at least 6 characters';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function handleRegister() {
    if (!validate()) return;

    setLoading(true);

    // The database trigger creates the profile row from this metadata.
    const { error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: {
          full_name: fullName.trim(),
          phone: phone.trim(),
          role: 'PATIENT',
        },
      },
    });

    setLoading(false);

    if (error) {
      Alert.alert('Registration failed', error.message);
      return;
    }

    router.replace('/(tabs)');
  }

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.container}
    >
      <Text style={[styles.title, { color: colors.text }]}>Create Patient Account</Text>
      <Text style={[styles.subtitle, { color: colors.textMuted }]}>
        Book appointments and queue tokens for you and your family
      </Text>

      <TextField
        label="Full Name"
        placeholder="e.g. Priya Sharma"
        value={fullName}
        onChangeText={setFullName}
        error={errors.fullName}
      />
      <TextField
        label="Phone Number"
        placeholder="10-digit mobile number"
        keyboardType="phone-pad"
        value={phone}
        onChangeText={setPhone}
        error={errors.phone}
      />
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
        placeholder="At least 6 characters"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        error={errors.password}
      />

      <View style={styles.buttonGroup}>
        <Button
          title="Create Account"
          onPress={handleRegister}
          variant="primary"
          loading={loading}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: Spacing.lg,
    paddingTop: Spacing.xl,
  },
  title: {
    fontSize: FontSize.title,
    fontWeight: 'bold',
    marginBottom: Spacing.sm,
  },
  subtitle: {
    fontSize: FontSize.body,
    marginBottom: Spacing.xl,
  },
  buttonGroup: {
    marginTop: Spacing.md,
    marginBottom: Spacing.xxl,
  },
});  