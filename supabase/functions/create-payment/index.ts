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

const rupees = (paise: number) => (paise / 100).toFixed(2);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const clientId = Deno.env.get('CASHFREE_CLIENT_ID');
  const clientSecret = Deno.env.get('CASHFREE_CLIENT_SECRET');
  const cfEnv = Deno.env.get('CASHFREE_ENV') === 'production' ? 'production' : 'sandbox';
  if (!clientId || !clientSecret) return json({ error: 'Payments are not set up yet.' }, 500);
  const base = cfEnv === 'production' ? 'https://api.cashfree.com' : 'https://sandbox.cashfree.com';

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

  const user = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
  const admin = createClient(url, serviceKey);

  const { data: userData } = await user.auth.getUser();
  const userId = userData?.user?.id;
  if (!userId) return json({ error: 'Please log in again.' }, 401);

  const { data: settings } = await admin
    .from('platform_settings')
    .select('route_enabled')
    .eq('id', true)
    .single();
  if (!settings) return json({ error: 'Payments are not set up yet.' }, 500);

  const { data: profile } = await admin.from('profiles').select('phone, email').eq('id', userId).single();
  const phone = (profile?.phone ?? '').replace(/\D/g, '').slice(-10);
  if (phone.length !== 10) {
    return json({ error: 'Please add a valid 10-digit phone number in Profile before paying.' }, 400);
  }

  const { data: sess } = await admin
    .from('clinic_sessions')
    .select('doctor_clinics(doctor_id)')
    .eq('id', sessionId)
    .single();
  // deno-lint-ignore no-explicit-any
  const doctorId = (sess as any)?.doctor_clinics?.doctor_id as string | undefined;
  if (!doctorId) return json({ error: 'Session not found.' }, 404);

  // The payment mode is set per doctor, falling back to the platform default.
  const { data: splitRows } = await admin.rpc('internal_payment_split', { p_doctor_id: doctorId });
  const split = Array.isArray(splitRows) ? splitRows[0] : splitRows;
  if (!split || split.fee_mode === 'OFF') {
    return json({ error: 'Online payment is not switched on for this doctor.' }, 400);
  }
  const useSplit = split.fee_mode === 'FULL' && settings.route_enabled === true;
  let vendorId: string | null = null;
  if (useSplit) {
    const { data: acc } = await admin    
      .from('doctor_payout_accounts')
      .select('vendor_id')
      .eq('doctor_id', doctorId)
      .maybeSingle();
    vendorId = acc?.vendor_id ?? null;
    if (!vendorId) {
      return json({ error: "This doctor can't accept online payments yet. Please contact the clinic." }, 400);
    }
  }

  // Reserve PENDING bookings as the patient. The database works out every amount.
  const rpcName = kind === 'token' ? 'start_token_checkout' : 'start_slot_checkout';
  const args =
    kind === 'token'
      ? { p_session_id: sessionId, p_patients: body.patients, p_expected_total_paise: body.expected_total_paise ?? null }
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

  if (useSplit && row.out_doctor_id !== doctorId) {
    await abort();
    return json({ error: 'Could not start the payment. Please try again.' }, 409);
  }

  // Our internal order UUID is also the Cashfree order_id.
  // deno-lint-ignore no-explicit-any
  const orderBody: Record<string, any> = {
    order_id: row.out_order_id,
    order_amount: rupees(row.out_amount_paise),
    order_currency: 'INR',
    customer_details: {
      customer_id: userId,
      customer_phone: phone,
      ...(profile?.email ? { customer_email: profile.email } : {}),
    },
    order_meta: {
      notify_url:
        Deno.env.get('CASHFREE_NOTIFY_URL') ?? `${url}/functions/v1/cashfree-webhook`,
      ...(Deno.env.get('CASHFREE_RETURN_URL') ? { return_url: Deno.env.get('CASHFREE_RETURN_URL') } : {}),
    },
  };

  let splitMethod: 'NONE' | 'SPLIT' | 'LEDGER' = 'NONE';
  if (row.out_pay_mode === 'FULL') {
    if (useSplit && vendorId && row.out_doctor_share_paise > 0) {
      // Easy Split: the doctor's share goes to the vendor; the platform keeps the remainder.
      orderBody.order_splits = [{ vendor_id: vendorId, amount: rupees(row.out_doctor_share_paise) }];
      splitMethod = 'SPLIT';
    } else {
      splitMethod = 'LEDGER';
    }
  }

  // deno-lint-ignore no-explicit-any
  let cfOrder: any;
  try {
    const resp = await fetch(`${base}/pg/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-version': '2023-08-01',
        'x-client-id': clientId,
        'x-client-secret': clientSecret,
      },
      body: JSON.stringify(orderBody),
    });
    cfOrder = await resp.json();
    if (!resp.ok) {
      console.error('Cashfree order error', resp.status, JSON.stringify({ code: cfOrder?.code, message: cfOrder?.message }));
      await abort();
      return json({ error: 'Could not start the payment. Please try again.' }, 502);
    }
  } catch (e) {
    console.error('Cashfree request failed', String(e));
    await abort();
    return json({ error: 'Could not reach the payment service. Please try again.' }, 502);
  }

  const { error: attachError } = await admin.rpc('attach_gateway_order', {
    p_order_id: row.out_order_id,
    p_gateway_order_id: cfOrder.order_id,
    p_split_method: splitMethod,
  });
  if (attachError) {
    console.error('Attach failed', attachError.message);
    await abort();
    return json({ error: 'Could not start the payment. Please try again.' }, 500);
  }

  return json({
    order_id: row.out_order_id,
    payment_session_id: cfOrder.payment_session_id,
    cashfree_env: cfEnv,
    amount_paise: row.out_amount_paise,
    currency: 'INR',
    hold_expires_at: row.out_hold_expires_at,
    split_method: splitMethod,
  });
});   