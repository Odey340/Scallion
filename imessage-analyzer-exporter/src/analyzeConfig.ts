/**
 * Tunable constants for the (upcoming) analysis logic that reads the
 * exported data and recommends who to reach out to. No metrics or scoring
 * logic lives here yet; this module only names the knobs those pieces will
 * share.
 */

/** How many trailing days count as "recent" activity for a contact. */
export const RECENT_WINDOW_DAYS = 30;

/** How many trailing days (before the recent window) establish a contact's normal baseline. */
export const BASELINE_WINDOW_DAYS = 60;

/** Minimum messages required in the baseline window before a decline is considered meaningful. */
export const MIN_BASELINE_MESSAGES = 5;

/** Fraction drop from baseline to recent activity that counts as a "decline" (0.5 = 50% fewer messages). */
export const DECLINE_THRESHOLD = 0.5;

/** How many hours a reply can lag behind and still count as responsive. */
export const REPLY_WINDOW_HOURS = 48;

/** Relative weight each factor contributes to a contact's final outreach score. */
export const SCORE_WEIGHTS = {
  decline: 0.5,
  balance: 0.3,
  responsiveness: 0.2,
};
