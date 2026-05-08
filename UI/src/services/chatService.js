import { supabase } from '../supabaseClient';

// ── Conversations ────────────────────────────────────────────

/**
 * Fetch standalone conversations (no project) for the sidebar, sorted by most recent.
 * Uses cursor-based pagination on updated_at.
 */
export async function fetchConversations({ limit = 20, cursor = null } = {}) {
  let query = supabase
    .from('conversations')
    .select('id, title, last_message_preview, updated_at, project_id')
    .is('project_id', null)
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (cursor) {
    query = query.lt('updated_at', cursor);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

/**
 * Create a new conversation. Title can be null (auto-generated later).
 * Pass projectId to create inside a project.
 */
export async function createConversation(userId, title = null, projectId = null) {
  const row = { user_id: userId, title };
  if (projectId) row.project_id = projectId;
  const { data, error } = await supabase
    .from('conversations')
    .insert(row)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Update conversation fields (title, last_message_preview, updated_at).
 */
export async function updateConversation(conversationId, updates) {
  const { data, error } = await supabase
    .from('conversations')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', conversationId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Rename a conversation.
 */
export async function renameConversation(conversationId, title) {
  return updateConversation(conversationId, { title });
}

/**
 * Hard-delete a conversation (cascades to messages).
 */
export async function deleteConversation(conversationId) {
  const { error } = await supabase
    .from('conversations')
    .delete()
    .eq('id', conversationId);
  if (error) throw error;
}

// ── Messages ─────────────────────────────────────────────────

/**
 * Fetch messages for a conversation with cursor pagination.
 * Returns newest-first from DB; caller should reverse for display.
 */
export async function fetchMessages({ conversationId, limit = 30, cursor = null }) {
  let query = supabase
    .from('messages')
    .select('id, role, content, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (cursor) {
    query = query.lt('created_at', cursor);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data.reverse();
}

/**
 * Insert a single message and update the parent conversation.
 */
export async function insertMessage({ conversationId, role, content }) {
  const { data, error } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      role,
      content,
    })
    .select()
    .single();
  if (error) throw error;

  const preview = content.length > 80 ? content.slice(0, 80) + '...' : content;
  await supabase
    .from('conversations')
    .update({
      last_message_preview: preview,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversationId);

  return data;
}

/**
 * Delete a single message by id.
 */
export async function deleteMessage(messageId) {
  const { error } = await supabase
    .from('messages')
    .delete()
    .eq('id', messageId);
  if (error) throw error;
}

/**
 * Delete all messages in a conversation after a given created_at timestamp (inclusive).
 * Used for edit-and-resubmit to truncate the conversation from that point.
 */
export async function deleteMessagesAfter(conversationId, createdAt) {
  const { error } = await supabase
    .from('messages')
    .delete()
    .eq('conversation_id', conversationId)
    .gte('created_at', createdAt);
  if (error) throw error;
}

/**
 * Auto-generate a conversation title using AI.
 * Only sets title if it's currently null.
 *
 * @param {string} conversationId
 * @param {string} firstUserMessage
 * @param {(msg: string) => Promise<string|null>} titleGenerator - AI function that returns a short title
 */
export async function autoTitleIfNeeded(conversationId, firstUserMessage, titleGenerator) {
  const { data: convo } = await supabase
    .from('conversations')
    .select('title')
    .eq('id', conversationId)
    .single();

  if (convo?.title) return; // already titled

  // Try AI-generated title, fall back to truncated message
  let title = null;
  if (titleGenerator) {
    try {
      title = await titleGenerator(firstUserMessage);
    } catch {
      // fall through to fallback
    }
  }

  if (!title) {
    title = firstUserMessage.length > 50
      ? firstUserMessage.slice(0, 50) + '...'
      : firstUserMessage;
  }

  await supabase
    .from('conversations')
    .update({ title })
    .eq('id', conversationId);
}
