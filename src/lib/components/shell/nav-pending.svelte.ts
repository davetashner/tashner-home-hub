import { navigating } from '$app/state';

/**
 * Which nav destination the user just tapped, before SvelteKit has finished loading the route.
 * Set on pointerdown so the item looks active in the tapped frame; cleared when the navigation ends
 * (landed, failed or cancelled), when the finger leaves without a tap, or after a safety timeout.
 */
let tapped = $state<string | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;
let seenNavigation = false;
let clicked = false;

export function tap(href: string) {
	tapped = href;
	seenNavigation = false;
	clicked = false;
	// A press that ends off the item (or is cancelled) never produces a click: roll the highlight back.
	// The click fires right after pointerup, so look once the current task is done.
	window.addEventListener(
		'pointerup',
		() =>
			setTimeout(() => {
				if (!clicked) clear();
			}, 0),
		{ once: true, capture: true }
	);
	clearTimeout(timer);
	timer = setTimeout(clear, 3000);
}

export function markClicked() {
	clicked = true;
}

export function clear() {
	tapped = null;
	seenNavigation = false;
	clearTimeout(timer);
}

/** Call from a root effect: clears the tap once the navigation it started has ended. */
export function watchNavigation() {
	if (navigating.to) seenNavigation = true;
	else if (seenNavigation) clear();
}

/** The href that should look active right now, or null to use the real route. */
export function optimisticHref(): string | null {
	return tapped ?? navigating.to?.url.pathname ?? null;
}
