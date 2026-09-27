import { View, Text, StyleSheet, useColorScheme } from 'react-native';
import { router } from 'expo-router';
import { Button } from '../../components/Button';
import Colors from '../../constants/Colors';
import { Spacing, FontSize } from '../../constants/Spacing';

export default function ChooseRoleScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme as 'light' | 'dark'];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Text style={[styles.title, { color: colors.text }]}>Join SehatQueue</Text>
      <Text style={[styles.subtitle, { color: colors.textMuted }]}>
        Are you a patient looking for care, or a doctor joining our platform?
      </Text>

      <View style={styles.buttonGroup}>
        <Button
          title="I'm a Patient"
          onPress={() => router.push('/(auth)/register-patient' as any)}
          variant="primary"
        />
        <View style={{ height: Spacing.md }} />
        <Button
          title="I'm a Doctor"
          onPress={() => router.push('/(auth)/register-doctor' as any)}
          variant="secondary"
        />
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