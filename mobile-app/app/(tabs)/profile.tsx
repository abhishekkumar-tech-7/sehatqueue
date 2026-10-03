import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, useColorScheme, Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import { TextField } from '../../components/TextField';
import { Button } from '../../components/Button';
import { LoadingView } from '../../components/StateViews';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/AuthContext';
import Colors from '../../constants/Colors';
import { Spacing, FontSize } from '../../constants/Spacing';

export default function ProfileScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme as 'light' | 'dark'];
  const { profile, loading, refreshProfile } = useAuth();
  const { t } = useTranslation();

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [language, setLanguage] = useState('en');
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<{ [key: string]: string }>({});

  // Fill the form once the profile has loaded.
  useEffect(() => {
    if (profile) {
      setFullName(profile.full_name);
      setPhone(profile.phone ?? '');
      setLanguage(profile.preferred_language);
    }
  }, [profile]);

  if (loading || !profile) return <LoadingView message="Loading your profile..." />;

  function validate() {
    const newErrors: { [key: string]: string } = {};
    if (!fullName.trim()) newErrors.fullName = 'Full name is required';
    if (phone.length !== 10) newErrors.phone = 'Enter a valid 10-digit phone number';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function handleSave() {
    if (!validate() || !profile) return;

    setSaving(true);
    // Only these three columns are allowed by our database permissions.
    const { error } = await supabase
      .from('profiles')
      .update({
        full_name: fullName.trim(),
        phone: phone.trim(),
        preferred_language: language,
      })
      .eq('id', profile.id);
    setSaving(false);

    if (error) {
      Alert.alert('Could not save', error.message);
      return;
    }

    await refreshProfile();
    Alert.alert(t('profile.saved'), t('profile.savedMessage'));
  }

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.container}
    >
      <Text style={[styles.title, { color: colors.text }]}>{t('profile.title')}</Text>
      <Text style={[styles.role, { color: colors.textMuted }]}>
        {profile.role.charAt(0) + profile.role.slice(1).toLowerCase()} account
      </Text>

      <TextField label={t('profile.fullName')} value={fullName} onChangeText={setFullName} error={errors.fullName} />
      <TextField
        label={t('profile.phone')}
        keyboardType="phone-pad"
        value={phone}
        onChangeText={setPhone}
        error={errors.phone}
      />
      <TextField label={t('profile.email')} value={profile.email ?? ''} editable={false} />

      <Text style={[styles.label, { color: colors.text }]}>{t('profile.language')}</Text>
      <View style={styles.languageRow}>
        <View style={styles.languageButton}>
          <Button
            title={t('profile.english')}
            onPress={() => setLanguage('en')}
            variant={language === 'en' ? 'primary' : 'secondary'}
          />
        </View>
        <View style={styles.languageButton}>
          <Button
            title={t('profile.hindi')}
            onPress={() => setLanguage('hi')}
            variant={language === 'hi' ? 'primary' : 'secondary'}
          />
        </View>
      </View>

      <View style={styles.actions}>
        <Button title={t('common.save')} onPress={handleSave} variant="primary" loading={saving} />
        <View style={{ height: Spacing.md }} />
        <Button title={t('common.logOut')} onPress={() => supabase.auth.signOut()} variant="danger" />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: Spacing.lg, paddingTop: Spacing.xl },
  title: { fontSize: FontSize.title, fontWeight: 'bold' },
  role: { fontSize: FontSize.body, marginBottom: Spacing.lg },
  label: { fontSize: FontSize.body, fontWeight: '600', marginBottom: Spacing.xs },
  languageRow: { flexDirection: 'row', gap: Spacing.md, marginBottom: Spacing.lg },
  languageButton: { flex: 1 },
  actions: { marginTop: Spacing.md, marginBottom: Spacing.xxl },
});   