/** Pure helpers for redeeming a reward on the grown-up screens (REW-4). */

export interface RedeemPreview {
	/** True when the balance covers the cost. */
	ok: boolean;
	/** Balance after redeeming (never shown below zero). */
	after: number;
	/** Stars still missing (0 when ok). */
	short: number;
}

export function redeemPreview(balance: number, cost: number): RedeemPreview {
	const ok = balance >= cost;
	return { ok, after: ok ? balance - cost : balance, short: ok ? 0 : cost - balance };
}

/** "Redeemed Ice cream for Sam (−20 ⭐)". */
export function redeemedMessage(reward: string, child: string, cost: number): string {
	return `Redeemed ${reward} for ${child} (−${cost} ⭐)`;
}
