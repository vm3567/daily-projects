// Fixed settings for Daily Projects. No secrets here: this file is public.

export const DATA_OWNER = 'vm3567';
export const DATA_REPO = 'daily-projects-data';
export const DATA_BRANCH = 'main';

export const TIME_ZONE = 'Asia/Kolkata';

// AI model names live here, so they are easy to update.
export const AI_MODELS = {
  claude: 'claude-haiku-5-5',
  gemini: 'gemini-3.6-flash',
};

export const AI_DAILY_LIMIT = 50;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const IMAGE_MAX_WIDTH = 2000;
export const SAVE_DELAY_MS = 2000;
export const REFRESH_MS = 60 * 1000;
export const BRIEF_CLAIM_MINUTES = 5;
export const WAIT_RED_DAYS = 2; // waiting on a person this many days = time to chase (red)
