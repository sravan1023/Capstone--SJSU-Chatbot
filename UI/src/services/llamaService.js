/**
 * LLM Service — calls the FastAPI backend instead of Groq directly.
 *
 * The backend handles: system prompt compilation, Groq streaming,
 * post-generation validation, and repair rewrites.
 */

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000';

const MODELS = {
  '8b': 'llama-3.3-70b-versatile',
  '70b': 'llama-3.3-70b-versatile',
};

/**
 * Send a chat message via the backend and stream the response.
 *
 * @param {Object} options
 * @param {Array<{role: string, content: string}>} options.messages - conversation history
 * @param {string} options.model - '8b' or '70b'
 * @param {(chunk: string) => void} options.onChunk - called with each text chunk
 * @param {(text: string) => void} [options.onReplace] - called if validators replace the response
 * @param {AbortSignal} [options.signal] - optional abort signal
 * @param {Object} [options.behavior] - behavior settings
 * @param {string} [options.memoryPrompt] - memory context to inject
 * @returns {Promise<Object>} validator metadata
 */
export async function sendMessage({ messages, model = '8b', onChunk, onReplace, signal, behavior, memoryPrompt }) {
  const res = await fetch(`${API_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages,
      model,
      behavior: behavior || null,
      memory_prompt: memoryPrompt || null,
    }),
    signal,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Backend error (${res.status}): ${err}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let validatorMeta = {
    validatorsRun: [],
    validatorsPassed: true,
    repairsApplied: [],
    sources: [],
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;

      try {
        const parsed = JSON.parse(trimmed.slice(6));

        if (parsed.token) {
          onChunk?.(parsed.token);
        } else if (parsed.replace) {
          onReplace?.(parsed.replace);
        } else if (parsed.done) {
          validatorMeta = {
            validatorsRun: parsed.validators_run || [],
            validatorsPassed: parsed.validators_passed ?? true,
            repairsApplied: parsed.repairs_applied || [],
            sources: parsed.sources || [],
          };
        } else if (parsed.error) {
          throw new Error(parsed.error);
        }
      } catch (e) {
        if (e.message?.startsWith('Backend error') || e.message?.startsWith('Groq API error')) {
          throw e;
        }
        // skip malformed SSE chunks
      }
    }
  }

  return validatorMeta;
}

/**
 * Generate a short chat title from the first user message.
 * Non-streaming, returns a plain string (3-6 words).
 */
export async function generateTitle(userMessage) {
  try {
    const res = await fetch(`${API_BASE}/api/generate-title`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: userMessage }),
    });

    if (!res.ok) return null;

    const data = await res.json();
    return data.title || null;
  } catch {
    return null;
  }
}

/**
 * Fetch the auto-detected behavior for a conversation.
 * Used by behavior panels to show the baseline.
 */
export async function fetchAutoBehavior(messages) {
  try {
    const res = await fetch(`${API_BASE}/api/auto-behavior`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
    });

    if (!res.ok) return null;

    const data = await res.json();
    return data;
  } catch {
    return null;
  }
}

export { MODELS };
