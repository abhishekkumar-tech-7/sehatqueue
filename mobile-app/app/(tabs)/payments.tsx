import { useState } from 'react';
import { View, Text, Pressable, StyleSheet, useColorScheme } from 'react-native';
import AdminPayments from '../../components/AdminPayments';
import AdminRefunds from '../../components/AdminRefunds';
import { useAuth } from '../../lib/AuthContext';
import Colors from '../../constants/Colors';
import { Spacing, BorderRadius } from '../../constants/Spacing';

export default function PaymentsTab() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme as 'light' | 'dark'];
  const { profile } = useAuth();
  const [view, setView] = useState<'doctors' | 'refunds'>('doctors');

  if (profile?.role !== 'ADMIN') return null;

  const chip = (key: 'doctors' | 'refunds', label: string) => {
    const active = view === key;
    return (
      <Pressable
        key={key}
        onPress={() => setView(key)}
        style={[
          styles.chip,
          { backgroundColor: active ? colors.primary : colors.cardBackground, borderColor: colors.border },
        ]}
      >
        <Text style={{ color: active ? '#FFFFFF' : colors.text, fontWeight: '600' }}>{label}</Text>
      </Pressable>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={styles.row}>
        {chip('doctors', 'Doctors')}
        {chip('refunds', 'Refunds')}
      </View>
      <View style={{ flex: 1 }}>{view === 'doctors' ? <AdminPayments /> : <AdminRefunds />}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Spacing.sm, padding: Spacing.lg, paddingBottom: 0 },
  chip: {
    flex: 1,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: BorderRadius.md,
    borderWidth: 1,
  },
});   