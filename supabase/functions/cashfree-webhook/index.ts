import { createClient } from 'npm:@supabase/supabase-js@2';
import { processRefunds } from '../_shared/refunds.ts';
// Cashfree signs: base64( HMAC-SHA256( timestamp + rawBody, client_secret ) )
async function sign(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)));
  let bin = '';
  for (const b of sig) bin += String.fromCharCode(b);
  return btoa(bin);
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const secret = Deno.env.get('CASHFREE_CLIENT_SECRET');
  if (!secret) return new Response('Not configured', { status: 500 });

  const raw = await req.text();
  const timestamp = req.headers.get('x-webhook-timestamp') ?? '';
  const received = req.headers.get('x-webhook-signature') ?? '';
  const expected = await sign(secret, timestamp + raw);
  if (!timestamp || !received || !safeEqual(received, expected)) {
    return new Response('Invalid signature', { status: 400 });
  }

  // deno-lint-ignore no-explicit-any
  let event: any;
  try {
    event = JSON.parse(raw);
  } catch {
    return new Response('Bad body', { status: 400 });
  }

  const type = event?.type as string | undefined;
  // Only successful payments confirm a booking. Everything else is acknowledged and ignored.
  // Refund status updates from Cashfree.
  if (type === 'REFUND_STATUS_WEBHOOK') {
    const refund = event?.data?.refund;
    const st = String(refund?.refund_status ?? '').toUpperCase();
    const rid = String(refund?.refund_id ?? '');
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rid);
    if (isUuid && (st === 'SUCCESS' || st === 'CANCELLED' || st === 'FAILED')) {
      const adminR = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
      const { error: markError } = await adminR.rpc('internal_mark_refund', {
        p_refund_id: rid,
        p_status: st === 'SUCCESS' ? 'SUCCESS' : 'FAILED',
        p_gateway_refund_id: refund?.cf_refund_id ? String(refund.cf_refund_id) : null,
        p_failure: st === 'SUCCESS' ? null : String(refund?.status_description ?? st),
      });
      if (markError) {
        console.error('refund mark failed', rid, markError.message);
        return new Response('Retry', { status: 500 });
      }
    }
    return new Response('ok', { status: 200 });
  }
  if (type !== 'PAYMENT_SUCCESS_WEBHOOK') return new Response('ok', { status: 200 });

  const orderId = event?.data?.order?.order_id as string | undefined;
  const payment = event?.data?.payment;
  if (!orderId || !payment || payment.payment_status !== 'SUCCESS') {
    return new Response('ok', { status: 200 });
  }

  const amountPaise = Math.round(Number(payment.payment_amount) * 100);
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data, error } = await admin.rpc('confirm_payment', {
    p_gateway_order_id: orderId,
    p_gateway_payment_id: String(payment.cf_payment_id),
    p_amount_paise: amountPaise,
  });

  if (error) {
    console.error('confirm_payment failed', orderId, error.message);
    return new Response('Retry', { status: 500 }); // Cashfree retries
  }
  if (data === 'REFUND_DUE') {
    console.error('REFUND DUE for order', orderId);
    try {
      await processRefunds(admin);
    } catch (e) {
      console.error('processRefunds failed', String(e));
    }
  }

  await admin.from('payment_events').insert({      
    gateway_event_id: `${type}:${payment.cf_payment_id}`,
    event_type: type,
  });
  return new Response('ok', { status: 200 });
});   