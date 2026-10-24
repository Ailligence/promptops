/**
 * The data methods the app calls through {@link DataBackend}: this map is the
 * contract. Every backend must implement each name with the parameters and
 * result described here; method names never change once published.
 *
 * Conventions:
 * - parameters are one plain object with snake_case keys;
 * - `profile_id` (optional) scopes sessions, workspaces and sidebar folders to
 *   a session profile; without it they belong to the Standard profile;
 * - ids are strings for sessions, workspaces, profiles, folders and device
 *   workspaces, and integers for prompts and everything attached to them;
 * - `deleted` records are soft-deleted unless the description says otherwise;
 * - "→ null" means the call resolves with no value.
 *
 * Failures reject with a {@link DataError} (`code` + `message`).
 */
export const DATA_METHODS = {
  // ── Sessions ──
  'sessions.list': 'Sessions of the profile in tab order. { profile_id?, workspace_id? | standalone?, device_id? } → session[]',
  'sessions.get': 'One session. { id } → session',
  'sessions.create': 'Creates a session (a deleted one with the same name comes back). Fails with session_name_taken when a live session has the name, unless replace: true or local_session_id is the one stored on it. { name, provider, workspace_id?, workspace_path?, workspace_name?, config?, profile_id?, category_id?, local_session_id?, replace? } → session. category_id must name an existing prompt category, else it is stored as null',
  'sessions.update': 'Updates fields of a session; the id may also be its name. { id, lookup_name?, force_rename?, ...fields } → session. A taken name rejects with code session_name_taken and details.conflict_name',
  'sessions.updateByName': 'Same as sessions.update, found by name. { lookup_name, ...fields } → session',
  'sessions.delete': 'Deletes a session (the name stays reserved). { id } → null',
  'sessions.deleteByName': 'Deletes the session with this name. { name } → null',
  'sessions.reorder': 'Tab order inside a workspace. { workspace_id, session_ids } → null',
  'sessions.persist': 'Saves many sessions at once (upsert by id, then by name). { sessions, profile_id? } → { persisted }',
  'sessions.setSubAgentsOrder': 'Display order of active sub-agents. { id, order } → session',
  'sessions.promote': 'Moves a standalone session into a workspace. { id, target_workspace_id } → session',
  'sessions.saveSnapshot': 'Saves the desktop UI state. { active_session_name, sub_agents_state, ui_state?, device_id? } → snapshot',
  'sessions.getSnapshot': 'Last saved desktop UI state. { device_id? } → snapshot | null',
  'sessions.archive': 'Archived sub-agents of every session, newest first. {} → entry[]',
  'sessions.removeArchived': 'Forgets one archived sub-agent. { archive_id | claude_session_id | title + archived_at, parent_session_id? } → { removed }',

  // ── Workspaces ──
  'workspaces.list': 'Workspaces of the profile. { profile_id? } → workspace[]',
  'workspaces.get': 'One workspace. { id } → workspace',
  'workspaces.create': 'Creates a workspace, or renames the one for the same folder. { name, project_path, profile_id? } → workspace',
  'workspaces.findOrCreate': 'The workspace of a folder, created if needed. { project_path, name?, profile_id? } → workspace',
  'workspaces.update': 'Renames a workspace. { id, name? } → workspace',
  'workspaces.delete': 'Deletes a workspace; its sessions stay, detached. { id } → null',

  // ── Session profiles ──
  'profiles.list': 'Profiles in order. {} → profile[]',
  'profiles.create': '{ name, color? } → profile',
  'profiles.update': '{ id, name?, color?, sort_order? } → profile',
  'profiles.delete': 'Its sessions and workspaces move to Standard. { id } → null',

  // ── Sidebar folders ──
  'folders.list': 'Folders of the profile with the ids they contain. { profile_id? } → folder[]',
  'folders.create': '{ name, color?, profile_id? } → folder',
  'folders.update': '{ id, name?, color?, sort_order? } → folder',
  'folders.delete': 'Its contents move out of the folder. { id } → null',
  'folders.reorder': '{ folder_ids } → null',
  'folders.assign': 'folder_id null takes the items out of their folder. { folder_id, workspace_ids, session_ids } → { folder_id, workspace_ids, session_ids }',

  // ── Local profile ──
  'user.me': 'The user profile with UI preferences and onboarding state. {} → user',
  'user.updateUiPreferences': 'Merges UI preferences (theme, fonts, sidebar size, ui_style…). { ...preferences } → user',
  'user.setPreferredProvider': '{ provider | null } → { preferred_provider }',
  'user.completeOnboarding': "{ interest: 'sessions' | 'prompts' | 'teams' | 'explore' | null } → { onboarding_completed_at, onboarding_interest }",

  // ── Prompt library ──
  'prompts.list': 'Own prompts. { search?, category_id?, status?, visibility?, ai_model?, tags?, starred?, sort_field?, sort_dir?, page?, per_page? } → { prompts, pagination }',
  'prompts.get': 'One prompt with its versions. { id } → prompt',
  'prompts.create': 'Saves version 1 too. { title, body, ...fields } → prompt',
  'prompts.update': 'Each save is a new version. { id, ...fields, change_summary? } → prompt',
  'prompts.delete': '{ id } → null',
  'prompts.versions': 'Newest first. { id } → version[]',
  'prompts.restoreVersion': 'Restores an earlier version as a new one. { id, version_id } → prompt',
  'prompts.toggleStar': 'Stars or unstars a prompt (a bookmark, not a new version). { id } → prompt',
  'promptCategories.list': '{} → category[]',
  'promptCategories.create': '{ name, description?, color? } → category',
  'promptTags.list': '{} → tag[]',
  'promptTags.create': 'Reuses a tag with the same slug. { name } → tag',

  // ── Sidebar shortcuts ──
  'shortcuts.list': '{} → shortcut[]',
  'shortcuts.create': 'Pins a prompt (code conflict if already pinned). { prompt_id, label, icon? } → shortcut',
  'shortcuts.update': '{ id, label?, icon? } → shortcut',
  'shortcuts.reorder': '{ order } → null',
  'shortcuts.delete': 'Removed for good. { id } → null',

  // ── Session action slots ──
  'actionSlots.list': "{ session_id | scope: 'global' } → { slots, scope }",
  'actionSlots.create': "New slots go first (code conflict if the prompt is already there). { prompt_id, label, icon?, session_id | scope: 'global' } → { slot, scope }",
  'actionSlots.reorder': "Every slot of the scope exactly once. { order, session_id | scope: 'global' } → null",
  'actionSlots.delete': "{ id, session_id | scope: 'global' } → null",

  // ── Local data file ──
  'store.health': 'How the local data file opened. {} → { quarantined?: path it was moved to, readOnly?: reason changes are not saved, unreadable: records this device cannot open, formatVersion }',

  // ── Notes ──
  'notes.list': 'Newest first. { session_id?, file_path?, search? } → note[]',
  'notes.create': '{ content, session_id?, file_path? } → note',
  'notes.delete': 'Removed for good. { id } → null',
} as const;

export type DataMethod = keyof typeof DATA_METHODS;
