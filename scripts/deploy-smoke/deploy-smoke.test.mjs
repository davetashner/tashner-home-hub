import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	createGuard,
	hasSidewaysScroll,
	isReadOnlyMethod,
	judge,
	PAGES,
	parseArgs,
	piCommand
} from './lib.mjs';

const fakeRoute = (method, url = 'https://x.test/api/y') => {
	const calls = [];
	return {
		calls,
		request: () => ({ method: () => method, url: () => url }),
		continue: () => calls.push('continue'),
		abort: (why) => calls.push(`abort:${why}`)
	};
};

test('only GET and HEAD are read-only', () => {
	for (const m of ['GET', 'get', 'HEAD']) assert.ok(isReadOnlyMethod(m));
	for (const m of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) assert.ok(!isReadOnlyMethod(m));
});

test('guard continues reads, aborts and records writes', () => {
	const g = createGuard();
	const r = fakeRoute('GET');
	g.handler(r);
	assert.deepEqual(r.calls, ['continue']);
	assert.deepEqual(g.attempts, []);
	const w = fakeRoute('POST', 'https://x.test/api/completions');
	g.handler(w);
	assert.deepEqual(w.calls, ['abort:blockedbyclient']);
	assert.deepEqual(g.attempts, ['POST https://x.test/api/completions']);
});

test('parseArgs requires a base and normalises it', () => {
	assert.throws(() => parseArgs([]), /--base is required/);
	assert.throws(() => parseArgs(['--base', 'nope']), /not a URL/);
	assert.throws(() => parseArgs(['--base', 'ftp://x']), /http/);
	const o = parseArgs(
		['--base', 'https://hub.example.com/path'],
		new Date('2026-01-02T03:04:05.678Z')
	);
	assert.equal(o.base, 'https://hub.example.com');
	assert.equal(o.profiles.length, 5);
	assert.equal(o.pages.length, PAGES.length);
	assert.equal(o.pi, false);
	assert.equal(o.out, 'reports/deploy-smoke/2026-01-02T03-04-05-678Z');
});

test('parseArgs filters devices and pages, and rejects unknowns', () => {
	const o = parseArgs([
		'--base',
		'http://h:1',
		'--device',
		'iphone-webkit',
		'--only',
		'home,lists',
		'--pi',
		'--timeout',
		'5000',
		'--out',
		'o'
	]);
	assert.deepEqual(
		o.profiles.map((p) => p.name),
		['iphone-webkit']
	);
	assert.deepEqual(
		o.pages.map((p) => p.id),
		['home', 'lists']
	);
	assert.ok(o.pi);
	assert.equal(o.timeout, 5000);
	assert.equal(o.out, 'o');
	assert.throws(() => parseArgs(['--base', 'http://h', '--device', 'tv']), /unknown device: tv/);
	assert.throws(() => parseArgs(['--base', 'http://h', '--only', 'nope']), /unknown page/);
	assert.throws(() => parseArgs(['--base', 'http://h', '--bogus']), /unknown argument/);
	assert.throws(() => parseArgs(['--base']), /needs a value/);
	assert.throws(() => parseArgs(['--base', 'http://h', '--timeout', '0']), /positive/);
});

test('smoke pages are all GET paths and settings expects the unlock bounce', () => {
	assert.ok(PAGES.every((p) => p.path.startsWith('/')));
	assert.ok(
		PAGES.find((p) => p.id === 'settings').expectUrl.test('https://h/unlock?next=%2Fsettings')
	);
});

test('judge reports each kind of failure', () => {
	const good = {
		status: 200,
		finalUrl: 'https://h/',
		hydrated: true,
		landmarkVisible: true,
		scrollWidth: 100,
		innerWidth: 100,
		consoleErrors: []
	};
	assert.deepEqual(judge({ landmark: 'main' }, good), []);
	const bad = {
		...good,
		status: 500,
		hydrated: false,
		landmarkVisible: false,
		scrollWidth: 300,
		consoleErrors: ['boom']
	};
	assert.equal(judge({ landmark: 'main' }, bad).length, 5);
	assert.match(judge({ landmark: 'main', expectUrl: /unlock/ }, good)[0], /landed on/);
});

test('sideways scroll tolerates 1px rounding', () => {
	assert.ok(!hasSidewaysScroll({ scrollWidth: 101, innerWidth: 100 }));
	assert.ok(hasSidewaysScroll({ scrollWidth: 102, innerWidth: 100 }));
});

test('piCommand points at kioskctl screenshot', () => {
	assert.match(piCommand(), /kioskctl\.mjs screenshot --out /);
});
