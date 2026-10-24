// deno-lint-ignore-file no-explicit-any
const API_VERSION = '2023-08-01';

const rupees = (paise: number) => (paise / 100).toFixed(2);

function mapStatus(s: string | undefined): 'SUCCESS' | 'FAILED' | 'PENDING' {
  const v = (s ?? '').toUpperCase();
  if (v === 'SUCCESS') return 'SUCCESS';
  if (v === 'CANCELLED' || v === 'FAILED') return 'FAILED';
  return 'PENDING';
}

// Sends new refunds to Cashfree and checks on the ones still in progress.
// Safe to run any number of times: each refund has its own id, and a refund is
// claimed (REQUESTED -> PROCESSING) before it is sent.
export async function processRefunds(admin: any) {
  const clientId = Deno.env.get('CASHFREE_CLIENT_ID');
  const clientSecret = Deno.env.get('CASHFREE_CLIENT_SECRET');
  if (!clientId || !clientSecret) throw new Error('Cashfree keys are not set.');
  const base =
    Deno.env.get('CASHFREE_ENV') === 'production' ? 'https://api.cashfree.com' : 'https://sandbox.cashfree.com';
  const headers = {
    'Content-Type': 'application/json',
    'x-api-version': API_VERSION,
    'x-client-id': clientId,
    'x-client-secret': clientSecret,
  };

  const mark = (id: string, status: string, gatewayId: string | null = null, failure: string | null = null) =>
    admin.rpc('internal_mark_refund', {
      p_refund_id: id,
      p_status: status,
      p_gateway_refund_id: gatewayId,
      p_failure: failure,
    });

  const result = { sent: 0, completed: 0, failed: 0, retry: 0 };

  // 1. Send newly requested refunds.
  const { data: claimed } = await admin.rpc('claim_refunds', { p_limit: 20 });
  for (const r of claimed ?? []) {
    try {
      if (!r.gateway_order_id) {
        await mark(r.refund_id, 'FAILED', null, 'The order has no payment gateway id.');
        result.failed++;
        continue;
      }
      const resp = await fetch(`${base}/pg/orders/${r.gateway_order_id}/refunds`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          refund_id: r.refund_id,
          refund_amount: Number(rupees(r.amount_paise)),
          refund_speed: 'STANDARD',
          refund_note: String(r.reason).slice(0, 50),
        }),
      });
      const j = await resp.json().catch(() => ({}));

      if (resp.ok) {
        const st = mapStatus(j.refund_status);
        const gid = j.cf_refund_id ? String(j.cf_refund_id) : null;
        if (st === 'SUCCESS') {
          await mark(r.refund_id, 'SUCCESS', gid);
          result.completed++;
        } else if (st === 'FAILED') {
          await mark(r.refund_id, 'FAILED', gid, j.status_description ?? 'Refund was cancelled');
          result.failed++;
        } else {
          await mark(r.refund_id, 'PROCESSING', gid);
          result.sent++;
        }
        continue;
      }

      // Temporary problem: try again later.
      if (resp.status >= 500 || resp.status === 429) {
        await mark(r.refund_id, 'REQUESTED');
        result.retry++;
        continue;
      }

      // Maybe it was already created on an earlier attempt.
      const existing = await fetch(`${base}/pg/orders/${r.gateway_order_id}/refunds/${r.refund_id}`, { headers });
      if (existing.ok) {
        const e = await existing.json().catch(() => ({}));
        const st = mapStatus(e.refund_status);
        await mark(r.refund_id, st === 'PENDING' ? 'PROCESSING' : st, e.cf_refund_id ? String(e.cf_refund_id) : null,
          st === 'FAILED' ? e.status_description ?? 'Refund failed' : null);
        continue;
      }

      console.error('Refund rejected', r.refund_id, resp.status, JSON.stringify({ code: j?.code, message: j?.message }));
      await mark(r.refund_id, 'FAILED', null, `${j?.code ?? resp.status}: ${j?.message ?? 'Refund rejected'}`.slice(0, 300));
      result.failed++;
    } catch (e) {
      console.error('Refund send failed', r.refund_id, String(e));
      await mark(r.refund_id, 'REQUESTED');
      result.retry++;
    }
  }

  // 2. Check on refunds that are still in progress.
  const { data: processing } = await admin.rpc('list_processing_refunds', { p_limit: 20 });
  for (const r of processing ?? []) {
    try {
      const resp = await fetch(`${base}/pg/orders/${r.gateway_order_id}/refunds/${r.refund_id}`, { headers });
      if (resp.ok) {
        const e = await resp.json().catch(() => ({}));
        const st = mapStatus(e.refund_status);
        if (st === 'SUCCESS') {
          await mark(r.refund_id, 'SUCCESS', e.cf_refund_id ? String(e.cf_refund_id) : null);
          result.completed++;
        } else if (st === 'FAILED') {
          await mark(r.refund_id, 'FAILED', null, e.status_description ?? 'Refund failed');
          result.failed++;
        }
      } else if (resp.status === 404 && r.age_seconds > 120) {
        // Cashfree never received it. Put it back in the queue.
        await mark(r.refund_id, 'REQUESTED');
        result.retry++;
      }
    } catch (e) {
      console.error('Refund check failed', r.refund_id, String(e));
    }
  }

  return result;
}    