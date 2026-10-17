// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			/** The adult unlocked by a valid PIN session, or null. */
			adult: { id: string; name: string } | null;
		}
		interface PageData {
			/** Household IANA zone from the root layout; the source of truth for "today". */
			timeZone?: string;
			/** This device's role from its cookie (DEV-1); only a wall display gets kiosk behaviour. */
			displayRole?: 'wall' | 'personal';
		}
		interface PageState {
			/** Set when the idle timer opened the photo frame: show it fullscreen. */
			frame?: boolean;
		}
		// interface Platform {}
	}
}

export {};
