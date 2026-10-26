import { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, useColorScheme, Alert, Linking } from 'react-native';
import { Stack, useLocalSearchParams, router } from 'expo-router';
import { WebView } from 'react-native-webview';
import { Button } from '../../components/Button';
import { supabase } from '../../lib/supabase';
import Colors from '../../constants/Colors';
import { Spacing, FontSize } from '../../constants/Spacing';

type Phase = 'checkout' | 'paid' | 'failed';

// Opens the chosen UPI app (PhonePe, Google Pay, Paytm...). Returns false if it can't.
async function openUpiApp(url: string): Promise<boolean> {
  try {
    // Android "intent://pay?...#Intent;scheme=upi;package=...;end" -> "upi://pay?..."
    const m = url.match(/^intent:\/\/(.*?)#Intent;(.*)$/);
    if (m) {
      const scheme = (m[2].match(/scheme=([^;]+)/) || [])[1] || 'upi';
      await Linking.openURL(`${scheme}://${m[1]}`);
      return true;
    }
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}

export default function PayScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme as 'light' | 'dark'];
  // "sessionId" here is the Cashfree payment session, not the clinic session.
  const { orderId, sessionId, env, amountPaise } = useLocalSearchParams<{
    orderId: string;
    sessionId: string;
    env: string;
    amountPaise: string;
  }>();

  const [phase, setPhase] = useState<Phase>('checkout');
  const [note, setNote] = useState('');
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const mode = env === 'production' ? 'production' : 'sandbox';

  const html = `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<script src="https://sdk.cashfree.com/js/v3/cashfree.js"></script>
</head><body style="font-family:sans-serif;text-align:center;padding:24px">
<p>Opening secure payment...</p>
<script>
  function send(o){ window.ReactNativeWebView.postMessage(JSON.stringify(o)); }
  try {
    var cashfree = Cashfree({ mode: "${mode}" });
    cashfree.checkout({ paymentSessionId: ${JSON.stringify(sessionId)}, redirectTarget: "_self" })
      .then(function(r){ send({ type: "done", error: r && r.error ? r.error.message : null }); })
      .catch(function(e){ send({ type: "done", error: String(e) }); });
  } catch (e) { send({ type: "done", error: String(e) }); }
</script></body></html>`;

  // Normal web pages stay inside the app. Anything else (upi://, intent://, phonepe://) opens the app.
  function handleNavigation(req: { url: string }) {
    const u = req.url;
    if (/^(https?:|about:|data:|blob:)/i.test(u)) return true;
    openUpiApp(u).then((ok) => {
      if (!ok) setNote('Could not open that UPI app. Pick another UPI app or scan the QR code.');
    });
    return false;
  }

  async function checkOnce(manual = false) {
    const { data } = await supabase.from('payment_orders').select('status').eq('id', orderId).single();
    if (manual && data?.status === 'CREATED') {
      setNote('Not paid yet. Choose a payment option above and complete it.');
    }
    if (data?.status === 'PAID') {
      stop();
      setPhase('paid');
    } else if (data?.status === 'FAILED' || data?.status === 'EXPIRED' || data?.status === 'REFUND_DUE') {
      stop();
      setPhase('failed');
    }
  }

  function stop() {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  }

  // Watch the order from the moment this screen opens. The web view stays on screen the whole time,
  // so a card or UPI step can finish. Only the server (the webhook) marks the order PAID.
  useEffect(() => {
    let tries = 0;
    timer.current = setInterval(() => {
      tries += 1;
      checkOnce();
      if (tries >= 200) {
        stop();
        setPhase('failed');
      }
    }, 3000);
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleGiveUp() {
    const { error } = await supabase.rpc('cancel_pending_order', { p_order_id: orderId });
    if (error) {
      Alert.alert('Could not cancel', error.message);
      return;
    }
    stop();
    router.back();
  }

  if (phase === 'paid') {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: 'Payment', headerBackVisible: false }} />
        <Text style={[styles.big, { color: colors.success }]}>Payment received</Text>
        <Text style={[styles.body, { color: colors.text }]}>Your booking is confirmed.</Text>
        <View style={{ height: Spacing.lg }} />
        <Button title="View my bookings" onPress={() => router.replace('/(tabs)/bookings' as any)} variant="primary" />
      </View>
    );
  }

  if (phase === 'failed') {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: 'Payment' }} />
        <Text style={[styles.big, { color: colors.warning }]}>Payment not completed</Text>
        <Text style={[styles.body, { color: colors.textMuted }]}>
          If money was deducted, your booking will be confirmed shortly or refunded automatically. Check My Bookings in a minute.
        </Text>
        <View style={{ height: Spacing.lg }} />
        <Button title="Go to my bookings" onPress={() => router.replace('/(tabs)/bookings' as any)} variant="primary" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen options={{ title: 'Pay Rs ' + (Number(amountPaise) / 100).toFixed(2) }} />
      <WebView
        originWhitelist={['*']}
        source={{ html, baseUrl: 'https://sdk.cashfree.com' }}
        javaScriptEnabled
        domStorageEnabled
        thirdPartyCookiesEnabled
        setSupportMultipleWindows={false}
        onShouldStartLoadWithRequest={handleNavigation}
        onMessage={(e) => {
          try {
            const msg = JSON.parse(e.nativeEvent.data);
            if (msg.type === 'done') {
              if (msg.error) setNote('Payment window: ' + msg.error);
              checkOnce();
            }
          } catch {
            checkOnce();   
          }
        }}
        style={{ flex: 1 }}
      />
      <View style={{ padding: Spacing.md }}>
        <Text style={[styles.body, { color: colors.textMuted, marginBottom: Spacing.sm }]}>
          {note || 'Complete the payment above. Your booking is confirmed automatically.'}
        </Text>
        <Button title="I have paid - check now" onPress={() => checkOnce(true)} variant="primary" />
        <View style={{ height: Spacing.sm }} />
        <Button title="Cancel payment" onPress={handleGiveUp} variant="secondary" />
      </View>    
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.lg },
  big: { fontSize: FontSize.title, fontWeight: 'bold', textAlign: 'center' },
  body: { fontSize: FontSize.body, marginTop: Spacing.sm, textAlign: 'center' },
});      