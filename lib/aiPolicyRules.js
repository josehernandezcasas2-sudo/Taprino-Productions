// The "Not for AI training" seal and the policy page behind it (Jose,
// 2026-10-25; canvas https://claude.ai/artifact/68Gq3NnvmRGaAYYinZ1KX5).
// Pure and client-safe: pages, components and the app's mirror import
// from here, never from a server lib.
export const AI_POLICY_PATH = '/ai-policy';
export const SEAL_LABEL = 'Not for AI training';
export const SEAL_TITLE = 'Nothing on Studio Tapa TV is licensed for AI training. Read the policy.';

// Whether a creator's work carries the seal. The profile column
// (user_profiles.ai_seal, migration 111) defaults to true, and a
// database that hasn't run the migration yet, or a creator with no
// profile row, reads as "on": the seal is the site's position, the
// switch is the exception.
export function sealShown(flag) {
  return flag !== false;
}
