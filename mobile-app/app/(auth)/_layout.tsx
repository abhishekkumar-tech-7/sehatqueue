import { Stack } from 'expo-router';

export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: true }}>
      <Stack.Screen name="welcome" options={{ headerShown: false }} />
    </Stack>
  );
}