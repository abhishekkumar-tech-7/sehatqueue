import { View, useColorScheme } from 'react-native';
import AdminPayments from '../../components/AdminPayments';
import { useAuth } from '../../lib/AuthContext';
import Colors from '../../constants/Colors';

export default function PaymentsTab() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme as 'light' | 'dark'];
  const { profile } = useAuth();

  if (profile?.role !== 'ADMIN') return null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <AdminPayments />
    </View>
  );
}  