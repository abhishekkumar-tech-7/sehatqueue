import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const keyId = Deno.env.get('RAZORPAY_KEY_ID');
  const keySecret = Deno.env.get('RAZORPAY_KEY_SECRET');
  if (!keyId || !keySecret) return json({ error: 'Payments are not set up yet.' }, 500);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Please log in again.' }, 401);

  // deno-lint-ignore no-explicit-any
  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }

  const kind = body?.kind;
  const sessionId = body?.session_id;
  if ((kind !== 'token' && kind !== 'slot') || typeof sessionId !== 'string') {
    return json({ error: 'Invalid request.' }, 400);
  }

  // "user" acts as the logged-in patient. "admin" is only used for settings and bookkeeping.
  const user = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
  const admin = createClient(url, serviceKey);

  const { data: settings } = await admin
    .from('platform_settings')
    .select('online_payment_mode, route_enabled')
    .eq('id', true)
    .single();

  if (!settings || settings.online_payment_mode === 'OFF') {
    return json({ error: 'Online payment is not switched on.' }, 400);
  }

  // Find the doctor first, so we can refuse before reserving anything.
  const { data: sess } = await admin
    .from('clinic_sessions')
    .select('doctor_clinics(doctor_id)')
    .eq('id', sessionId)
    .single();
  // deno-lint-ignore no-explicit-any
  const doctorId = (sess as any)?.doctor_clinics?.doctor_id as string | undefined;
  if (!doctorId) return json({ error: 'Session not found.' }, 404);

  const useRoute = settings.online_payment_mode === 'FULL' && settings.route_enabled === true;
  let accountId: string | null = null;
  if (useRoute) {
    const { data: acc } = await admin
      .from('doctor_payout_accounts')
      .select('razorpay_account_id')
      .eq('doctor_id', doctorId)
      .maybeSingle();
    accountId = acc?.razorpay_account_id ?? null;
    if (!accountId) {
      return json({ error: "This doctor can't accept online payments yet. Please contact the clinic." }, 400);
    }
  }

  // Reserve the booking as PENDING, as the patient. The database works out every amount.
  const rpcName = kind === 'token' ? 'start_token_checkout' : 'start_slot_checkout';
  const args =
    kind === 'token'
      ? {
          p_session_id: sessionId,
          p_patients: body.patients,
          p_expected_total_paise: body.expected_total_paise ?? null,
        }
      : {
          p_session_id: sessionId,
          p_start_time: body.start_time,
          p_duration_minutes: body.duration_minutes ?? 15,
          p_expected_total_paise: body.expected_total_paise ?? null,
        };

  const { data: started, error: startError } = await user.rpc(rpcName, args);
  if (startError) return json({ error: startError.message }, 400);
  const row = Array.isArray(started) ? started[0] : started;
  if (!row) return json({ error: 'Could not start the payment.' }, 500);

  const abort = () => admin.rpc('abort_checkout', { p_order_id: row.out_order_id });

  if (useRoute && row.out_doctor_id !== doctorId) {
    await abort();
    return json({ error: 'Could not start the payment. Please try again.' }, 409);
  }

  // Ask Razorpay for the order, with the doctor's share as a transfer when Route is on.
  // deno-lint-ignore no-explicit-any
  const orderBody: Record<string, any> = {
    amount: row.out_amount_paise,
    currency: 'INR',
    receipt: row.out_order_id,
    notes: { internal_order_id: row.out_order_id },
  };

  let splitMethod: 'NONE' | 'ROUTE' | 'LEDGER' = 'NONE';
  if (row.out_pay_mode === 'FULL') {
    if (useRoute && accountId && row.out_doctor_share_paise > 0) {
      orderBody.transfers = [
        {
          account: accountId,
          amount: row.out_doctor_share_paise,
          currency: 'INR',
          notes: { internal_order_id: row.out_order_id },
          on_hold: false,
        },
      ];
      splitMethod = 'ROUTE';
    } else {
      splitMethod = 'LEDGER';
    }
  }

  // deno-lint-ignore no-explicit-any
  let razorpayOrder: any;
  try {
    const resp = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Basic ' + btoa(`${keyId}:${keySecret}`),
      },
      body: JSON.stringify(orderBody),
    });
    razorpayOrder = await resp.json();
    if (!resp.ok) {
      console.error('Razorpay order error', resp.status, JSON.stringify(razorpayOrder?.error ?? {}));
      await abort();
      return json({ error: 'Could not start the payment. Please try again.' }, 502);
    }
  } catch (e) {
    console.error('Razorpay request failed', String(e));
    await abort();
    return json({ error: 'Could not reach the payment service. Please try again.' }, 502);
  }

  const { error: attachError } = await admin.rpc('attach_razorpay_order', {
    p_order_id: row.out_order_id,
    p_razorpay_order_id: razorpayOrder.id,
    p_split_method: splitMethod,
  });
  if (attachError) {
    console.error('Attach failed', attachError.message);
    await abort();
    return json({ error: 'Could not start the payment. Please try again.' }, 500);
  }

  return json({
    order_id: row.out_order_id,
    razorpay_order_id: razorpayOrder.id,
    razorpay_key_id: keyId,
    amount_paise: row.out_amount_paise,
    currency: 'INR',
    hold_expires_at: row.out_hold_expires_at,
    split_method: splitMethod,
  });
});  