import { createClient } from 'npm:@supabase/supabase-js@2';

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const secret = Deno.env.get('RAZORPAY_WEBHOOK_SECRET');
  if (!secret) return new Response('Not configured', { status: 500 });

  // The signature is calculated over the exact raw body, so read it as text first.
  const raw = await req.text();
  const received = req.headers.get('x-razorpay-signature') ?? '';
  const expected = await hmacHex(secret, raw);
  if (!safeEqual(expected, received)) {
    return new Response('Invalid signature', { status: 400 });
  }

  // deno-lint-ignore no-explicit-any
  let event: any;
  try {
    event = JSON.parse(raw);
  } catch {
    return new Response('Bad request', { status: 400 });
  }

  const type = String(event?.event ?? '');
  if (type !== 'order.paid' && type !== 'payment.captured') {
    return new Response('Ignored', { status: 200 });
  }

  const payment = event?.payload?.payment?.entity;
  if (!payment?.order_id || !payment?.id || typeof payment.amount !== 'number') {
    return new Response('Ignored', { status: 200 });
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // confirm_payment is safe to run more than once, so duplicate events cause no harm.
  const { data, error } = await admin.rpc('confirm_payment', {
    p_razorpay_order_id: payment.order_id,
    p_razorpay_payment_id: payment.id,
    p_amount_paise: payment.amount,
  });

  if (error) {
    const message = error.message ?? '';
    if (message.includes('Unknown order') || message.includes('does not match')) {
      // Retrying cannot fix these, so acknowledge and log for a person to look at.
      console.error('Payment could not be matched:', payment.id, message);
      return new Response('Ignored', { status: 200 });
    }
    console.error('confirm_payment failed:', message);
    return new Response('Error', { status: 500 }); // Razorpay will retry
  }

  if (data === 'REFUND_DUE') {
    // The spot was already released. Automatic refunds are added in the next step.
    console.warn('REFUND DUE for payment', payment.id, 'order', payment.order_id);
  }

  // Keep a small record for audit; ignore duplicates.
  const eventId = req.headers.get('x-razorpay-event-id');
  if (eventId) {
    await admin.from('payment_events').insert({ razorpay_event_id: eventId, event_type: type });
  }

  return new Response('OK', { status: 200 });
});  