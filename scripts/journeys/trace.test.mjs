import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	BEGIN,
	END,
	analyze,
	checkRegistry,
	renderDocs,
	spliceDocs,
	stepIdsInSource,
	summarize,
	tagsFromListing
} from './trace.mjs';

const reg = () => ({
	devices: { wall: ['wall-a', 'wall-b'], iphone: ['phone'] },
	personas: ['Kid at the wall'],
	journeys: [
		{
			id: 'J0',
			name: 'Wake',
			persona: 'Kid at the wall',
			critical: true,
			devices: ['wall'],
			steps: [
				{ id: 'J0.1', text: 'Touch.', status: 'built' },
				{ id: 'J0.2', text: 'Later.', status: 'planned' },
				{ id: 'J0.3', text: 'Fake.', status: 'built', untested: 'hardware' }
			]
		}
	]
});
const tag = (id, project = 'wall-a', file = 'tests/e2e/x.e2e.ts') => ({
	id,
	file,
	title: 't',
	project
});

test('listing: tags without @ become one entry per project', () => {
	const listing = {
		suites: [
			{
				suites: [
					{
						specs: [
							{
								file: 'a.e2e.ts',
								title: 'x',
								tags: ['J1.2', 'perf'],
								tests: [{ projectName: 'p1' }, { projectName: 'p2' }]
							}
						]
					}
				]
			}
		]
	};
	assert.deepEqual(
		tagsFromListing(listing).map((t) => [t.id, t.project]),
		[
			['J1.2', 'p1'],
			['J1.2', 'p2']
		]
	);
});

test('test.step ids are read from source', () => {
	assert.deepEqual(
		stepIdsInSource("await test.step('J4.2 pick', async () => {}); test.step(`x`)"),
		['J4.2']
	);
});

test('a clean registry with a tested built step passes', () => {
	const { problems } = analyze(reg(), [tag('J0.1'), tag('J0.1', 'wall-b')]);
	assert.deepEqual(problems, []);
});

test('a built step with no test and no reason fails', () => {
	const r = reg();
	delete r.journeys[0].steps[2].untested;
	const { problems } = analyze(r, [tag('J0.1')]);
	assert.match(problems.join('\n'), /J0\.3 is built but has no tagged test/);
});

test('an untested reason on a tested step fails', () => {
	const { problems } = analyze(reg(), [tag('J0.1'), tag('J0.3')]);
	assert.match(problems.join('\n'), /J0\.3 has tests, so drop its "untested"/);
});

test('a planned step with a test fails', () => {
	const { problems } = analyze(reg(), [tag('J0.1'), tag('J0.2')]);
	assert.match(problems.join('\n'), /J0\.2 is planned but has tests/);
});

test('a tag or test.step naming a missing step fails', () => {
	const { problems } = analyze(reg(), [tag('J0.1'), tag('J9.9')], {
		stepIds: [{ id: 'J0.7', file: 'f.ts' }]
	});
	assert.match(problems.join('\n'), /@J9\.9/);
	assert.match(problems.join('\n'), /test\.step "J0\.7"/);
});

test('a tests file must exist', () => {
	const r = reg();
	r.journeys[0].steps[2] = { id: 'J0.3', text: 'u', status: 'built', tests: ['src/gone.spec.ts'] };
	const { problems } = analyze(r, [tag('J0.1')], { fileExists: () => false });
	assert.match(problems.join('\n'), /src\/gone\.spec\.ts does not exist/);
});

test('device gaps are reported but are not problems', () => {
	const { problems, rows } = analyze(reg(), [tag('J0.1', 'wall-a')]);
	assert.deepEqual(problems, []);
	assert.deepEqual(rows[0].gaps, ['wall-b']);
	assert.equal(summarize(reg(), rows).gaps, 1);
});

test('registry ids, status, persona and devices are validated', () => {
	const r = reg();
	r.journeys[0].id = 'J1';
	r.journeys[0].persona = 'Nobody';
	r.journeys[0].steps[0].status = 'done';
	r.journeys[0].steps[1].devices = ['tv'];
	const text = checkRegistry(r).join('\n');
	assert.match(text, /journey J1 should be J0/);
	assert.match(text, /unknown persona/);
	assert.match(text, /status must be built or planned/);
	assert.match(text, /unknown device "tv"/);
});

test('docs are rendered from the registry and spliced between the markers', () => {
	const r = reg();
	const { rows } = analyze(r, [tag('J0.1')]);
	const md = renderDocs(r, rows);
	assert.match(md, /\| J0\.1 \| Touch\. \| built \| wall \| `x` \|/);
	assert.match(md, /untested: hardware/);
	const doc = `intro\n${BEGIN}\nold\n${END}\noutro\n`;
	const next = spliceDocs(doc, md);
	assert.ok(next.includes(md) && next.startsWith('intro') && next.endsWith('outro\n'));
	assert.equal(spliceDocs(next, md), next);
	assert.equal(spliceDocs('no markers', md), null);
});
