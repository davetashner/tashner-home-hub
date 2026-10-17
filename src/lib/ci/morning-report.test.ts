import { describe, expect, it } from 'vitest';
import {
	beadId,
	detectFlakes,
	failingChecks,
	formatReport,
	isoDay,
	latestRun,
	mergedSince,
	needsHuman,
	reportTitle,
	summarizeArtifact,
	type OpenPr,
	type ReportData,
	type WorkflowRun
} from '#lib/ci/morning-report.js';

const pr = (over: Partial<OpenPr> = {}): OpenPr => ({
	number: 7,
	title: 'feat: thing [hub-abc.1]',
	url: 'https://example.test/pr/7',
	mergeStateStatus: 'BLOCKED',
	labels: [],
	checks: [],
	...over
});
const run = (over: Partial<WorkflowRun> = {}): WorkflowRun => ({
	id: 1,
	name: 'Tower',
	conclusion: 'success',
	status: 'completed',
	url: 'https://example.test/run/1',
	createdAt: '2026-01-02T09:00:12Z',
	event: 'schedule',
	...over
});

describe('helpers', () => {
	it('extracts bead ids', () => {
		expect(beadId('feat: x [hub-sps.2]')).toBe('hub-sps.2');
		expect(beadId('Fix HUB-7az.6.1 thing')).toBe('hub-7az.6.1');
		expect(beadId('no bead here')).toBeNull();
	});
	it('titles by UTC day', () => {
		expect(isoDay(new Date('2026-03-04T23:59:00Z'))).toBe('2026-03-04');
		expect(reportTitle('2026-03-04')).toBe('Morning report 2026-03-04');
	});
	it('keeps merges inside the window, oldest first', () => {
		const since = new Date('2026-01-02T00:00:00Z');
		const prs = [
			{ number: 2, title: 'b', url: 'u', mergedAt: '2026-01-02T08:00:00Z' },
			{ number: 1, title: 'a', url: 'u', mergedAt: '2026-01-01T08:00:00Z' },
			{ number: 3, title: 'c', url: 'u', mergedAt: '2026-01-02T01:00:00Z' }
		];
		expect(mergedSince(prs, since).map((p) => p.number)).toEqual([3, 2]);
	});
	it('finds failing checks and needs-human PRs', () => {
		const p = pr({
			labels: ['needs-human'],
			checks: [
				{ name: 'e2e', conclusion: 'FAILURE' },
				{ name: 'e2e', conclusion: 'ERROR' },
				{ name: 'quality', conclusion: 'SUCCESS' },
				{ name: 'pending', conclusion: null }
			]
		});
		expect(failingChecks(p)).toEqual(['e2e']);
		expect(needsHuman([p, pr()])).toEqual([p]);
	});
	it('picks the latest run, or null', () => {
		expect(latestRun([])).toBeNull();
		const newer = run({ id: 2, createdAt: '2026-01-03T09:00:00Z' });
		expect(latestRun([run(), newer])).toBe(newer);
	});
});

describe('detectFlakes', () => {
	it('flags a job that failed then passed, once', () => {
		const flakes = detectFlakes([
			{
				runId: 1,
				sha: 'abcdef1234567',
				url: 'r1',
				attempts: [
					[
						{ name: 'e2e', conclusion: 'failure' },
						{ name: 'quality', conclusion: 'success' }
					],
					[
						{ name: 'e2e', conclusion: 'failure' },
						{ name: 'quality', conclusion: 'success' }
					],
					[{ name: 'e2e', conclusion: 'success' }]
				]
			},
			{ runId: 2, sha: 'ffff', url: 'r2', attempts: [[{ name: 'e2e', conclusion: 'failure' }]] },
			{ runId: 3, sha: 'eeee', url: 'r3', attempts: [] }
		]);
		expect(flakes).toEqual([{ name: 'e2e', sha: 'abcdef1', url: 'r1' }]);
	});
});

describe('summarizeArtifact', () => {
	it('reads known keys and ignores the rest', () => {
		expect(summarizeArtifact('mutation', { mutationScore: 81.234 })).toEqual([
			'mutation score 81.2% (floor 70%)'
		]);
		expect(summarizeArtifact('soak', { heapGrowthPct: 4, sseReconnects: 3 })).toEqual([
			'soak heap growth 4.0% (limit 20%)',
			'3 SSE reconnects'
		]);
		expect(summarizeArtifact('soak', { other: 1 })).toEqual([]);
		expect(summarizeArtifact('soak', null)).toEqual([]);
		expect(summarizeArtifact('mutation', { score: 'high' })).toEqual([]);
	});
});

describe('formatReport', () => {
	const base: ReportData = {
		date: '2026-01-02',
		merged: [],
		open: [],
		tower: { label: 'Tower', run: null, numbers: [] },
		nightly: { label: 'Tower nightly', run: null, numbers: [] },
		flakes: []
	};

	it('renders an empty day with placeholders', () => {
		const md = formatReport(base);
		expect(md).toContain('Nothing is waiting on you.');
		expect(md).toContain('No PRs merged.');
		expect(md).toContain('- **Tower nightly:** no run found');
		expect(md).toContain('**Pi fps:** not wired yet (hub-ugl.7 / hub-ugl.10)');
		expect(md).toContain('**AI design notes:** not wired yet (hub-ugl.7 / hub-ugl.10)');
		expect(md).toContain('No job failed then passed on rerun.');
		expect(md.indexOf('Needs you')).toBeLessThan(md.indexOf('Merged'));
	});

	it('lists human-blocked PRs first and everything else below', () => {
		const md = formatReport({
			...base,
			merged: [{ number: 5, title: 'fix: y', url: 'u5', mergedAt: '2026-01-02T01:00:00Z' }],
			open: [
				pr({
					number: 8,
					labels: ['needs-human'],
					checks: [{ name: 'repo-gates', conclusion: 'FAILURE' }]
				}),
				pr({ number: 9, title: 'chore: z', mergeStateStatus: 'BEHIND' })
			],
			tower: {
				label: 'Tower',
				run: run({ conclusion: 'failure' }),
				numbers: []
			},
			nightly: {
				label: 'Tower nightly',
				run: run({ conclusion: 'success' }),
				numbers: ['mutation score 81.2% (floor 70%)']
			},
			flakes: [{ name: 'e2e', sha: 'abcdef1', url: 'r1' }]
		});
		const needs = md.slice(md.indexOf('## Needs you'), md.indexOf('## Merged'));
		expect(needs).toContain('#8');
		expect(needs).toContain('failing: repo-gates');
		expect(needs).not.toContain('#9');
		expect(md).toContain('[#5 fix: y](u5)');
		expect(md).toContain('[#9 chore: z](https://example.test/pr/7) (behind)');
		expect(md).toContain('**Tower:** FAILED');
		expect(md).toContain('**Tower nightly:** passed');
		expect(md).toContain('  - mutation score 81.2%');
		expect(md).toContain('e2e failed then passed on abcdef1');
	});

	it('appends the bead id only when the title lacks it and shows running runs', () => {
		const md = formatReport({
			...base,
			merged: [{ number: 1, title: 'Fix hub-xyz', url: 'u', mergedAt: '2026-01-02T00:00:00Z' }],
			tower: { label: 'Tower', run: run({ status: 'in_progress', conclusion: null }), numbers: [] }
		});
		expect(md).toContain('[#1 Fix hub-xyz](u)');
		expect(md).toContain('**Tower:** running');
	});
});
