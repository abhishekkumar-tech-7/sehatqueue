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

  const [identifier, setIdentifier] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleAdd() {
    const value = identifier.trim();
    if (value.length < 5) {
      Alert.alert('Invalid entry', 'Enter their email or 10-digit mobile number.');
      return;
    }

    setSaving(true);
    const { error } = await supabase.rpc('add_receptionist', { p_identifier: value });
    setSaving(false);

    if (error) {
      Alert.alert('Could not add receptionist', error.message);
      return;
    }

    Alert.alert('Receptionist added', `${value} can now manage your clinic's queue.`, [
      { text: 'OK', onPress: () => router.back() },
    ]);
  }

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen options={{ title: 'Add Receptionist' }} />
      <Text style={[styles.subtitle, { color: colors.textMuted }]}>
        Enter the email or 10-digit mobile number of a person who has already registered. They'll be
        able to log in and manage your clinic's queue.
      </Text>
      <TextField
        label="Email or mobile number"
        placeholder="receptionist@example.com or 9876543210"
        autoCapitalize="none"
        value={identifier}
        onChangeText={setIdentifier}
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