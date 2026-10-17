import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, useColorScheme, Alert, Linking } from 'react-native';
import { useTranslation } from 'react-i18next';
import { TextField } from '../../components/TextField';
import { Button } from '../../components/Button';
import { LoadingView } from '../../components/StateViews';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/AuthContext';
import { PRIVACY_POLICY_URL, DELETE_ACCOUNT_URL, isPlaceholderUrl } from '../../constants/Links';
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
  const [showDelete, setShowDelete] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  // Fill the form once the profile has loaded.
  useEffect(() => {
    if (profile) {
      setFullName(profile.full_name);
      setPhone(profile.phone ?? '');
      setLanguage(profile.preferred_language);
    }
  }, [profile]);

  if (loading || !profile) return <LoadingView message="Loading your profile..." />;

  const canSelfDelete = profile.role === 'PATIENT' || profile.role === 'RECEPTIONIST';
  const isDoctor = profile.role === 'DOCTOR';

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

  async function openLink(url: string) {
    if (isPlaceholderUrl(url)) {
      Alert.alert('Not available yet', 'This page has not been published yet.');
      return;
    }
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert('Could not open the link', url);
    }
  }

  async function handleDeleteAccount() {
    if (confirmText.trim().toUpperCase() !== 'DELETE') return;

    setDeleting(true);
    const { error } = await supabase.rpc('delete_my_account');
    if (error) {
      setDeleting(false);
      Alert.alert('Could not delete account', error.message);
      return;
    }

    // The login no longer exists. Signing out clears the saved session, and the
    // root layout then sends the user back to the welcome screen.
    await supabase.auth.signOut();
  }

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
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

      <View style={[styles.section, { borderTopColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Privacy and account</Text>
        <Button title="Privacy Policy" onPress={() => openLink(PRIVACY_POLICY_URL)} variant="secondary" />

        {canSelfDelete && !showDelete && (
          <View style={styles.gap}>
            <Button title="Delete my account" onPress={() => setShowDelete(true)} variant="danger" />
          </View>
        )}

        {canSelfDelete && showDelete && (
          <View style={styles.gap}>
            <Text style={[styles.warning, { color: colors.error }]}>
              This permanently deletes your profile, notifications and all your bookings. Upcoming tokens and
              appointments will be cancelled. This cannot be undone.
            </Text>
            <TextField
              label="Type DELETE to confirm"
              autoCapitalize="characters"
              value={confirmText}
              onChangeText={setConfirmText}
            />
            <Button
              title="Permanently delete my account"
              onPress={handleDeleteAccount}
              variant="danger"
              loading={deleting}
              disabled={confirmText.trim().toUpperCase() !== 'DELETE'}
            />
            <View style={styles.gap}>
              <Button
                title="Cancel"
                onPress={() => {
                  setShowDelete(false);
                  setConfirmText('');
                }}
                variant="secondary"
                disabled={deleting}
              />
            </View>
          </View>
        )}

        {isDoctor && (
          <View style={styles.gap}>
            <Text style={[styles.note, { color: colors.textMuted }]}>
              Doctor accounts are deleted on request, because your sessions and your patients' bookings have to
              be handled first.
            </Text>
            <Button title="Request account deletion" onPress={() => openLink(DELETE_ACCOUNT_URL)} variant="secondary" />
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: Spacing.lg, paddingTop: Spacing.xl, paddingBottom: Spacing.xxl },
  title: { fontSize: FontSize.title, fontWeight: 'bold' },
  role: { fontSize: FontSize.body, marginBottom: Spacing.lg },
  label: { fontSize: FontSize.body, fontWeight: '600', marginBottom: Spacing.xs },
  languageRow: { flexDirection: 'row', gap: Spacing.md, marginBottom: Spacing.lg },
  languageButton: { flex: 1 },
  actions: { marginTop: Spacing.md, marginBottom: Spacing.lg },
  section: { marginTop: Spacing.md, paddingTop: Spacing.lg, borderTopWidth: 1 },
  sectionTitle: { fontSize: FontSize.large, fontWeight: '600', marginBottom: Spacing.md },
  gap: { marginTop: Spacing.md },
  warning: { fontSize: FontSize.body, marginBottom: Spacing.md },
  note: { fontSize: FontSize.small, marginBottom: Spacing.sm },
});     