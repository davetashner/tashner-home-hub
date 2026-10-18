import { describe, expect, it } from 'vitest';
import { emptyCard, joinCard, normalizeCard, splitCard } from './sitter.js';

describe('card', () => {
	const raw = {
		contacts: [
			{ name: ' Grandma ', relation: 'Grandmother', phone: '555-0101' },
			{ name: '', phone: '' }
		],
		address: '1 Test Lane',
		kids: [
			{ memberId: 'a', bedtime: '19:30', allergies: 'Peanuts', medical: 'Inhaler' },
			{ memberId: 'b', bedtime: '25:00' },
			{ memberId: '' }
		],
		rules: ['No screens', '  ', 'Lights out at bedtime'],
		wifiName: 'TestNet',
		wifiPassword: 'hunter2',
		tonight: 'Pizza in the freezer'
	};
	it('normalizes untrusted input', () => {
		const c = normalizeCard(raw);
		expect(c.contacts).toEqual([{ name: 'Grandma', relation: 'Grandmother', phone: '555-0101' }]);
		expect(c.kids.map((k) => k.bedtime)).toEqual(['19:30', '']);
		expect(c.rules).toEqual(['No screens', 'Lights out at bedtime']);
	});
	it('handles junk', () => {
		expect(normalizeCard(null)).toEqual(emptyCard());
		expect(normalizeCard([]).contacts).toEqual([]);
		expect(normalizeCard({ contacts: 'x', rules: 5, kids: {} })).toEqual(emptyCard());
	});
	it('caps lengths and counts', () => {
		const c = normalizeCard({ tonight: 'x'.repeat(5000), rules: Array(40).fill('r') });
		expect(c.tonight).toHaveLength(1000);
		expect(c.rules).toHaveLength(15);
	});
	it('splits sensitive fields out and joins them back', () => {
		const card = normalizeCard(raw);
		const { plain, sensitive } = splitCard(card);
		expect(JSON.stringify(plain)).not.toMatch(/555|Test Lane|Peanuts|Inhaler|hunter2/);
		expect(sensitive.phones).toEqual(['555-0101']);
		expect(joinCard(plain, sensitive)).toEqual(card);
	});
	it('joins tolerate missing sensitive entries', () => {
		const { plain } = splitCard(normalizeCard(raw));
		const c = joinCard(plain, { phones: [], address: '', kids: [], wifiPassword: '' });
		expect(c.contacts[0]?.phone).toBe('');
		expect(c.kids[0]?.allergies).toBe('');
	});
});
