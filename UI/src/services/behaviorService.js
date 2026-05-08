import { supabase } from '../supabaseClient';

const BEHAVIOR_FIELDS = ['response_tone', 'response_length', 'response_format', 'emoji_usage', 'priority_stack'];
const COLUMNS = 'response_tone, response_length, response_format, emoji_usage, priority_stack, project_id, conversation_id';

export const DEFAULT_PRIORITY_STACK = [
  'safety',
  'accuracy',
  'task_completion',
  'clarity',
  'speed',
  'warmth',
];

/**
 * Default behavior settings — used only as a display fallback when the backend
 * auto-detected behavior hasn't loaded yet. The backend's
 * `generate_default_behavior()` is the authoritative source of defaults.
 */
export const DEFAULT_BEHAVIOR = {
  response_tone: 'friendly',
  response_length: 'balanced',
  response_format: 'markdown',
  emoji_usage: 'occasional',
  priority_stack: DEFAULT_PRIORITY_STACK,
};

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Merge only the non-null fields of `override` on top of `base`.
 * Null/undefined fields in `override` leave `base` untouched.
 */
function mergeSettings(base, override) {
  if (!override) return base;
  const merged = { ...base };
  for (const field of BEHAVIOR_FIELDS) {
    if (override[field] != null) merged[field] = override[field];
  }
  return merged;
}

/**
 * Pick only the non-null behavior fields from an updates object.
 * Ensures we never write nulls back to the DB (null = "use auto").
 */
function pickNonNullFields(updates) {
  const out = {};
  for (const field of BEHAVIOR_FIELDS) {
    if (updates?.[field] != null) out[field] = updates[field];
  }
  return out;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fetch the global (user-level) behavior settings row.
 *
 * Returns only the manually-set fields (may be an empty object if the user
 * has never overridden anything). Does NOT create a row if one is missing —
 * absent rows just mean "use auto-detected defaults from the backend".
 */
export async function fetchBehaviorSettings(userId) {
  const { data, error } = await supabase
    .from('behavior_settings')
    .select(COLUMNS)
    .eq('user_id', userId)
    .is('project_id', null)
    .is('conversation_id', null)
    .maybeSingle();

  if (error) throw error;
  if (!data) return {};
  return pickNonNullFields(data);
}

/**
 * Resolve the effective manual overrides for a given scope.
 *
 * Scope chain (highest specificity wins, missing fields fall through):
 *   conversation-level → project-level → user-level
 *
 * Returns ONLY manually-overridden fields. No defaults are filled in — the
 * backend's `generate_default_behavior()` produces the auto-detected baseline,
 * and the returned overrides are merged on top of that.
 *
 * @param {string} userId
 * @param {string|null} projectId
 * @param {string|null} conversationId
 * @returns {Promise<Object>} object containing only non-null override fields
 */
export async function resolveEffectiveBehavior(userId, projectId, conversationId) {
  const { data, error } = await supabase
    .from('behavior_settings')
    .select(COLUMNS)
    .eq('user_id', userId);

  if (error) throw error;

  const rows = data || [];

  const userRow = rows.find(r => r.project_id == null && r.conversation_id == null);
  const projectRow = projectId ? rows.find(r => r.project_id === projectId && r.conversation_id == null) : null;
  const convoRow = conversationId ? rows.find(r => r.conversation_id === conversationId) : null;

  // Merge manual overrides from least to most specific. Start empty so we
  // never return default values — only what the user has explicitly set.
  let resolved = {};
  if (userRow) resolved = mergeSettings(resolved, userRow);
  if (projectRow) resolved = mergeSettings(resolved, projectRow);
  if (convoRow) resolved = mergeSettings(resolved, convoRow);

  return resolved;
}

/**
 * Update global (user-level) behavior settings.
 *
 * Only writes non-null fields from `updates`. If the row doesn't exist yet,
 * it is inserted. Returns the persisted overrides (non-null fields only).
 */
export async function updateBehaviorSettings(userId, updates) {
  const cleanUpdates = pickNonNullFields(updates);
  if (Object.keys(cleanUpdates).length === 0) {
    // Nothing to write — just return current state
    return fetchBehaviorSettings(userId);
  }

  const row = {
    user_id: userId,
    project_id: null,
    conversation_id: null,
    ...cleanUpdates,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('behavior_settings')
    .upsert(row, { onConflict: 'user_id,project_id,conversation_id' })
    .select(COLUMNS)
    .single();
  if (error) throw error;
  return pickNonNullFields(data);
}

/**
 * Upsert behavior settings for a specific scope (project or conversation).
 * Pass projectId OR conversationId (not both) to set that scope's override.
 * Pass neither to update the global user-level settings.
 *
 * Only non-null fields from `updates` are written. Fields left null/undefined
 * will fall through to the auto-detected baseline from the backend.
 */
export async function upsertScopedBehavior(userId, updates, { projectId = null, conversationId = null } = {}) {
  const cleanUpdates = pickNonNullFields(updates);
  if (Object.keys(cleanUpdates).length === 0) {
    // Empty update — treat as a no-op rather than writing a bare row.
    return {};
  }

  const row = {
    user_id: userId,
    project_id: projectId,
    conversation_id: conversationId,
    ...cleanUpdates,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('behavior_settings')
    .upsert(row, { onConflict: 'user_id,project_id,conversation_id' })
    .select(COLUMNS)
    .single();
  if (error) throw error;
  return pickNonNullFields(data);
}

/**
 * Delete a scoped behavior override (project or conversation level).
 * After deletion the scope will fall back to its parent.
 */
export async function deleteScopedBehavior(userId, { projectId = null, conversationId = null } = {}) {
  let query = supabase
    .from('behavior_settings')
    .delete()
    .eq('user_id', userId);

  if (projectId) query = query.eq('project_id', projectId);
  else query = query.is('project_id', null);

  if (conversationId) query = query.eq('conversation_id', conversationId);
  else query = query.is('conversation_id', null);

  const { error } = await query;
  if (error) throw error;
}
