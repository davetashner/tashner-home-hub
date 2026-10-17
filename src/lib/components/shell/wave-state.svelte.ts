/** Shared wave background state: the saved choice (settings page edits it optimistically). */
import type { WaveChoice } from '#lib/domain/wave-background.js';

export const wave = $state<{ choice: WaveChoice }>({
	choice: 'auto'
});
