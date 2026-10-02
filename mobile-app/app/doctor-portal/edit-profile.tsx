import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Image, useColorScheme, Alert, Pressable } from 'react-native';
import { Stack, router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { TextField } from '../../components/TextField';
import { Button } from '../../components/Button';
import { LoadingView, ErrorView } from '../../components/StateViews';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/AuthContext';
import Colors from '../../constants/Colors';
import { Spacing, FontSize, BorderRadius } from '../../constants/Spacing';
import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';

type DoctorRow = {
  id: string;
  display_name: string;
  bio: string | null;
  qualifications: string | null;
  photo_url: string | null;
  experience_years: number | null;
};

type Specialty = { id: string; name: string };

export default function EditDoctorProfileScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme as 'light' | 'dark'];
  const { profile } = useAuth();

  const [doctor, setDoctor] = useState<DoctorRow | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [qualifications, setQualifications] = useState('');
  const [experience, setExperience] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [selectedSpecialtyIds, setSelectedSpecialtyIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!profile) return;
    setError(null);
    const { data, error: queryError } = await supabase
      .from('doctors')
      .select('id, display_name, bio, qualifications, photo_url, experience_years')
      .eq('profile_id', profile.id)
      .single();

    if (queryError || !data) {
      setError('Could not load your doctor profile.');
    } else {
      setDoctor(data);
      setDisplayName(data.display_name);
      setBio(data.bio ?? '');
      setQualifications(data.qualifications ?? '');
      setExperience(data.experience_years != null ? String(data.experience_years) : '');
      setPhotoUri(data.photo_url);

      const [{ data: allSpecialties }, { data: myLinks }] = await Promise.all([
        supabase.from('specialties').select('id, name').order('name'),
        supabase.from('doctor_specialties').select('specialty_id').eq('doctor_id', data.id),
      ]);
      setSpecialties(allSpecialties ?? []);
      setSelectedSpecialtyIds(new Set((myLinks ?? []).map((l) => l.specialty_id)));
    }
    setLoading(false);
  }, [profile]);

  useEffect(() => {
    load();
  }, [load]);

  function toggleSpecialty(specialtyId: string) {
    setSelectedSpecialtyIds((prev) => {
      const next = new Set(prev);
      if (next.has(specialtyId)) {
        next.delete(specialtyId);
      } else {
        next.add(specialtyId);
      }
      return next;
    });
  }

  async function handlePickPhoto() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Please allow photo access to set a profile picture.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.6,
      allowsEditing: true,
      aspect: [1, 1],
    });

    if (!result.canceled && result.assets[0]) {
      setPhotoUri(result.assets[0].uri);
    }
  }

  async function uploadPhotoIfChanged(doctorId: string): Promise<string | null> {
    // If the photo is still the original remote URL, nothing changed - skip upload.
    if (!photoUri || photoUri === doctor?.photo_url) {
      return doctor?.photo_url ?? null;
    }

    // React Native's fetch().arrayBuffer() doesn't reliably read local file://
    // URIs, so we read the file as base64 via expo-file-system instead, then
    // decode it into a real binary buffer before uploading.
    const base64 = await FileSystem.readAsStringAsync(photoUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const arrayBuffer = decode(base64);
    const path = `${doctorId}/photo.jpg`;

    const { error: uploadError } = await supabase.storage
      .from('doctor-photos')
      .upload(path, arrayBuffer, { contentType: 'image/jpeg', upsert: true });

    if (uploadError) {
      throw new Error(uploadError.message);
    }

    const { data } = supabase.storage.from('doctor-photos').getPublicUrl(path);
    return `${data.publicUrl}?t=${Date.now()}`;
  }

  async function handleSave() {
    if (!doctor) return;
    if (!displayName.trim()) {
      Alert.alert('Name required', 'Please enter your display name.');
      return;
    }

    setSaving(true);
    try {
      const newPhotoUrl = await uploadPhotoIfChanged(doctor.id);

      const { error: updateError } = await supabase
        .from('doctors')
        .update({
          display_name: displayName.trim(),
          bio: bio.trim() || null,
          qualifications: qualifications.trim() || null,
          experience_years: experience ? parseInt(experience, 10) : null,
          photo_url: newPhotoUrl,
        })
        .eq('id', doctor.id);

      if (updateError) throw new Error(updateError.message);

      // Replace this doctor's specialty links with exactly what's selected now.
      await supabase.from('doctor_specialties').delete().eq('doctor_id', doctor.id);
      if (selectedSpecialtyIds.size > 0) {
        const rows = Array.from(selectedSpecialtyIds).map((specialty_id) => ({
          doctor_id: doctor.id,
          specialty_id,
        }));
        const { error: specialtyError } = await supabase.from('doctor_specialties').insert(rows);
        if (specialtyError) throw new Error(specialtyError.message);
      }

      Alert.alert('Saved', 'Your profile has been updated.', [{ text: 'OK', onPress: () => router.back() }]);
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <LoadingView message="Loading your profile..." />;
  if (error || !doctor) {
    return (
      <ErrorView
        message={error ?? 'Profile not found.'}
        onRetry={() => {
          setLoading(true);
          load();
        }}
      />
    );
  }

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.container}>
      <Stack.Screen options={{ title: 'Edit Profile' }} />

      <View style={styles.photoSection}>
        {photoUri ? (
          <Image source={{ uri: photoUri }} style={styles.photo} />
        ) : (
          <View style={[styles.photoPlaceholder, { backgroundColor: colors.cardBackground }]}>
            <Text style={[styles.photoInitial, { color: colors.textMuted }]}>
              {displayName.charAt(0) || '?'}
            </Text>
          </View>
        )}
        <Button title="Change Photo" onPress={handlePickPhoto} variant="secondary" />
      </View>

      <TextField label="Display Name" value={displayName} onChangeText={setDisplayName} />
      <TextField label="Qualifications" placeholder="e.g. MBBS, MD" value={qualifications} onChangeText={setQualifications} />
      <TextField
        label="Years of Experience"
        keyboardType="number-pad"
        value={experience}
        onChangeText={setExperience}
      />
      <TextField
        label="Bio"
        placeholder="A short introduction for patients"
        value={bio}
        onChangeText={setBio}
        multiline
        numberOfLines={4}
      />

      <Text style={[styles.label, { color: colors.text }]}>Specialties</Text>
      <View style={styles.chipRow}>
        {specialties.map((s) => {
          const active = selectedSpecialtyIds.has(s.id);
          return (
            <Pressable
              key={s.id}
              onPress={() => toggleSpecialty(s.id)}
              style={[
                styles.chip,
                { backgroundColor: active ? colors.primary : colors.cardBackground, borderColor: colors.border },
              ]}
            >
              <Text style={{ color: active ? '#FFFFFF' : colors.text }}>{s.name}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.buttonGroup}>
        <Button title="Save Changes" onPress={handleSave} variant="primary" loading={saving} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
  photoSection: { alignItems: 'center', marginBottom: Spacing.lg },
  photo: { width: 96, height: 96, borderRadius: 48, marginBottom: Spacing.sm },
  photoPlaceholder: {
    width: 96,
    height: 96,
    borderRadius: 48,
    marginBottom: Spacing.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  photoInitial: { fontSize: FontSize.title, fontWeight: 'bold' },
  label: { fontSize: FontSize.body, fontWeight: '600', marginBottom: Spacing.xs, marginTop: Spacing.sm },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginBottom: Spacing.md },
  chip: { minHeight: 44, justifyContent: 'center', paddingHorizontal: Spacing.md, borderRadius: BorderRadius.lg, borderWidth: 1 },
  buttonGroup: { marginTop: Spacing.lg },
});    