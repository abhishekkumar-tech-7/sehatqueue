import { createClient } from 'npm:@supabase/supabase-js@2';
import { processRefunds } from '../_shared/refunds.ts';

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
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Please log in again.' }, 401);

  // Only a logged-in user may trigger processing. It only moves refunds that are already due.
  const user = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data } = await user.auth.getUser();
  if (!data?.user) return json({ error: 'Please log in again.' }, 401);

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  try {
    return json(await processRefunds(admin));
  } catch (e) {
    console.error('processRefunds failed', String(e));
    return json({ error: 'Could not process refunds right now.' }, 500);
  }
});   