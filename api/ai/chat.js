import { verifySession, readCookie } from '../_session.js';
import { resolveAccess } from '../_acl.js';

// Force Edge runtime — prevents Vercel Node.js bundler from pulling this
// into the middleware bundle (which causes "unsupported modules" errors).
export const config = { runtime: 'edge' };

const OMNIROUTE_KEY = process.env.OMNIROUTE_KEY;

const OMNIROUTE_ENDPOINTS = {
  intranet: process.env.OMNIROUTE_URL_INTRANET,
  ngrok: process.env.OMNIROUTE_URL_NGROK,
  cloudflare: process.env.OMNIROUTE_URL_CLOUDFLARE,
};

const MAX_BODY_BYTES = 2_000_000;
const MAX_MESSAGES = 40;
const MAX_MESSAGE_CHARS = 20_000;
const MAX_ATTACHMENTS = 4;
const MAX_ATTACHMENT_CHARS = 600_000;
const ALLOWED_ENDPOINTS = new Set(['intranet', 'ngrok', 'cloudflare']);

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function isValidModel(model) {
  return typeof model === 'string' && model.length > 0 && model.length <= 200 && !/[\u0000-\u001f\u007f]/.test(model);
}

function normalizeEndpoint(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function buildOmniRouteMessages(history, attachments) {
  const messages = [];

  for (const msg of history) {
    if (msg.role === 'user' && attachments && attachments.length) {
      const content = [];
      content.push({ type: 'text', text: msg.content });
      for (const att of attachments) {
        if (att.type.startsWith('image/')) {
          const base64Data = att.data.split(',')[1] || att.data;
          content.push({
            type: 'image_url',
            image_url: { url: 'data:' + att.type + ';base64,' + base64Data }
          });
        } else {
          content.push({ type: 'text', text: `\n\n[File: ${att.name}]\n${att.data}` });
        }
      }
      messages.push({ role: 'user', content });
    } else {
      messages.push({ role: msg.role, content: msg.content });
    }
  }

  return messages;
}

export default async function handler(req) {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  try {
    const session = await verifySession(readCookie(req, 'session'));
    if (!session) {
      return json({ error: 'Unauthorized' }, 401);
    }

    let admin = false;
    try {
      ({ admin } = await resolveAccess(session.email));
    } catch (e) {
      console.error('resolveAccess error:', e);
      admin = false;
    }

    if (!admin) {
      return json({ error: 'Access denied' }, 403);
    }

    let body;
    try {
      const contentLength = Number(req.headers.get('content-length') || 0);
      if (contentLength > MAX_BODY_BYTES) return json({ error: 'Request is too large' }, 413);
      body = await req.json();
    } catch {
      return json({ error: 'Invalid JSON' }, 400);
    }

    const { messages, model, attachments } = body;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return json({ error: 'Messages required' }, 400);
    }

    if (messages.length > MAX_MESSAGES || messages.some(msg =>
      !msg || !['user', 'assistant', 'system'].includes(msg.role) ||
      typeof msg.content !== 'string' || msg.content.length > MAX_MESSAGE_CHARS)) {
      return json({ error: 'Message payload is invalid or too large' }, 413);
    }

    if (attachments !== undefined && (!Array.isArray(attachments) || attachments.length > MAX_ATTACHMENTS || attachments.some(att =>
      !att || typeof att.name !== 'string' || typeof att.type !== 'string' || typeof att.data !== 'string' ||
      att.name.length > 160 || att.data.length > MAX_ATTACHMENT_CHARS ||
      !(/^(text\/|image\/(png|jpeg|webp|gif)$)/i).test(att.type)))) {
      return json({ error: 'Attachment payload is invalid or too large' }, 413);
    }

    if (!OMNIROUTE_KEY) {
      return json({ error: 'AI gateway is not configured' }, 503);
    }

    const url = new URL(req.url);
    const endpoint = url.searchParams.get('endpoint') || 'cloudflare';

    if (!ALLOWED_ENDPOINTS.has(endpoint)) return json({ error: 'Invalid endpoint' }, 400);

    const primaryUrl = normalizeEndpoint(OMNIROUTE_ENDPOINTS[endpoint] || OMNIROUTE_ENDPOINTS.cloudflare);
    if (!primaryUrl) {
      return json({ error: 'AI gateway is not configured' }, 503);
    }
    const modelName = model || 'auto/best-fast';
    if (!isValidModel(modelName)) {
      return json({ error: 'Invalid model' }, 400);
    }
    const apiMessages = buildOmniRouteMessages(messages, attachments);

    const requestBody = JSON.stringify({
      model: modelName,
      messages: apiMessages,
      max_tokens: 2048,
      stream: true,
    });

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OMNIROUTE_KEY}`,
    };

    // Try primary endpoint, then fallbacks in parallel — first good SSE stream wins
    const priorities = [primaryUrl, ...Object.values(OMNIROUTE_ENDPOINTS).map(normalizeEndpoint).filter(u => u && u !== primaryUrl)];
    let response = null;
    let lastUpstreamStatus = 0;

    for (const url of priorities) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 8000);
        const res = await fetch(url + '/chat/completions', {
          method: 'POST',
          signal: ctrl.signal,
          headers,
          body: requestBody,
        });
        clearTimeout(timer);
        if (res.ok) { response = res; break; }
        lastUpstreamStatus = res.status;
      } catch { continue; }
    }

    if (!response) {
      return json({ error: 'AI service unavailable', upstreamStatus: lastUpstreamStatus || undefined }, 503);
    }

    try {
      // Pipe the SSE stream to the client, filtering out keepalive chunks
      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      const stream = new ReadableStream({
        async pull(controller) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              controller.close();
              return;
            }

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n');

            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              const data = line.slice(6).trim();
              if (data === '[DONE]') {
                controller.close();
                return;
              }

              try {
                const parsed = JSON.parse(data);
                // Skip keepalive chunks
                if (parsed.id === 'omniroute-keepalive') continue;
                // Forward actual content chunks
                const delta = parsed.choices?.[0]?.delta?.content;
                if (delta) {
                  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ content: delta })}\n\n`));
                }
              } catch {
                // Skip unparseable lines
              }
            }
          }
        },
        cancel() {
          reader.cancel();
        }
      });

      return new Response(stream, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    } catch (err) {
      return json({
        error: err.name === 'AbortError' ? 'AI service timed out' : 'AI request failed',
      }, 502);
    }
  } catch (e) {
    console.error('chat handler error:', e);
    return json({ error: 'Internal server error', details: String(e) }, 500);
  }
}
