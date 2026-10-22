/**
 * Space Junk (hub-26w.1): level stars. Kept simple enough for a kid to read off the HUD:
 * win with two or more Junkbots to spare for three stars, one to spare for two, none for one.
 * These are in-game stars only; the game never touches the hub's star ledger.
 */
export type Stars = 0 | 1 | 2 | 3;

export function starsFor(won: boolean, junkbotsLeft: number): Stars {
	if (!won) return 0;
	if (junkbotsLeft >= 2) return 3;
	return junkbotsLeft === 1 ? 2 : 1;
}
