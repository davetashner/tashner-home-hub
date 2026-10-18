// What the caption banner says (fixture.mjs draws it). Pure, for journey-videos.test.mjs.

const TAG = /\s*@J\d+(?:\.\d+)?/g;

/** A test's title without its @J tags. */
export const plainTitle = (title) => title.replace(TAG, '').trim();

/** The tag ids on a title, in order: 'tap @J1.2 @J2.1' -> ['J1.2', 'J2.1']. */
export const tagIds = (title) => [...title.matchAll(/@(J\d+(?:\.\d+)?)/g)].map((m) => m[1]);

/** The banner's content before the test runs: step ids, the registry's text, the test's name. */
export function captionFor(registry, title, file) {
	const steps = new Map();
	for (const j of registry.journeys) for (const s of j.steps) steps.set(s.id, s.text);
	const ids = tagIds(title).filter((id) => steps.has(id));
	return {
		id: ids.join(' + ') || 'untagged',
		step: ids.map((id) => steps.get(id)).join(' / '),
		test: `${file} › ${plainTitle(title)}`,
		note: '',
		state: 'running'
	};
}

/** The banner once the test ended: passed, or failed with the first line of the assertion. */
export function finalCaption(caption, status, errorMessage) {
	const passed = status === 'passed';
	return {
		...caption,
		state: passed ? 'passed' : status === 'skipped' ? 'skipped' : 'failed',
		note: passed ? '' : firstLine(errorMessage)
	};
}

/** First useful line of a Playwright error, without ANSI colour codes, cut to `max` characters. */
export function firstLine(message = '', max = 160) {
	// eslint-disable-next-line no-control-regex
	const clean = message.replace(/\u001b\[[0-9;]*m/g, '');
	const line =
		clean
			.split('\n')
			.map((l) => l.trim())
			.find((l) => l && !/^Error:?$/.test(l)) ?? '';
	return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}
