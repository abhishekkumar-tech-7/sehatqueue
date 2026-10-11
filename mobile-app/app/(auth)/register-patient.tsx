import { Text, StyleSheet, ScrollView, useColorScheme } from 'react-native';
import { PhoneOtpForm } from '../../components/PhoneOtpForm';
import Colors from '../../constants/Colors';
import { Spacing, FontSize } from '../../constants/Spacing';

export default function RegisterPatientScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme as 'light' | 'dark'];

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.title, { color: colors.text }]}>Create Patient Account</Text>
      <Text style={[styles.subtitle, { color: colors.textMuted }]}>
        Verify your mobile number to book appointments and queue tokens for you and your family
      </Text>
      <PhoneOtpForm collectName />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: Spacing.lg, paddingTop: Spacing.xl },
  title: { fontSize: FontSize.title, fontWeight: 'bold', marginBottom: Spacing.sm },
  subtitle: { fontSize: FontSize.body, marginBottom: Spacing.xl },
});  