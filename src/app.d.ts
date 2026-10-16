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
		}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
