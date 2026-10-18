import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cardArgs, clipArgs, concatArgs, concatList } from './assemble.mjs';
import { fitVideo, grepFor, parseArgs, planJourneys, projectsFor } from './plan.mjs';
import { counts, endCard, esc, renderReport, stepResults } from './report.mjs';

const registry = {
	journeys: [
		{
			id: 'J1',
			name: 'Kid <does> a job',
			persona: 'Kid at the wall',
			steps: [
				{ id: 'J1.1', text: 'Pick a name.', status: 'built' },
				{ id: 'J1.2', text: 'Tap a job.', status: 'built' },
				{ id: 'J1.3', text: 'Later.', status: 'planned' },
				{ id: 'J1.4', text: 'No test.', status: 'built', untested: 'backend only' }
			]
		},
		{
			id: 'J2',
			name: 'Other',
			persona: 'Everyone',
			steps: [{ id: 'J2.1', text: 'x', status: 'built' }]
		}
	]
};
const tag = (id, file, title, project = 'wall') => ({ id, file, title, project });

test('parseArgs: defaults, lists and errors', () => {
	assert.deepEqual(parseArgs([]).devices, ['wall-landscape']);
	const o = parseArgs(['--only', 'J1,J4', '--device', 'ipad', '--skip-build', '--port', '4401']);
	assert.deepEqual([o.only, o.devices, o.skipBuild, o.port], [['J1', 'J4'], ['ipad'], true, 4401]);
	assert.equal(parseArgs(['--device', 'all']).devices.length, 4);
	assert.throws(() => parseArgs(['--device', 'tv']), /--device is/);
	assert.throws(() => parseArgs(['--nope']), /unknown argument/);
	assert.throws(() => parseArgs(['--only']), /needs journey ids/);
});

test('projectsFor maps devices to the playwright.config.ts projects without duplicates', () => {
	assert.deepEqual(projectsFor(['ipad', 'ipad-portrait', 'iphone']), [
		'ipad-landscape-webkit',
		'ipad-portrait-webkit',
		'iphone-webkit'
	]);
});

test('fitVideo scales the long side down to 1280 and keeps even sizes', () => {
	assert.deepEqual(fitVideo({ width: 2560, height: 1440 }), { width: 1280, height: 720 });
	assert.deepEqual(fitVideo({ width: 1440, height: 2560 }), { width: 720, height: 1280 });
	assert.deepEqual(fitVideo({ width: 393, height: 659 }), { width: 394, height: 660 });
});

test('planJourneys: one entry per test, in step order, only this project', () => {
	const tagged = [
		tag('J1.2', 'b.e2e.ts', 'tap @J1.2 @J1.1'),
		tag('J1.1', 'b.e2e.ts', 'tap @J1.2 @J1.1'),
		tag('J1.1', 'a.e2e.ts', 'pick @J1.1'),
		tag('J1.2', 'z.e2e.ts', 'other device', 'phone'),
		tag('J2.1', 'c.e2e.ts', 'two @J2.1')
	];
	const plans = planJourneys(registry, tagged, 'wall');
	assert.equal(plans.length, 2);
	assert.deepEqual(
		plans[0].tests.map((t) => [t.file, t.ids]),
		[
			['a.e2e.ts', ['J1.1']],
			['b.e2e.ts', ['J1.1', 'J1.2']]
		]
	);
	assert.equal(planJourneys(registry, tagged, 'wall', ['J2']).length, 1);
	assert.deepEqual(planJourneys(registry, tagged, 'nothing', ['J1'])[0].tests, []);
	assert.throws(() => planJourneys(registry, tagged, 'wall', ['J9']), /No journey J9/);
});

test('grepFor matches J1 steps but not J10', () => {
	const re = new RegExp(grepFor(planJourneys(registry, [], 'wall', ['J1'])));
	assert.ok(re.test('x @J1.2'));
	assert.ok(!re.test('x @J10.2'));
	assert.ok(!re.test('x @J2.1'));
});

test('assembly command lines', () => {
	const size = { width: 1280, height: 720 };
	const clip = clipArgs('in.webm', 'out.mp4', size).join(' ');
	assert.match(clip, /-i in\.webm .*scale=1280:720.*libx264.* out\.mp4$/);
	const card = cardArgs('c.png', 'o.mp4', size, 4);
	assert.deepEqual(card.slice(card.indexOf('-loop'), card.indexOf('-loop') + 5), [
		'-loop',
		'1',
		'-t',
		'4',
		'-i'
	]);
	assert.equal(concatList(["a'b.mp4", 'c.mp4']), "file 'a'\\''b.mp4'\nfile 'c.mp4'\n");
	assert.deepEqual(concatArgs('l.txt', 'o.mp4').slice(-4), ['l.txt', '-c', 'copy', 'o.mp4']);
});

const tests = [
	{ ids: ['J1.1'], title: 'pick', status: 'passed', video: 'a.webm' },
	{ ids: ['J1.2'], title: 'tap', status: 'passed' },
	{ ids: ['J1.2'], title: 'tap2', status: 'failed', error: 'expected 3' }
];

test('stepResults: failed beats passed; planned, untested and skipped are distinct', () => {
	const r = stepResults(registry.journeys[0], tests);
	assert.deepEqual(
		r.map((s) => s.result),
		['passed', 'failed', 'planned', 'no test']
	);
	assert.equal(r[1].note, 'expected 3');
	assert.equal(r[3].note, 'backend only');
	const skipped = stepResults(registry.journeys[0], [
		{ ids: ['J1.1'], title: 'p', status: 'skipped' }
	]);
	assert.equal(skipped[0].result, 'skipped');
	assert.deepEqual(counts(r), { passed: 1, failed: 1, other: 2 });
});

test('report and cards escape HTML and show the counts', () => {
	assert.equal(esc('<&>"'), '&#60;&#38;&#62;&#34;');
	const steps = stepResults(registry.journeys[0], tests);
	const card = endCard(registry.journeys[0], 'wall', steps);
	assert.match(card, /J1: 1 passed, 1 failed/);
	assert.match(card, /J1\.2 {2}FAILED/);
	const html = renderReport({
		generated: 'now',
		devices: [
			{
				name: 'wall-landscape',
				project: 'wall-landscape-1440p',
				journeys: [{ journey: registry.journeys[0], steps, video: 'p/J1.mp4', tests }]
			}
		]
	});
	assert.match(html, /Kid &#60;does&#62; a job/);
	assert.match(html, /href="p\/J1\.mp4"/);
	assert.match(html, /1 steps passed, 1 failed, 2 without a result/);
	assert.match(html, /href="a\.webm"/);
});
