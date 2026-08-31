import { verifySession, readCookie } from '../_session.js';
import { resolveAccess } from '../_acl.js';

export const config = { runtime: 'edge' };

const OMNIROUTE_KEY = process.env.OMNIROUTE_KEY || 'sk-61be4b16598dca09-9b9c27-5ae47255';

const OMNIROUTE_ENDPOINTS = {
  intranet: process.env.OMNIROUTE_URL_INTRANET || 'http://10.36.4.165:20128/v1',
  ngrok: process.env.OMNIROUTE_URL_NGROK || 'https://traffic-appetite-relay.ngrok-free.dev/v1',
  cloudflare: process.env.OMNIROUTE_URL_CLOUDFLARE || 'https://speech-constructed-sims-deputy.trycloudflare.com/v1',
};

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
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const session = await verifySession(readCookie(req, 'session'));
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let admin = false;
  try {
    ({ admin } = await resolveAccess(session.email));
  } catch {
    admin = false;
  }

  if (!admin) {
    return new Response(JSON.stringify({ error: 'Access denied' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { messages, model, attachments } = body;
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return new Response(JSON.stringify({ error: 'Messages required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const url = new URL(req.url);
  const endpoint = url.searchParams.get('endpoint') || 'cloudflare';

  const endpoints = {
    intranet: 'http://10.36.4.165:20128/v1',
    ngrok: 'https://traffic-appetite-relay.ngrok-free.dev/v1',
    cloudflare: 'https://speech-constructed-sims-deputy.trycloudflare.com/v1'
  };

  const OMNIROUTE_URL = endpoints[endpoint] || endpoints.cloudflare;
  const modelName = model || 'auto/best-coding';
  const apiMessages = buildOmniRouteMessages(messages, attachments);

  // Use SSE streaming — non-streaming OmniRoute responses take 45s+ but
  // streaming returns keepalive pings immediately and content within ~20s.
  try {
    const response = await fetch(OMNIROUTE_URL + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OMNIROUTE_KEY}`,
      },
      body: JSON.stringify({
        model: modelName,
        messages: apiMessages,
        max_tokens: 4096,
        stream: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      return new Response(JSON.stringify({
        error: 'OmniRoute API error',
        content: `API Error (${response.status}): ${errorText}`
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

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
    const msg = err.name === 'AbortError'
      ? 'The AI model took too long to respond. Try a faster model or a shorter prompt.'
      : `Failed to connect to OmniRoute: ${err.message}`;
    return new Response(JSON.stringify({
      error: 'Request failed',
      content: msg
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
