/** Shared appearance: the saved settings (the settings page edits it optimistically). */
import { DEFAULT_APPEARANCE, type Appearance } from '#lib/domain/appearance.js';

export const appearanceState = $state<{ value: Appearance }>({
	value: { ...DEFAULT_APPEARANCE }
});
