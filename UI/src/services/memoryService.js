import { supabase } from '../supabaseClient';

const memoryEnabled = import.meta.env.VITE_ENABLE_MEMORY !== 'false';

/**
 * Retrieve memory context for a conversation.
 * Returns a formatted prompt string to prepend to the system prompt.
 *
 * @param {string} conversationId
 * @returns {Promise<string>} memory prompt text (empty string if none)
 */
export async function retrieveMemoryContext(conversationId) {
  if (!memoryEnabled) return '';
  const { data, error } = await supabase.functions.invoke('memory/retrieve', {
    body: { conversation_id: conversationId },
  });

  if (error) {
    console.warn('Memory retrieval failed:', error.message);
    return '';
  }

  return data?.memoryPrompt ?? '';
}

/**
 * Process a user-assistant exchange to extract and store memories.
 * Fire-and-forget — errors are logged but not thrown.
 *
 * @param {string} conversationId
 * @param {string} messageId - the assistant message ID (provenance)
 * @param {string} userMessage
 * @param {string} assistantMessage
 */
export async function processMemoryExtraction(conversationId, messageId, userMessage, assistantMessage) {
  if (!memoryEnabled) return;
  const { error } = await supabase.functions.invoke('memory/process', {
    body: {
      conversation_id: conversationId,
      message_id: messageId,
      user_message: userMessage,
      assistant_message: assistantMessage,
    },
  });

  if (error) {
    console.warn('Memory extraction failed:', error.message);
  }
}
