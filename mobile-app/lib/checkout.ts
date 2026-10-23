import { supabase } from './supabase';

export type FeeQuote = {
  consultation_paise: number;
  platform_paise: number;
  total_paise: number;
  online_paise: number;
  clinic_paise: number;
  pay_mode: 'OFF' | 'PLATFORM_FEE_ONLY' | 'FULL';
};

export async function getFeeQuote(sessionId: string): Promise<FeeQuote | null> {
  const { data, error } = await supabase.rpc('get_session_fee_quote', { p_session_id: sessionId });
  if (error || !data) return null;
  return ((Array.isArray(data) ? data[0] : data) as FeeQuote) ?? null;
}

type StartResult =
  | { ok: true; data: { order_id: string; payment_session_id: string; cashfree_env: string; amount_paise: number } }
  | { ok: false; message: string };

// The app never sends an amount. The server works it out and returns what to pay.
// deno-lint-ignore no-explicit-any
export async function startPayment(body: Record<string, any>): Promise<StartResult> {
  const { data, error } = await supabase.functions.invoke('create-payment', { body });
  if (error) {
    let message = 'Could not start the payment. Please try again.';
    try {
      // deno-lint-ignore no-explicit-any
      const j = await (error as any).context?.json();
      if (j?.error) message = j.error;
    } catch {}
    return { ok: false, message };
  }
  return { ok: true, data };
}   