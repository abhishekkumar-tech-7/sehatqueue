import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Alert, useColorScheme } from 'react-native';
import { TextField } from './TextField';
import { Button } from './Button';
import { supabase } from '../lib/supabase';
import Colors from '../constants/Colors';
import { Spacing, FontSize } from '../constants/Spacing';

const RESEND_SECONDS = 30;

export function PhoneOtpForm({ collectName }: { collectName: boolean }) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme as 'light' | 'dark'];

  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [errors, setErrors] = useState<{ [key: string]: string }>({});

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  const e164 = `+91${phone}`;

  async function sendOtp() {
    const newErrors: { [key: string]: string } = {};
    if (collectName && !fullName.trim()) newErrors.fullName = 'Full name is required';
    if (!/^[6-9]\d{9}$/.test(phone)) newErrors.phone = 'Enter a valid 10-digit mobile number';
    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;

    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({
      phone: e164,
      options: {
        // Login must never create an account; registration may.
        shouldCreateUser: collectName,
        data: collectName ? { full_name: fullName.trim() } : undefined,
      },
    });
    setLoading(false);

    if (error) {
      if (/signups not allowed/i.test(error.message)) {
        Alert.alert('No account found', 'No account exists for this number. Please create an account first.');
      } else {
        Alert.alert('Could not send OTP', error.message);
      }
      return;
    }

    setOtp('');
    setCooldown(RESEND_SECONDS);
    setStep('otp');
  }

  async function verifyOtp() {
    if (otp.length !== 6) {
      setErrors({ otp: 'Enter the 6-digit code' });
      return;
    }
    setErrors({});

    setLoading(true);
    const { error } = await supabase.auth.verifyOtp({ phone: e164, token: otp, type: 'sms' });
    setLoading(false);

    if (error) {
      Alert.alert('Verification failed', error.message);
      return;
    }
    // On success the session is set and the root layout moves the user into the app.
  }

  if (step === 'otp') {
    return (
      <View>
        <Text style={[styles.info, { color: colors.textMuted }]}>
          We sent a 6-digit code to +91 {phone}.
        </Text>
        <TextField
          label="Enter OTP"
          keyboardType="number-pad"
          maxLength={6}
          value={otp}
          onChangeText={(v) => setOtp(v.replace(/\D/g, ''))}
          error={errors.otp}
        />
        <View style={styles.gap}>
          <Button title="Verify & Continue" onPress={verifyOtp} variant="primary" loading={loading} />
        </View>
        <View style={styles.gap}>
          <Button
            title={cooldown > 0 ? `Resend OTP in ${cooldown}s` : 'Resend OTP'}
            onPress={sendOtp}
            variant="secondary"
            disabled={cooldown > 0 || loading}
          />
        </View>
        <View style={styles.gap}>
          <Button title="Change number" onPress={() => setStep('phone')} variant="secondary" />
        </View>
      </View>
    );
  }

  return (
    <View>
      {collectName && (
        <TextField
          label="Full Name"
          placeholder="e.g. Priya Sharma"
          value={fullName}
          onChangeText={setFullName}
          error={errors.fullName}
        />
      )}
      <TextField
        label="Mobile Number (+91)"
        placeholder="10-digit mobile number"
        keyboardType="phone-pad"
        maxLength={10}
        value={phone}
        onChangeText={(v) => setPhone(v.replace(/\D/g, ''))}
        error={errors.phone}
      />
      <View style={styles.gap}>
        <Button title="Send OTP" onPress={sendOtp} variant="primary" loading={loading} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  info: { fontSize: FontSize.body, marginBottom: Spacing.md },
  gap: { marginTop: Spacing.md },
});   