import { describe, expect, it } from 'vitest';
import { redeemPreview, redeemedMessage } from './redeem.js';

describe('redeemPreview', () => {
	it('shows the balance after when there are enough stars', () => {
		expect(redeemPreview(25, 20)).toEqual({ ok: true, after: 5, short: 0 });
		expect(redeemPreview(20, 20)).toEqual({ ok: true, after: 0, short: 0 });
	});
	it('reports what is missing when short', () => {
		expect(redeemPreview(12, 20)).toEqual({ ok: false, after: 12, short: 8 });
	});
});

it('formats the confirmation toast', () => {
	expect(redeemedMessage('Ice cream', 'Sam', 20)).toBe('Redeemed Ice cream for Sam (−20 ⭐)');
});
