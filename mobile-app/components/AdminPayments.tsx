import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, useColorScheme, Alert } from 'react-native';
import { Card } from './Card';
import { Button } from './Button';
import { TextField } from './TextField';
import { LoadingView, ErrorView } from './StateViews';
import { supabase } from '../lib/supabase';
import { formatRupees } from '../lib/money';
import Colors from '../constants/Colors';
import { Spacing, FontSize, BorderRadius } from '../constants/Spacing';

type Mode = 'OFF' | 'PLATFORM_FEE_ONLY' | 'FULL';

type Settings = { pay_mode: Mode; route_on: boolean; hold_minutes: number; cutoff_hours: number };
type DoctorRow = {
  doctor_id: string;
  doctor_name: string;
  fee_paise: number | null;
  vendor_id: string | null;
  mode_override: Mode | null;
};

const MODE_LABEL: Record<Mode, string> = { OFF: 'Off', PLATFORM_FEE_ONLY: 'Fee only', FULL: 'Full' };

const MODE_HELP: Record<Mode, string> = {
  OFF: 'No online payment. Everyone pays at the clinic.',
  PLATFORM_FEE_ONLY: 'Patient pays only the platform fee online. The doctor fee is paid at the clinic.',
  FULL: 'Patient pays everything online. With the split on, the doctor fee goes to the doctor and the platform fee stays with you.',
};

