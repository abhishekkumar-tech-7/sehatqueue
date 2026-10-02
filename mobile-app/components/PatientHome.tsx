import { View, Text, StyleSheet, useColorScheme } from 'react-native';
import { Button } from './Button';
import { supabase } from '../lib/supabase';
import { Profile } from '../lib/AuthContext';
import Colors from '../constants/Colors';
import { Spacing, FontSize } from '../constants/Spacing';

export default function PatientHome({ profile }: { profile: Profile }) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme as 'light' | 'dark'];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Text style={[styles.title, { color: colors.text }]}>Hello, {profile.full_name}</Text>
      <Text style={[styles.subtitle, { color: colors.textMuted }]}>
        Search for a doctor to book a token or appointment.
      </Text>    
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.lg },
  title: { fontSize: FontSize.title, fontWeight: 'bold', marginBottom: Spacing.sm, textAlign: 'center' },
  subtitle: { fontSize: FontSize.body, marginBottom: Spacing.xl, textAlign: 'center' },
  buttonGroup: { width: '100%' },
});  