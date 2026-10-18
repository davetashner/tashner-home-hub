/**
 * Sitter mode (hub-7pj): the household info card.
 * Pure: no clock, no database. Callers pass `now` (epoch ms).
 */

export interface Contact {
	name: string;
	relation: string;
	phone: string;
}

export interface KidInfo {
	memberId: string;
	/** "HH:MM", 24 hour, or empty. */
	bedtime: string;
	allergies: string;
	medical: string;
}

export interface SitterCard {
	contacts: Contact[];
	address: string;
	kids: KidInfo[];
	rules: string[];
	wifiName: string;
	wifiPassword: string;
	tonight: string;
}

export const MAX_CONTACTS = 10;
export const MAX_RULES = 15;
export const MAX_KIDS = 12;

export function emptyCard(): SitterCard {
	return {
		contacts: [],
		address: '',
		kids: [],
		rules: [],
		wifiName: '',
		wifiPassword: '',
		tonight: ''
	};
}

const text = (v: unknown, max: number): string =>
	typeof v === 'string' ? v.trim().slice(0, max) : '';
const obj = (v: unknown): Record<string, unknown> =>
	v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const list = (v: unknown, max: number): unknown[] => (Array.isArray(v) ? v.slice(0, max) : []);

/** Coerces untrusted input into a well-formed card: trims, caps lengths and counts, drops blanks. */
export function normalizeCard(raw: unknown): SitterCard {
	const r = obj(raw);
	const contacts = list(r.contacts, MAX_CONTACTS)
		.map((c) => {
			const o = obj(c);
			return { name: text(o.name, 60), relation: text(o.relation, 40), phone: text(o.phone, 30) };
		})
		.filter((c) => c.name || c.phone);
	const kids = list(r.kids, MAX_KIDS)
		.map((k) => {
			const o = obj(k);
			const bedtime = text(o.bedtime, 5);
			return {
				memberId: text(o.memberId, 80),
				bedtime: /^([01]\d|2[0-3]):[0-5]\d$/.test(bedtime) ? bedtime : '',
				allergies: text(o.allergies, 500),
				medical: text(o.medical, 1000)
			};
		})
		.filter((k) => k.memberId);
	return {
		contacts,
		address: text(r.address, 200),
		kids,
		rules: list(r.rules, MAX_RULES)
			.map((x) => text(x, 200))
			.filter(Boolean),
		wifiName: text(r.wifiName, 64),
		wifiPassword: text(r.wifiPassword, 64),
		tonight: text(r.tonight, 1000)
	};
}

/** The parts encrypted at rest: phones, address, allergies and medical notes, Wi-Fi password. */
export interface SensitiveCard {
	phones: string[];
	address: string;
	kids: { memberId: string; allergies: string; medical: string }[];
	wifiPassword: string;
}

export type PlainCard = {
	contacts: Omit<Contact, 'phone'>[];
	kids: { memberId: string; bedtime: string }[];
	rules: string[];
	wifiName: string;
	tonight: string;
};

export function splitCard(card: SitterCard): { plain: PlainCard; sensitive: SensitiveCard } {
	return {
		plain: {
			contacts: card.contacts.map(({ name, relation }) => ({ name, relation })),
			kids: card.kids.map(({ memberId, bedtime }) => ({ memberId, bedtime })),
			rules: card.rules,
			wifiName: card.wifiName,
			tonight: card.tonight
		},
		sensitive: {
			phones: card.contacts.map((c) => c.phone),
			address: card.address,
			kids: card.kids.map(({ memberId, allergies, medical }) => ({ memberId, allergies, medical })),
			wifiPassword: card.wifiPassword
		}
	};
}

export function joinCard(plain: PlainCard, sensitive: SensitiveCard): SitterCard {
	return {
		contacts: plain.contacts.map((c, i) => ({ ...c, phone: sensitive.phones[i] ?? '' })),
		address: sensitive.address,
		kids: plain.kids.map((k) => {
			const s = sensitive.kids.find((x) => x.memberId === k.memberId);
			return { ...k, allergies: s?.allergies ?? '', medical: s?.medical ?? '' };
		}),
		rules: plain.rules,
		wifiName: plain.wifiName,
		wifiPassword: sensitive.wifiPassword,
		tonight: plain.tonight
	};
}