export default function AdminPayments() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme as 'light' | 'dark'];

  const [settings, setSettings] = useState<Settings | null>(null);
  const [mode, setMode] = useState<Mode>('OFF');
  const [splitOn, setSplitOn] = useState(false);
  const [hold, setHold] = useState('10');
  const [cutoff, setCutoff] = useState('2');
  const [showDefaults, setShowDefaults] = useState(false);
  const [doctors, setDoctors] = useState<DoctorRow[]>([]);
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [vendorInput, setVendorInput] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const [s, d] = await Promise.all([
      supabase.rpc('admin_get_payment_settings'),
      supabase.rpc('admin_list_doctor_payouts'),
    ]);
    if (s.error || d.error || !s.data) {
      setError('Could not load payment settings. ' + (s.error?.message ?? d.error?.message ?? ''));
      setLoading(false);
      return;
    }
    const row = (Array.isArray(s.data) ? s.data[0] : s.data) as Settings;
    setSettings(row);
    setMode(row.pay_mode);
    setSplitOn(row.route_on);
    setHold(String(row.hold_minutes));
    setCutoff(String(row.cutoff_hours));
    setDoctors((d.data ?? []) as DoctorRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const text = search.trim().toLowerCase();
  const visible = doctors.filter(
    (d) =>
      !text ||
      d.doctor_name.toLowerCase().includes(text) ||
      (d.vendor_id ?? '').toLowerCase().includes(text)
  );

  async function handleSaveDefaults() {
    const holdN = parseInt(hold, 10);
    const cutoffN = parseInt(cutoff, 10);
    if (!(holdN >= 5 && holdN <= 30)) {
      Alert.alert('Check the hold time', 'The payment hold must be 5 to 30 minutes.');
      return;
    }
    if (!(cutoffN >= 0 && cutoffN <= 168)) {
      Alert.alert('Check the refund cut-off', 'The refund cut-off must be 0 to 168 hours.');
      return;
    }
    setSaving(true);
    const { error: saveError } = await supabase.rpc('admin_set_payment_settings', {
      p_mode: mode,
      p_route_enabled: mode === 'FULL' ? splitOn : false,
      p_hold_minutes: holdN,
      p_cutoff_hours: cutoffN,
    });
    setSaving(false);
    if (saveError) {
      Alert.alert('Could not save', saveError.message);
      return;
    }
    Alert.alert('Saved', 'Default payment settings updated.');
    load();
  }

  async function setDoctorMode(doctorId: string, value: Mode | null) {
    setBusyId(doctorId);
    const { error: modeError } = await supabase.rpc('admin_set_doctor_payment_mode', {
      p_doctor_id: doctorId,
      p_mode: value ?? 'DEFAULT',
    });
    setBusyId(null);
    if (modeError) {
      Alert.alert('Could not save', modeError.message);
      return;
    }
    load();
  }

  async function saveVendor(doctorId: string) {
    setBusyId(doctorId);
    const { error: vendorError } = await supabase.rpc('admin_set_doctor_payout_account', {
      p_doctor_id: doctorId,
      p_account_id: vendorInput.trim(),
    });
    setBusyId(null);
    if (vendorError) {
      Alert.alert('Could not save', vendorError.message);
      return;
    }
    setEditingId(null);
    setVendorInput('');
    load();
  }

  if (loading) return <LoadingView message="Loading payment settings..." />;
  if (error || !settings) {
    return (
      <ErrorView
        message={error ?? 'Could not load.'}
        onRetry={() => {
          setLoading(true);
          load();
        }}
      />
    );
  }

  const chip = (label: string, active: boolean, onPress: () => void, disabled = false) => (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.chip,
        { backgroundColor: active ? colors.primary : colors.cardBackground, borderColor: colors.border, opacity: disabled ? 0.6 : 1 },
      ]}
    >
      <Text style={{ color: active ? '#FFFFFF' : colors.text, fontWeight: '600', fontSize: FontSize.small }}>{label}</Text>
    </Pressable>
  );

  const defaultButton = (value: Mode, label: string) => (
    <View style={styles.flex1}>
      <Button title={label} onPress={() => setMode(value)} variant={mode === value ? 'primary' : 'secondary'} />
    </View>
  );

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <TextField
        label="Search"
        placeholder="Doctor name or vendor ID"
        autoCapitalize="none"
        value={search}
        onChangeText={setSearch}
      />

      <View style={{ marginBottom: Spacing.md }}>
        <Button
          title={showDefaults ? 'Hide default settings' : 'Default settings (all doctors)'}
          onPress={() => setShowDefaults((v) => !v)}
          variant="secondary"
        />
      </View>

      {showDefaults ? (
        <Card>
          <Text style={[styles.heading, { color: colors.text }]}>Default for doctors with no setting</Text>
          <View style={styles.row}>
            {defaultButton('OFF', 'Off')}
            {defaultButton('PLATFORM_FEE_ONLY', 'Fee only')}
            {defaultButton('FULL', 'Full')}
          </View>
          <Text style={[styles.help, { color: colors.textMuted }]}>{MODE_HELP[mode]}</Text>

          {mode === 'FULL' ? (
            <View style={{ marginTop: Spacing.md }}>
              <Text style={[styles.label, { color: colors.text }]}>Split to doctors (Cashfree Easy Split)</Text>
              <View style={styles.row}>
                <View style={styles.flex1}>
                  <Button title="Split on" onPress={() => setSplitOn(true)} variant={splitOn ? 'primary' : 'secondary'} />
                </View>
                <View style={styles.flex1}>
                  <Button title="Split off" onPress={() => setSplitOn(false)} variant={!splitOn ? 'primary' : 'secondary'} />
                </View>
              </View>
              {!splitOn ? (
                <Text style={[styles.help, { color: colors.warning }]}>
                  With the split off, the full amount stays with the platform and you would have to pay doctors yourself. Check with a CA first.
                </Text>
              ) : null}
            </View>
          ) : null}

          <View style={{ marginTop: Spacing.md }}>
            <TextField
              label="Hold an unpaid booking for (minutes, 5 to 30)"
              keyboardType="number-pad"
              value={hold}
              onChangeText={(v) => setHold(v.replace(/\D/g, ''))}
            />
            <TextField
              label="Refund allowed until (hours before session, 0 to 168)"
              keyboardType="number-pad"
              value={cutoff}
              onChangeText={(v) => setCutoff(v.replace(/\D/g, ''))}
            />
          </View>
          <Button title="Save default settings" onPress={handleSaveDefaults} variant="primary" loading={saving} />
        </Card>
      ) : null}

      <Text style={[styles.heading, { color: colors.text }]}>
        Doctors ({visible.length}
        {text ? ` of ${doctors.length}` : ''})
      </Text>
      <Text style={[styles.help, { color: colors.textMuted }]}>
        Each doctor can have their own payment mode. "Default" follows the platform default ({MODE_LABEL[settings.pay_mode]}).
      </Text>

      {visible.length === 0 ? (
        <Text style={[styles.help, { color: colors.textMuted, marginTop: Spacing.md }]}>
          {doctors.length === 0 ? 'No approved doctors yet.' : 'No doctor matches your search.'}
        </Text>
      ) : (
        visible.map((d) => {
          const effective: Mode = d.mode_override ?? settings.pay_mode;
          const busy = busyId === d.doctor_id;
          const needsVendor = effective === 'FULL' && settings.route_on && !d.vendor_id && (d.fee_paise ?? 0) > 0;
          return (
            <Card key={d.doctor_id}>
              <Text style={[styles.docName, { color: colors.text }]}>{d.doctor_name}</Text>
              <Text style={[styles.help, { color: colors.textMuted }]}>
                Fee: {d.fee_paise == null ? 'not set' : d.fee_paise === 0 ? 'Free' : formatRupees(d.fee_paise)}
              </Text>

              <Text style={[styles.label, { color: colors.text, marginTop: Spacing.sm }]}>
                Payment mode: {MODE_LABEL[effective]}
                {d.mode_override ? '' : ' (default)'}
              </Text>
              <View style={styles.row}>
                {chip('Default', d.mode_override === null, () => setDoctorMode(d.doctor_id, null), busy)}
                {chip('Off', d.mode_override === 'OFF', () => setDoctorMode(d.doctor_id, 'OFF'), busy)}
                {chip('Fee only', d.mode_override === 'PLATFORM_FEE_ONLY', () => setDoctorMode(d.doctor_id, 'PLATFORM_FEE_ONLY'), busy)}
                {chip('Full', d.mode_override === 'FULL', () => setDoctorMode(d.doctor_id, 'FULL'), busy)}
              </View>

              <Text style={[styles.help, { color: d.vendor_id ? colors.success : colors.textMuted, marginTop: Spacing.sm }]}>
                {d.vendor_id ? `Vendor ID: ${d.vendor_id}` : 'No vendor ID'}
              </Text>
              {needsVendor ? (
                <Text style={[styles.help, { color: colors.warning }]}>
                  Full mode with the split on needs a vendor ID. Patients cannot pay online for this doctor until you add one.
                </Text>
              ) : null}

              {editingId === d.doctor_id ? (
                <View style={{ marginTop: Spacing.sm }}>
                  <TextField
                    label="Cashfree vendor ID"
                    placeholder="e.g. doc_neha01"
                    autoCapitalize="none"
                    value={vendorInput}
                    onChangeText={setVendorInput}
                  />
                  <View style={styles.row}>
                    <View style={styles.flex1}>
                      <Button title="Save" onPress={() => saveVendor(d.doctor_id)} variant="primary" loading={busy} />
                    </View>
                    <View style={styles.flex1}>
                      <Button
                        title="Cancel"
                        onPress={() => {
                          setEditingId(null);
                          setVendorInput('');
                        }}
                        variant="secondary"
                        disabled={busy}
                      />
                    </View>
                  </View>
                </View>
              ) : (
                <View style={{ marginTop: Spacing.sm }}>
                  <Button
                    title={d.vendor_id ? 'Change vendor ID' : 'Add vendor ID'}
                    onPress={() => {
                      setEditingId(d.doctor_id);
                      setVendorInput(d.vendor_id ?? '');
                    }}
                    variant="secondary"
                  />
                </View>
              )}
            </Card>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
  heading: { fontSize: FontSize.heading, fontWeight: '600', marginBottom: Spacing.xs },
  label: { fontSize: FontSize.body, fontWeight: '600', marginBottom: Spacing.xs },
  help: { fontSize: FontSize.small, marginTop: Spacing.xs },
  docName: { fontSize: FontSize.heading, fontWeight: '600' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginTop: Spacing.sm },
  flex1: { flex: 1 },
  chip: {
    minHeight: 40,
    paddingHorizontal: Spacing.md,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: BorderRadius.md,
    borderWidth: 1,
  },
});   