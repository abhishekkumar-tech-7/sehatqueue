import { View, Text, TextInput, StyleSheet, useColorScheme, TextInputProps } from 'react-native';
import Colors from '../constants/Colors';
import { Spacing, FontSize, BorderRadius } from '../constants/Spacing';

type TextFieldProps = TextInputProps & {
  label: string;
  error?: string;
};

export function TextField({ label, error, style, ...rest }: TextFieldProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme as 'light' | 'dark'];

  return (
    <View style={styles.container}>
      <Text style={[styles.label, { color: colors.text }]}>{label}</Text>
      <TextInput
        style={[
          styles.input,
          {
            borderColor: error ? colors.error : colors.border,
            color: colors.text,
            backgroundColor: colors.cardBackground,
          },
          style,
        ]}
        placeholderTextColor={colors.textMuted}
        accessibilityLabel={label}
        {...rest}
      />
      {error ? (
        <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: Spacing.md,
    width: '100%',
  },
  label: {
    fontSize: FontSize.body,
    fontWeight: '600',
    marginBottom: Spacing.xs,
  },
  input: {
    minHeight: 52, // matches our Button's touch target size
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    fontSize: FontSize.large,
  },
  errorText: {
    fontSize: FontSize.small,
    marginTop: Spacing.xs,
  },
}); 