/**
 * Star-to-allowance conversion (requirement REW-7). Pure rules shared by the grown-up screen
 * and the API. Money is always integer cents; nothing here uses floating point for amounts.
 *
 * The rate reads "`stars` stars = `cents` cents" (default 10 stars = $1.00). Cashing out is
 * allowed only in whole-star multiples that make whole cents, so no fraction is ever lost.
 */

export interface AllowanceRate {
	/** Stars on the left of the rate (1-1000). */
	stars: number;
	/** Cents they are worth (1-100000). */
	cents: number;
	/** Currency symbol shown before amounts. */
	symbol: string;
}

export const DEFAULT_RATE: AllowanceRate = { stars: 10, cents: 100, symbol: '$' };
export const MAX_RATE_STARS = 1000;
export const MAX_RATE_CENTS = 100_000;
export const MAX_SYMBOL = 3;
/** One entry may not move more than this many cents (a typo guard). */
export const MAX_ENTRY_CENTS = 1_000_000;
export const MAX_NOTE = 200;

function gcd(a: number, b: number): number {
	return b === 0 ? a : gcd(b, a % b);
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/** Validates a rate from untrusted input. */
export function parseRate(
	input: unknown
): { ok: true; rate: AllowanceRate } | { ok: false; error: string } {
	const r = (input ?? {}) as Record<string, unknown>;
	if (!isInt(r.stars) || r.stars < 1 || r.stars > MAX_RATE_STARS)
		return { ok: false, error: `Stars must be a whole number from 1 to ${MAX_RATE_STARS}.` };
	if (!isInt(r.cents) || r.cents < 1 || r.cents > MAX_RATE_CENTS)
		return { ok: false, error: 'Pick an amount of money above zero.' };
	const symbol = typeof r.symbol === 'string' ? r.symbol.trim() : DEFAULT_RATE.symbol;
	if (symbol.length < 1 || [...symbol].length > MAX_SYMBOL)
		return { ok: false, error: `The currency symbol is 1 to ${MAX_SYMBOL} characters.` };
	return { ok: true, rate: { stars: r.stars, cents: r.cents, symbol } };
}

/** The fewest stars that convert to a whole number of cents. */
export function cashoutUnit(rate: AllowanceRate): number {
	return rate.stars / gcd(rate.stars, rate.cents);
}

/** Cents for `stars`, floored to a whole cent. */
export function centsForStars(stars: number, rate: AllowanceRate): number {
	if (!isInt(stars) || stars <= 0) return 0;
	return Math.floor((stars * rate.cents) / rate.stars);
}

export type CashoutPlan = { ok: true; stars: number; cents: number } | { ok: false; error: string };

/** Checks a cash-out against the rate and the child's star balance. */
export function planCashout(stars: unknown, balance: number, rate: AllowanceRate): CashoutPlan {
	if (!isInt(stars) || stars <= 0) return { ok: false, error: 'Pick a whole number of stars.' };
	const unit = cashoutUnit(rate);
	if (stars % unit !== 0)
		return { ok: false, error: `Cash out in groups of ${unit} ${unit === 1 ? 'star' : 'stars'}.` };
	if (stars > balance) return { ok: false, error: `Only ${balance} stars to cash out.` };
	const cents = centsForStars(stars, rate);
	if (cents > MAX_ENTRY_CENTS) return { ok: false, error: 'That is too much to cash out at once.' };
	return { ok: true, stars, cents };
}

/** The most stars a child can cash out right now (a multiple of the unit). */
export function maxCashout(balance: number, rate: AllowanceRate): number {
	const unit = cashoutUnit(rate);
	return Math.max(0, Math.floor(balance / unit) * unit);
}

/** `$4.50`, `-$1.00`. Amounts are integer cents. */
export function formatMoney(cents: number, symbol: string = DEFAULT_RATE.symbol): string {
	const abs = Math.abs(Math.trunc(cents));
	const text = `${symbol}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
	return cents < 0 ? `-${text}` : text;
}

/** Parses "4.50", "4", ".5" or "-1.25" into cents; null when it is not a plain amount. */
export function parseMoney(text: string): number | null {
	const m = /^\s*(-)?\s*(\d{0,7})(?:\.(\d{1,2}))?\s*$/.exec(text);
	if (!m || (m[2] === '' && m[3] === undefined)) return null;
	const cents = Number(m[2] || '0') * 100 + Number((m[3] ?? '').padEnd(2, '0') || '0');
	return m[1] ? -cents : cents;
}

export type MoneyPlan = { ok: true; cents: number; note: string } | { ok: false; error: string };

/** A payout: positive cents handed over, no more than the balance. */
export function planPayout(cents: unknown, balance: number): MoneyPlan {
	if (!isInt(cents) || cents <= 0) return { ok: false, error: 'Enter an amount above zero.' };
	if (cents > MAX_ENTRY_CENTS) return { ok: false, error: 'That is too much to pay at once.' };
	if (cents > balance) return { ok: false, error: 'That is more than the balance.' };
	return { ok: true, cents, note: '' };
}

/** A manual correction: signed, non-zero, with a required note. */
export function planAdjustment(cents: unknown, note: unknown): MoneyPlan {
	if (!isInt(cents) || cents === 0) return { ok: false, error: 'Enter an amount.' };
	if (Math.abs(cents) > MAX_ENTRY_CENTS) return { ok: false, error: 'That amount is too large.' };
	const text = typeof note === 'string' ? note.trim() : '';
	if (!text) return { ok: false, error: 'Add a short note saying why.' };
	if (text.length > MAX_NOTE)
		return { ok: false, error: `Keep the note under ${MAX_NOTE} letters.` };
	return { ok: true, cents, note: text };
}
