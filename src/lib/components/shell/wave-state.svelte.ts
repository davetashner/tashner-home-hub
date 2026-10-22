/** Shared wave background state: the saved choice (settings page edits it optimistically). */
import type { BirthdayDate } from '#lib/domain/birthdays.js';
import type { WaveChoice } from '#lib/domain/wave-background.js';

export const wave = $state<{ choice: WaveChoice; birthdays: BirthdayDate[] }>({
	choice: 'auto',
	birthdays: []
});

/** This device's own opt-out (localStorage), separate from the household choice. */
export const device = $state<{ off: boolean }>({ off: false });
