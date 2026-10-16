/** Hook for hub-sps.4 (confetti, star to jar, sounds). Called synchronously on tap; must stay cheap. */
export interface CelebrateDetail {
	choreId: string;
	memberId: string;
	stars: number;
	/** The tapped card, for the star's starting position. */
	origin: HTMLElement | null;
	/** The star jar element (bound from StarJar), for the star's landing position. */
	jar: HTMLElement | null;
}

export function celebrate(detail: CelebrateDetail): void {
	void detail;
}
