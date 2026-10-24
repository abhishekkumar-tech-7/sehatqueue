import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, useColorScheme, Alert } from 'react-native';
import { Stack, router, useFocusEffect } from 'expo-router';
import { TextField } from '../../components/TextField';
import { Button } from '../../components/Button';
import { LoadingView, ErrorView } from '../../components/StateViews';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/AuthContext';
import Colors from '../../constants/Colors';
import { Spacing, FontSize, BorderRadius } from '../../constants/Spacing';

type ClinicLink = { id: string; clinics: { name: string } | null };

const DAYS = [
  { n: 1, l: 'Mon' },
  { n: 2, l: 'Tue' },
  { n: 3, l: 'Wed' },
  { n: 4, l: 'Thu' },
  { n: 5, l: 'Fri' },
  { n: 6, l: 'Sat' },
  { n: 7, l: 'Sun' },
];

const PRESETS = [
  { label: 'Morning', start: '09:00', end: '13:00' },
  { label: 'Evening', start: '17:00', end: '20:00' },
  { label: 'Night', start: '20:00', end: '22:00' },
];

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function todayInIndia() {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function ymd(y: number, m: number, d: number) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function formatTime(value: string) {
  const [h, m] = value.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${suffix}`;
}

function nameFor(label: string | null, start: string) {
  if (label) return label;
  const h = parseInt(start.slice(0, 2), 10);
  if (h < 12) return 'Morning';
  if (h < 17) return 'Afternoon';
  if (h < 21) return 'Evening';
  return 'Night';
}

// ---------------------------------------------------------------- screen

export default function ScheduleScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme as 'light' | 'dark'];
  const { profile } = useAuth();

  const [clinics, setClinics] = useState<ClinicLink[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<'ROUTINE' | 'CALENDAR'>('ROUTINE');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isDoctor = profile?.role === 'DOCTOR';

  const load = useCallback(async () => {
    if (!profile) return;
    setError(null);

    let list: ClinicLink[] = [];
    if (profile.role === 'RECEPTIONIST') {
      const { data: staffRows } = await supabase
        .from('clinic_staff')
        .select('clinic_id')
        .eq('profile_id', profile.id)
        .eq('is_active', true);
      const ids = (staffRows ?? []).map((r) => r.clinic_id);
      if (ids.length > 0) {
        const { data, error: qe } = await supabase.from('doctor_clinics').select('id, clinics(name)').in('clinic_id', ids);
        if (qe) {
          setError('Could not load your clinics.');
          setLoading(false);
          return;
        }
        list = data as unknown as ClinicLink[];
      }
    } else {
      const { data: doctorRow } = await supabase.from('doctors').select('id').eq('profile_id', profile.id).single();
      if (!doctorRow) {
        setError('Doctor profile not found.');
        setLoading(false);
        return;
      }
      const { data, error: qe } = await supabase.from('doctor_clinics').select('id, clinics(name)').eq('doctor_id', doctorRow.id);
      if (qe) {
        setError('Could not load your clinics.');
        setLoading(false);
        return;
      }
      list = data as unknown as ClinicLink[];
    }

    setClinics(list);
    if (list.length > 0) setSelected((prev) => prev ?? list[0].id);
    setLoading(false);
  }, [profile]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <LoadingView message="Loading..." />;
  if (error) {
    return (
      <ErrorView
        message={error}
        onRetry={() => {
          setLoading(true);
          load();
        }}
      />
    );
  }
  if (clinics.length === 0 || !selected) {
    return <ErrorView message="No clinic is linked to your account yet." />;
  }

  const chip = (label: string, active: boolean, onPress: () => void, key?: string) => (
    <Pressable
      key={key ?? label}
      onPress={onPress}
      style={[
        styles.chip,
        { backgroundColor: active ? colors.primary : colors.cardBackground, borderColor: colors.border },
      ]}
    >
      <Text style={{ color: active ? '#FFFFFF' : colors.text, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen options={{ title: isDoctor ? 'Schedule & Holidays' : 'Schedule' }} />
      <View style={styles.topBar}>
        {clinics.length > 1 ? (
          <View style={styles.chipRow}>
            {clinics.map((c) => chip(c.clinics?.name ?? 'Clinic', selected === c.id, () => setSelected(c.id), c.id))}
          </View>
        ) : null}
        <View style={styles.chipRow}>
          {chip('Weekly Routine', tab === 'ROUTINE', () => setTab('ROUTINE'))}
          {chip('Calendar', tab === 'CALENDAR', () => setTab('CALENDAR'))}
        </View>
      </View>

      <View style={{ flex: 1 }}>
        {tab === 'ROUTINE' ? (
          <RoutineTab key={`r-${selected}`} dcId={selected} />
        ) : (
          <CalendarTab key={`c-${selected}`} dcId={selected} isDoctor={isDoctor} />
        )}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------- weekly routine

type RBlock = {
  key: string;
  weekdays: number[];
  label: string;
  start: string;
  end: string;
  mode: 'TOKEN' | 'SLOT';
  capacity: string;
  avg: string;
};

function RoutineTab({ dcId }: { dcId: string }) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme as 'light' | 'dark'];

  const [blocks, setBlocks] = useState<RBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [genDays, setGenDays] = useState('30');

  const load = useCallback(async () => {
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('get_routine', { p_doctor_clinic_id: dcId });
    if (rpcError) {
      setError(rpcError.message);
      setLoading(false);
      return;
    }
    const map = new Map<string, RBlock>();
    (data ?? []).forEach((r: any) => {
      const start = String(r.start_time).slice(0, 5);
      const end = String(r.end_time).slice(0, 5);
      const k = [r.block_label ?? '', start, end, r.booking_mode, r.capacity, r.avg_consultation_minutes].join('|');
      const ex = map.get(k);
      if (ex) ex.weekdays.push(r.weekday);
      else
        map.set(k, {
          key: k,
          weekdays: [r.weekday],
          label: r.block_label ?? '',
          start,
          end,
          mode: r.booking_mode,
          capacity: String(r.capacity),
          avg: String(r.avg_consultation_minutes),
        });
    });
    setBlocks(Array.from(map.values()).sort((a, b) => a.start.localeCompare(b.start)));
    setDirty(false);
    setLoading(false);
  }, [dcId]);

  useEffect(() => {
    load();
  }, [load]);

  function update(key: string, patch: Partial<RBlock>) {
    setBlocks((prev) => prev.map((b) => (b.key === key ? { ...b, ...patch } : b)));
    setDirty(true);
  }

  function toggleDay(key: string, n: number) {
    setBlocks((prev) =>
      prev.map((b) =>
        b.key === key
          ? { ...b, weekdays: b.weekdays.includes(n) ? b.weekdays.filter((d) => d !== n) : [...b.weekdays, n].sort() }
          : b
      )
    );
    setDirty(true);
  }

  function addBlock() {
    const p = PRESETS[blocks.length] ?? { label: '', start: '09:00', end: '13:00' };
    setBlocks((prev) => [
      ...prev,
      {
        key: Math.random().toString(36).slice(2),
        weekdays: [1, 2, 3, 4, 5, 6],
        label: p.label,
        start: p.start,
        end: p.end,
        mode: 'TOKEN',
        capacity: '30',
        avg: '5',
      },
    ]);
    setDirty(true);
  }

  function removeBlock(key: string) {
    setBlocks((prev) => prev.filter((b) => b.key !== key));
    setDirty(true);
  }

  function validate(): string | null {
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const n = `Session ${i + 1}`;
      if (b.weekdays.length === 0) return `${n}: choose at least one day.`;
      if (!TIME_RE.test(b.start) || !TIME_RE.test(b.end)) return `${n}: enter times as HH:MM, 24-hour.`;
      if (b.end <= b.start) return `${n}: the end time must be after the start time.`;
      if (!(parseInt(b.capacity, 10) >= 1)) return `${n}: capacity must be at least 1.`;
      for (let j = i + 1; j < blocks.length; j++) {
        const o = blocks[j];
        const shared = b.weekdays.some((d) => o.weekdays.includes(d));
        if (shared && TIME_RE.test(o.start) && TIME_RE.test(o.end) && b.start < o.end && b.end > o.start) {
          return `Session ${i + 1} and session ${j + 1} overlap on a shared day.`;
        }
      }
    }
    return null;
  }

  async function save() {
    const problem = validate();
    if (problem) {
      Alert.alert('Check your routine', problem);
      return;
    }
    setSaving(true);
    const rows = blocks.flatMap((b) =>
      b.weekdays.map((w) => ({
        weekday: w,
        label: b.label.trim(),
        start: b.start,
        end: b.end,
        mode: b.mode,
        capacity: parseInt(b.capacity, 10),
        avg: parseInt(b.avg, 10) || 5,
      }))
    );
    const { error: saveError } = await supabase.rpc('save_routine', { p_doctor_clinic_id: dcId, p_blocks: rows });
    setSaving(false);
    if (saveError) {
      Alert.alert('Could not save', saveError.message);
      return;
    }
    setDirty(false);
    Alert.alert('Saved', 'Your weekly routine is saved. Press "Generate sessions" to create sessions from it.');
  }

  async function generate() {
    if (dirty) {
      Alert.alert('Save first', 'You changed the routine. Save it before generating sessions.');
      return;
    }
    const days = parseInt(genDays, 10);
    if (!days || days < 1 || days > 30) {
      Alert.alert('Number of days', 'Choose between 1 and 30 days.');
      return;
    }
    setGenerating(true);
    const { data, error: genError } = await supabase.rpc('generate_sessions_from_routine', {
      p_doctor_clinic_id: dcId,
      p_from: todayInIndia(),
      p_days: days,
    });
    setGenerating(false);
    if (genError) {
      Alert.alert('Could not generate', genError.message);
      return;
    }
    const r = (Array.isArray(data) ? data[0] : data) as {
      created_count: number;
      holiday_count: number;
      overlap_count: number;
      past_count: number;
    };
    const lines = [`${r.created_count} session(s) created for the next ${days} day(s).`];
    if (r.holiday_count > 0) lines.push(`${r.holiday_count} skipped (holiday).`);
    if (r.overlap_count > 0) lines.push(`${r.overlap_count} skipped (a session already exists at that time).`);
    if (r.past_count > 0) lines.push(`${r.past_count} skipped (time already passed).`);
    Alert.alert('Done', lines.join('\n'));
  }

  if (loading) return <LoadingView message="Loading routine..." />;
  if (error) {
    return (
      <ErrorView
        message={error}
        onRetry={() => {
          setLoading(true);
          load();
        }}
      />
    );
  }

  const chip = (label: string, active: boolean, onPress: () => void, key?: string) => (
    <Pressable
      key={key ?? label}
      onPress={onPress}
      style={[
        styles.chipSmall,
        { backgroundColor: active ? colors.primary : colors.cardBackground, borderColor: colors.border },
      ]}
    >
      <Text style={{ color: active ? '#FFFFFF' : colors.text }}>{label}</Text>
    </Pressable>
  );

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={[styles.help, { color: colors.textMuted }]}>
        Set your usual week once. Days with no session are your days off.
      </Text>

      {blocks.length === 0 ? (
        <Text style={[styles.help, { color: colors.textMuted }]}>No routine yet. Add your first session below.</Text>
      ) : null}

      {blocks.map((b, index) => (
        <View
          key={b.key}
          style={[styles.blockCard, { backgroundColor: colors.cardBackground, borderColor: colors.border }]}
        >
          <View style={styles.blockHeader}>
            <Text style={[styles.blockTitle, { color: colors.text }]}>Session {index + 1}</Text>
            <Pressable onPress={() => removeBlock(b.key)}>
              <Text style={{ color: colors.error, fontWeight: '600' }}>Remove</Text>
            </Pressable>
          </View>

          <Text style={[styles.label, { color: colors.text }]}>Days</Text>
          <View style={styles.chipRow}>
            {DAYS.map((d) => chip(d.l, b.weekdays.includes(d.n), () => toggleDay(b.key, d.n), `${b.key}-${d.n}`))}
          </View>

          <View style={styles.chipRow}>
            {PRESETS.map((p) =>
              chip(p.label, b.label === p.label, () => update(b.key, { label: p.label, start: p.start, end: p.end }), p.label)
            )}
          </View>
          <TextField
            label="Session name (shown to patients)"
            maxLength={30}
            value={b.label}
            onChangeText={(v) => update(b.key, { label: v })}
          />
          <TextField label="Start (HH:MM, 24-hour)" value={b.start} onChangeText={(v) => update(b.key, { start: v })} />
          <TextField label="End (HH:MM, 24-hour)" value={b.end} onChangeText={(v) => update(b.key, { end: v })} />

          <View style={styles.chipRow}>
            {chip('Token Queue', b.mode === 'TOKEN', () => update(b.key, { mode: 'TOKEN' }), 'tk')}
            {chip('Time Slots', b.mode === 'SLOT', () => update(b.key, { mode: 'SLOT' }), 'sl')}
          </View>
          <TextField
            label="Capacity"
            keyboardType="number-pad"
            value={b.capacity}
            onChangeText={(v) => update(b.key, { capacity: v.replace(/\D/g, '') })}
          />
          {b.mode === 'TOKEN' ? (
            <TextField
              label="Average minutes per patient"
              keyboardType="number-pad"
              value={b.avg}
              onChangeText={(v) => update(b.key, { avg: v.replace(/\D/g, '') })}
            />
          ) : null}
        </View>
      ))}

      {blocks.length < 8 ? <Button title="+ Add a session to the week" onPress={addBlock} variant="secondary" /> : null}

      <View style={{ marginTop: Spacing.md }}>
        <Button title={dirty ? 'Save routine (unsaved changes)' : 'Save routine'} onPress={save} variant="primary" loading={saving} />
      </View>

      <View style={[styles.divider, { backgroundColor: colors.border }]} />

      <Text style={[styles.heading, { color: colors.text }]}>Generate sessions from the routine</Text>
      <Text style={[styles.help, { color: colors.textMuted }]}>
        Creates the sessions for the coming days. Holidays and times that already have a session are skipped.
      </Text>
      <View style={styles.chipRow}>
        {['7', '14', '30'].map((d) => chip(`Next ${d} days`, genDays === d, () => setGenDays(d), `g${d}`))}
      </View>
      <TextField
        label="Or enter the number of days (1 to 30)"
        keyboardType="number-pad"
        value={genDays}
        onChangeText={(v) => setGenDays(v.replace(/\D/g, ''))}
      />
      <Button title="Generate sessions" onPress={generate} variant="primary" loading={generating} />
    </ScrollView>
  );
}

// ---------------------------------------------------------------- calendar

type DaySession = {
  id: string;
  session_date: string;
  start_time: string;
  end_time: string;
  status: string;
  block_label: string | null;
  booking_mode: 'TOKEN' | 'SLOT';
  capacity: number;
};

function CalendarTab({ dcId, isDoctor }: { dcId: string; isDoctor: boolean }) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme as 'light' | 'dark'];

  const today = todayInIndia();
  const [ty, tm] = today.split('-').map(Number);
  const [year, setYear] = useState(ty);
  const [month, setMonth] = useState(tm - 1);
  const [selected, setSelected] = useState<string | null>(null);
  const [sessions, setSessions] = useState<DaySession[]>([]);
  const [holidays, setHolidays] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  const load = useCallback(async () => {
    const [s, h] = await Promise.all([
      supabase
        .from('clinic_sessions')
        .select('id, session_date, start_time, end_time, status, block_label, booking_mode, capacity')
        .eq('doctor_clinic_id', dcId)
        .gte('session_date', ymd(year, month, 1))
        .lte('session_date', ymd(year, month, new Date(Date.UTC(year, month + 1, 0)).getUTCDate()))
        .order('start_time'),
      supabase.rpc('list_holidays', { p_doctor_clinic_id: dcId }),
    ]);
    setSessions(((s.data ?? []) as DaySession[]).filter((x) => x.status !== 'CANCELLED'));
    const map: Record<string, string | null> = {};
    ((h.data ?? []) as { h_date: string; h_reason: string | null }[]).forEach((r) => {
      map[r.h_date] = r.h_reason;
    });
    setHolidays(map);
    setLoading(false);
  }, [dcId, year, month]);

  // Reload when coming back from the new-session screen too.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  function shiftMonth(delta: number) {
    let m = month + delta;
    let y = year;
    if (m < 0) {
      m = 11;
      y -= 1;
    } else if (m > 11) {
      m = 0;
      y += 1;
    }
    if (y < ty || (y === ty && m < tm - 1)) return;
    setYear(y);
    setMonth(m);
    setSelected(null);
  }

  const offset = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7;
  const cells: (number | null)[] = [
    ...Array(offset).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  const withSessions = new Set(sessions.map((s) => s.session_date));
  const daySessions = selected ? sessions.filter((s) => s.session_date === selected) : [];
  const isHoliday = selected ? selected in holidays : false;
  const selectedPast = selected ? selected < today : false;

  async function afterChange(message: string) {
    supabase.functions.invoke('process-refunds').catch(() => {});
    await load();
    Alert.alert('Done', message);
  }

  async function markHoliday() {
    if (!selected) return;
    setBusy(true);
    const { data: pv, error: pvError } = await supabase.rpc('preview_holiday', { p_date: selected });
    setBusy(false);
    if (pvError) {
      Alert.alert('Could not check', pvError.message);
      return;
    }
    const p = (Array.isArray(pv) ? pv[0] : pv) as { session_count: number; booking_count: number; paid_count: number };
    const detail =
      p.session_count === 0
        ? 'There are no sessions on this day. New sessions and bookings will be blocked.'
        : `${p.session_count} session(s) will be cancelled and ${p.booking_count} booking(s) cancelled. ` +
          `Every patient is notified${p.paid_count > 0 ? `, and ${p.paid_count} paid booking(s) are refunded in full` : ''}.`;

    Alert.alert('Mark ' + selected + ' as a holiday?', detail, [
      { text: 'Keep the day', style: 'cancel' },
      {
        text: 'Mark holiday',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          const { data, error: markError } = await supabase.rpc('mark_holiday', { p_date: selected, p_reason: null });
          setBusy(false);
          if (markError) {
            Alert.alert('Could not mark holiday', markError.message);
            return;
          }
          const r = (Array.isArray(data) ? data[0] : data) as {
            sessions_cancelled: number;
            bookings_cancelled: number;
            refunds_started: number;
          };
          afterChange(
            `${r.sessions_cancelled} session(s) cancelled, ${r.bookings_cancelled} booking(s) cancelled, ${r.refunds_started} refund(s) started.`
          );
        },
      },
    ]);
  }

  async function removeHoliday() {
    if (!selected) return;
    setBusy(true);
    const { error: unError } = await supabase.rpc('unmark_holiday', { p_date: selected });
    setBusy(false);
    if (unError) {
      Alert.alert('Could not remove', unError.message);
      return;
    }
    await load();
    Alert.alert('Holiday removed', 'Sessions cancelled earlier are not restored. Add or generate new ones if needed.');
  }

  async function cancelSession(s: DaySession) {
    setBusy(true);
    const { data: rows } = await supabase
      .from('bookings')
      .select('payment_status, status')
      .eq('session_id', s.id)
      .in('status', ['CONFIRMED', 'ON_HOLD']);
    setBusy(false);
    const total = (rows ?? []).length;
    const paid = (rows ?? []).filter((r) => r.payment_status === 'PAID').length;

    Alert.alert(
      'Cancel this session?',
      total === 0
        ? 'No patients are booked.'
        : `${total} patient(s) are booked and will be notified${paid > 0 ? `. ${paid} paid booking(s) are refunded in full` : ''}.`,
      [
        { text: 'Keep session', style: 'cancel' },
        {
          text: 'Cancel session',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            const { data, error: cancelError } = await supabase.rpc('cancel_session_notify', { p_session_id: s.id });
            setBusy(false);
            if (cancelError) {
              Alert.alert('Could not cancel', cancelError.message);
              return;
            }
            const r = (Array.isArray(data) ? data[0] : data) as { bookings_cancelled: number; refunds_started: number };
            afterChange(`${r.bookings_cancelled} booking(s) cancelled, ${r.refunds_started} refund(s) started.`);
          },
        },
      ]
    );
  }

  if (loading) return <LoadingView message="Loading calendar..." />;

  const monthLabel = new Date(Date.UTC(year, month, 1)).toLocaleDateString('en-IN', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.monthRow}>
        <Pressable onPress={() => shiftMonth(-1)} style={styles.monthButton}>
          <Text style={{ color: colors.primary, fontWeight: '700', fontSize: FontSize.heading }}>{'<'}</Text>
        </Pressable>
        <Text style={[styles.heading, { color: colors.text, marginTop: 0, marginBottom: 0 }]}>{monthLabel}</Text>
        <Pressable onPress={() => shiftMonth(1)} style={styles.monthButton}>
          <Text style={{ color: colors.primary, fontWeight: '700', fontSize: FontSize.heading }}>{'>'}</Text>
        </Pressable>
      </View>

      <View style={styles.weekRow}>
        {DAYS.map((d) => (
          <Text key={d.n} style={[styles.weekHeader, { color: colors.textMuted }]}>
            {d.l}
          </Text>
        ))}
      </View>

      {weeks.map((week, wi) => (
        <View key={wi} style={styles.weekRow}>
          {week.map((day, di) => {
            if (day === null) return <View key={di} style={styles.cell} />;
            const date = ymd(year, month, day);
            const past = date < today;
            const holiday = date in holidays;
            const isSel = selected === date;
            return (
              <Pressable
                key={di}
                disabled={past}
                onPress={() => setSelected(date)}
                style={[
                  styles.cell,
                  styles.cellBox,
                  {
                    backgroundColor: holiday ? colors.error : colors.cardBackground,
                    borderColor: isSel ? colors.primary : colors.border,
                    borderWidth: isSel ? 2 : 1,
                    opacity: past ? 0.35 : 1,
                  },
                ]}
              >
                <Text style={{ color: holiday ? '#FFFFFF' : colors.text, fontWeight: date === today ? '800' : '500' }}>
                  {day}
                </Text>
                {withSessions.has(date) ? (
                  <View style={[styles.dot, { backgroundColor: holiday ? '#FFFFFF' : colors.primary }]} />
                ) : null}
              </Pressable>
            );
          })}
        </View>
      ))}

      <Text style={[styles.help, { color: colors.textMuted, marginTop: Spacing.sm }]}>
        A dot means the day has sessions. Red means a holiday. Tap a date to manage it.
      </Text>

      {selected && !selectedPast ? (
        <View style={[styles.blockCard, { backgroundColor: colors.cardBackground, borderColor: colors.border }]}>
          <Text style={[styles.blockTitle, { color: colors.text }]}>{selected}</Text>

          {isHoliday ? (
            <Text style={[styles.help, { color: colors.error, fontWeight: '600' }]}>
              Holiday. No sessions or bookings are allowed on this day.
            </Text>
          ) : null}

          {daySessions.length === 0 ? (
            <Text style={[styles.help, { color: colors.textMuted }]}>No sessions on this day.</Text>
          ) : (
            daySessions.map((s) => (
              <View key={s.id} style={[styles.sessionRow, { borderColor: colors.border }]}>
                <Text style={[styles.label, { color: colors.text, marginTop: 0 }]}>
                  {nameFor(s.block_label, s.start_time)}: {formatTime(s.start_time)} - {formatTime(s.end_time)}
                </Text>
                <Text style={[styles.help, { color: colors.textMuted, marginBottom: Spacing.xs }]}>
                  {s.booking_mode === 'TOKEN' ? 'Token queue' : 'Time slots'} | capacity {s.capacity} | {s.status}
                </Text>
                {s.status === 'OPEN' || s.status === 'PAUSED' || s.status === 'DRAFT' ? (
                  <Button title="Cancel this session" onPress={() => cancelSession(s)} variant="danger" disabled={busy} />
                ) : null}
              </View>
            ))
          )}

          <View style={{ marginTop: Spacing.sm }}>
            {!isHoliday ? (
              <Button
                title="+ Add a session on this day"
                onPress={() =>
                  router.push({ pathname: '/doctor-portal/new-session', params: { date: selected, clinicId: dcId } } as any)
                }
                variant="secondary"
              />
            ) : null}
            {isDoctor ? (
              <View style={{ marginTop: Spacing.sm }}>
                {isHoliday ? (
                  <Button title="Remove holiday" onPress={removeHoliday} variant="secondary" loading={busy} />
                ) : (
                  <Button title="Mark as holiday" onPress={markHoliday} variant="danger" loading={busy} />
                )}
              </View>
            ) : null}
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
  topBar: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.md },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginBottom: Spacing.md },
  chip: { minHeight: 44, justifyContent: 'center', paddingHorizontal: Spacing.md, borderRadius: BorderRadius.lg, borderWidth: 1 },
  chipSmall: { minHeight: 40, justifyContent: 'center', paddingHorizontal: Spacing.md, borderRadius: BorderRadius.lg, borderWidth: 1 },
  label: { fontSize: FontSize.body, fontWeight: '600', marginBottom: Spacing.xs, marginTop: Spacing.sm },
  help: { fontSize: FontSize.small, marginBottom: Spacing.md },
  heading: { fontSize: FontSize.heading, fontWeight: '600', marginTop: Spacing.sm, marginBottom: Spacing.xs },
  blockCard: { borderWidth: 1, borderRadius: BorderRadius.lg, padding: Spacing.md, marginBottom: Spacing.md },
  blockHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.sm },
  blockTitle: { fontSize: FontSize.heading, fontWeight: '600', marginBottom: Spacing.xs },
  divider: { height: 1, marginVertical: Spacing.lg },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.md },
  monthButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  weekRow: { flexDirection: 'row', marginBottom: 4 },
  weekHeader: { flex: 1, textAlign: 'center', fontSize: FontSize.small, fontWeight: '600' },
  cell: { flex: 1, height: 48, marginHorizontal: 2 },
  cellBox: { borderRadius: BorderRadius.md, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 6, height: 6, borderRadius: 3, marginTop: 3 },
  sessionRow: { borderTopWidth: 1, paddingVertical: Spacing.sm },
});    