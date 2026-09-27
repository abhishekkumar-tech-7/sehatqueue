import { View, Text, StyleSheet, useColorScheme } from 'react-native';
import { Button } from '../../components/Button';
import Colors from '../../constants/Colors';
import { Spacing, FontSize } from '../../constants/Spacing';

export default function WelcomeScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme as 'light' | 'dark'];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Text style={[styles.title, { color: colors.text }]}>SehatQueue</Text>
      <Text style={[styles.subtitle, { color: colors.textMuted }]}>
        Book your doctor's appointment or clinic token from home
      </Text>

      <View style={styles.buttonGroup}>
        <Button title="Get Started" onPress={() => {}} variant="primary" />
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
