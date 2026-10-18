/**
 * What the photo frame overlay is showing right now, so the shell can avoid doubling it:
 * no second corner clock, and the restore handle moves off the overlay's text.
 */
export const frameOverlay = $state<{ any: boolean; clock: boolean }>({ any: false, clock: false });
