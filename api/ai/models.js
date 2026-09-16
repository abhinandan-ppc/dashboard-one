import { verifySession, readCookie } from '../_session.js';
import { resolveAccess } from '../_acl.js';

export const config = { runtime: 'nodejs' };

const OMNIROUTE_KEY = process.env.OMNIROUTE_KEY;

const OMNIROUTE_ENDPOINTS = {
  intranet: process.env.OMNIROUTE_URL_INTRANET,
  ngrok: process.env.OMNIROUTE_URL_NGROK,
  cloudflare: process.env.OMNIROUTE_URL_CLOUDFLARE,
};

// Curated model categories with display names
const CATEGORIES = {
  auto: {
    label: 'Auto',
    icon: '🤖',
    description: 'Smart routing — picks the best model for your prompt',
    models: [
      { id: 'auto/best-coding', name: 'Best Coding', desc: 'Optimized for code tasks' },
      { id: 'auto/best-fast', name: 'Best Fast', desc: 'Fastest response time' },
      { id: 'auto/best-free', name: 'Best Free', desc: 'Free tier models' },
      { id: 'auto/best-chat', name: 'Best Chat', desc: 'Best for conversation' },
      { id: 'auto/best-reasoning', name: 'Best Reasoning', desc: 'Deep thinking & analysis' },
      { id: 'auto/best-vision', name: 'Best Vision', desc: 'Image understanding' },
      { id: 'auto/best-chaos', name: 'Best Chaos', desc: 'Unpredictable & creative' },
    ],
  },
  chat: {
    label: 'Chat',
    icon: '💬',
    description: 'Flagship general-purpose models',
    models: [
      { id: 'oc/claude-opus-5', name: 'Claude Opus 5', desc: 'Anthropic flagship' },
      { id: 'oc/claude-sonnet-5', name: 'Claude Sonnet 5', desc: 'Fast & capable' },
      { id: 'oc/gpt-5.5', name: 'GPT-5.5', desc: 'OpenAI latest' },
      { id: 'oc/gemini-3.5-flash', name: 'Gemini 3.5 Flash', desc: 'Google fast model' },
      { id: 'oc/grok-4.5', name: 'Grok 4.5', desc: 'xAI model' },
      { id: 'vag/openai/gpt-5.5', name: 'GPT-5.5 (VAG)', desc: 'Via Vercel AI Gateway' },
      { id: 'vag/anthropic/claude-opus-5', name: 'Claude Opus 5 (VAG)', desc: 'Via Vercel AI Gateway' },
      { id: 'oc/deepseek-v4-pro', name: 'DeepSeek V4 Pro', desc: 'DeepSeek flagship' },
      { id: 'oc/minimax-m3', name: 'MiniMax M3', desc: 'MiniMax model' },
      { id: 'oc/qwen3.6-plus', name: 'Qwen 3.6 Plus', desc: 'Alibaba model' },
    ],
  },
  coding: {
    label: 'Code',
    icon: '💻',
    description: 'Specialized for coding & development',
    models: [
      { id: 'auto/best-coding', name: 'Auto Coding', desc: 'Smart code routing' },
      { id: 'kilocode/anthropic/claude-sonnet-4.6', name: 'Claude Sonnet 4.6', desc: 'Kilocode optimized' },
      { id: 'kilocode/anthropic/claude-opus-4.7', name: 'Claude Opus 4.7', desc: 'Kilocode optimized' },
      { id: 'kilocode/openai/gpt-5.5', name: 'GPT-5.5', desc: 'Kilocode optimized' },
      { id: 'kiro/claude-sonnet-4.5', name: 'Kiro Claude 4.5', desc: 'Amazon Kiro' },
      { id: 'oc/gpt-5-codex', name: 'GPT-5 Codex', desc: 'OpenAI code model' },
      { id: 'vag/mistral/codestral', name: 'Codestral', desc: 'Mistral code model' },
      { id: 'vag/moonshotai/kimi-k3', name: 'Kimi K3', desc: 'Moonshot code model' },
      { id: 'kimi-coding/kimi-for-coding', name: 'Kimi for Coding', desc: 'Kimi specialized' },
      { id: 'vag/mistral/devstral-2', name: 'Devstral 2', desc: 'Mistral dev model' },
    ],
  },
  image: {
    label: 'Image',
    icon: '🎨',
    description: 'Image generation & understanding',
    models: [
      { id: 'openai/chatgpt-image-latest', name: 'ChatGPT Image', desc: 'OpenAI image gen' },
      { id: 'openai/gpt-image-2', name: 'GPT Image 2', desc: 'Latest OpenAI images' },
      { id: 'openai/gpt-image-1', name: 'GPT Image 1', desc: 'OpenAI image gen' },
      { id: 'vag/google/gemini-3.1-flash-image', name: 'Gemini Image', desc: 'Google image gen' },
      { id: 'nvidia/black-forest-labs/flux.2-klein-4b', name: 'Flux 2 Klein', desc: 'NVIDIA Flux' },
      { id: 'vag/spacexai/grok-imagine-image-2.0', name: 'Grok Image 2.0', desc: 'xAI image gen' },
      { id: 'vag/recraft/recraft-v4.1-pro', name: 'Recraft v4.1 Pro', desc: 'Design-focused' },
      { id: 'vag/meta/muse-spark-1.2', name: 'Muse Spark 1.2', desc: 'Meta image gen' },
    ],
  },
  video: {
    label: 'Video',
    icon: '🎬',
    description: 'Video generation & animation',
    models: [
      { id: 'vag/google/veo-3.1-generate-001', name: 'Veo 3.1', desc: 'Google video gen' },
      { id: 'vag/google/veo-3.1-fast-generate-001', name: 'Veo 3.1 Fast', desc: 'Google fast video' },
      { id: 'vag/klingai/kling-v3.0-t2v', name: 'Kling v3.0', desc: 'Text-to-video' },
      { id: 'vag/klingai/kling-v3.0-i2v', name: 'Kling v3.0 I2V', desc: 'Image-to-video' },
      { id: 'vag/alibaba/wan-v3.0-video', name: 'Wan v3.0', desc: 'Alibaba video gen' },
      { id: 'vag/spacexai/grok-imagine-video-1.5', name: 'Grok Video 1.5', desc: 'xAI video gen' },
      { id: 'openai/sora-2', name: 'Sora 2', desc: 'OpenAI video gen' },
    ],
  },
  free: {
    label: 'Free',
    icon: '🆓',
    description: 'No-cost models — great for testing',
    models: [
      { id: 'openrouter/z-ai/glm-5.2:free', name: 'GLM 5.2', desc: 'Zhipu AI free' },
      { id: 'kg/nvidia/nemotron-3-ultra-550b-a55b:free', name: 'Nemotron Ultra', desc: 'NVIDIA 550B free' },
      { id: 'oc/mimo-v2.5-free', name: 'Mimo v2.5', desc: 'Xiaomi free' },
      { id: 'oc/deepseek-v4-flash-free', name: 'DeepSeek V4 Flash', desc: 'DeepSeek free' },
      { id: 'vag/minimax/minimax-m2.7-free', name: 'MiniMax M2.7', desc: 'MiniMax free' },
      { id: 'vag/poolside/laguna-s-2.1-free', name: 'Laguna S 2.1', desc: 'Poolside free' },
      { id: 'oc/nemotron-3-ultra-free', name: 'Nemotron Ultra', desc: 'NVIDIA free' },
      { id: 'oc/nemotron-3.5-lightning-free', name: 'Nemotron Lightning', desc: 'NVIDIA fast free' },
      { id: 'kg/openrouter/free', name: 'OpenRouter Free', desc: 'Auto free routing' },
    ],
  },
};

