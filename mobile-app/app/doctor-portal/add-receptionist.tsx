import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, useColorScheme, Alert } from 'react-native';
import { Stack, router } from 'expo-router';
import { TextField } from '../../components/TextField';
import { Button } from '../../components/Button';
import { supabase } from '../../lib/supabase';
import Colors from '../../constants/Colors';
import { Spacing, FontSize } from '../../constants/Spacing';

export default function AddReceptionistScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme as 'light' | 'dark'];

  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleAdd() {
    if (!email.includes('@')) {
      Alert.alert('Invalid email', 'Enter a valid email address.');
      return;
    }

    setSaving(true);
    const { error } = await supabase.rpc('add_receptionist', { p_email: email.trim() });
    setSaving(false);

    if (error) {
      Alert.alert('Could not add receptionist', error.message);
      return;
    }

    Alert.alert('Receptionist added', `${email.trim()} can now manage your clinic's queue.`, [
      { text: 'OK', onPress: () => router.back() },
    ]);
  }

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.container}>
      <Stack.Screen options={{ title: 'Add Receptionist' }} />
      <Text style={[styles.subtitle, { color: colors.textMuted }]}>
        Enter the email of a person who has already registered as a patient. They'll be able to log
        in and manage your clinic's queue.
      </Text>
      <TextField
        label="Email"
        placeholder="receptionist@example.com"
        keyboardType="email-address"
        autoCapitalize="none"
        value={email}
        onChangeText={setEmail}
      />
      <View style={styles.buttonGroup}>
        <Button title="Add Receptionist" onPress={handleAdd} variant="primary" loading={saving} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
  subtitle: { fontSize: FontSize.body, marginBottom: Spacing.lg },
  buttonGroup: { marginTop: Spacing.lg },
}); 