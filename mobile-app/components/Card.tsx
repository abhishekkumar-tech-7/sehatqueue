import { View, StyleSheet, ViewProps, useColorScheme } from 'react-native';
import Colors from '../constants/Colors';
import { Spacing, BorderRadius } from '../constants/Spacing';

type CardProps = ViewProps;

export function Card({ style, children, ...rest }: CardProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme as 'light' | 'dark'];

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.cardBackground,
          borderColor: colors.border,
        },
        style,
      ]}
      {...rest}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    width: '100%',
  },
});  