let cachedModels = null;
let cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

async function fetchOmniRouteModels(endpoint) {
  const now = Date.now();
  if (cachedModels && (now - cacheTime) < CACHE_TTL) {
    return cachedModels;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const base = String(OMNIROUTE_ENDPOINTS[endpoint] || '').trim().replace(/\/+$/, '');
    if (!base || !OMNIROUTE_KEY) return null;
    const res = await fetch(base + '/models', {
      headers: { 'Authorization': `Bearer ${OMNIROUTE_KEY}` },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) return null;

    const data = await res.json();
    const modelIds = (data.data || []).map(m => m.id);

    // Verify which curated models actually exist on this endpoint
    const result = {};
    for (const [catKey, cat] of Object.entries(CATEGORIES)) {
      result[catKey] = {
        ...cat,
        models: cat.models.filter(m => modelIds.includes(m.id)),
      };
    }

    cachedModels = result;
    cacheTime = now;
    return result;
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

export default async function handler(req) {
  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
  const session = await verifySession(readCookie(req, 'session'));
  if (!session) {
    return json({ error: 'Unauthorized' }, 401);
  }

  let admin = false;
  try {
    ({ admin } = await resolveAccess(session.email));
  } catch {
    admin = false;
  }

  if (!admin) {
    return json({ error: 'Access denied' }, 403);
  }

  const url = new URL(req.url);
  const endpoint = url.searchParams.get('endpoint') || 'cloudflare';

  // Try the requested endpoint first, then fallbacks
  const priorities = [endpoint, 'cloudflare', 'ngrok', 'intranet'];
  let models = null;

  for (const ep of priorities) {
    if (!OMNIROUTE_ENDPOINTS[ep]) continue;
    models = await fetchOmniRouteModels(ep);
    if (models) break;
  }

  if (!models) {
    // Return static categories even if we can't verify
    return json({ categories: CATEGORIES, verified: false });
  }

  return json({ categories: models, verified: true });
}
