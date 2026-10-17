/** Shared wave background state: the saved choice (settings page edits it optimistically) and pause flags. */
import type { WaveChoice } from '#lib/domain/wave-background.js';

export const wave = $state<{ choice: WaveChoice; paused: boolean }>({
	choice: 'auto',
	paused: false
});
