/**
 * Supabase Edge Function: openai-vision
 *
 * Прокси между фронтендом и OpenAI Vision API.
 * Ключ OPENAI_API_KEY хранится в Supabase Secrets — никогда не попадает в код.
 *
 * Развёртывание:
 *   supabase functions deploy openai-vision
 *   supabase secrets set OPENAI_API_KEY=sk-...
 *
 * Или через Dashboard:
 *   Settings → Edge Functions → openai-vision → Secrets → OPENAI_API_KEY
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  /* CORS preflight */
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    /* Проверка авторизации: только залогиненные пользователи */
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    /* Тело запроса от фронта. Поддерживает и старые gpt-4o-подобные
       параметры (max_tokens/temperature), и новые gpt-5.x reasoning-
       параметры (max_completion_tokens/reasoning.effort). Функция
       определяет, какую схему использовать, по имени модели. */
    const body = await req.json();
    const {
      messages,
      max_tokens,
      max_completion_tokens,
      temperature,
      reasoning,
      model = 'gpt-5.4-mini',
    } = body;

    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: 'messages required' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    /* Ключ из Supabase Secrets — никогда не уходит в браузер */
    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiKey) {
      return new Response(JSON.stringify({ error: 'OpenAI key not configured on server' }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    /* Определяем схему параметров по модели.
       gpt-5.x — reasoning серия: max_completion_tokens + reasoning.effort,
                 temperature не поддерживается.
       gpt-4o/4o-mini — классика: max_tokens + temperature. */
    const isReasoning = /^(gpt-5|o\d)/i.test(String(model));
    // deno-lint-ignore no-explicit-any
    const openaiBody: Record<string, any> = { model, messages };

    if (isReasoning) {
      openaiBody.max_completion_tokens = max_completion_tokens ?? max_tokens ?? 4000;
      openaiBody.reasoning = reasoning ?? { effort: 'low' };
    } else {
      openaiBody.max_tokens = max_tokens ?? max_completion_tokens ?? 4000;
      openaiBody.temperature = temperature ?? 0.1;
    }

    /* Запрос к OpenAI.
       По умолчанию используем gpt-5.4-mini — reasoning-модель с vision,
       $0.75/$4.50 за миллион токенов. Фронт может переопределить model. */
    const openaiResp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiKey}`,
      },
      body: JSON.stringify(openaiBody),
    });

    const data = await openaiResp.json();

    return new Response(JSON.stringify(data), {
      status: openaiResp.status,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
});
