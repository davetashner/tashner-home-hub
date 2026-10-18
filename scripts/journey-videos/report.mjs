// The evidence report and the title/end cards (record.mjs writes them). Pure string builders,
// tested in journey-videos.test.mjs. Videos are linked by path relative to the report.

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * Each step of a journey with its result from the tests tagged with it.
 * `tests`: [{ ids, title, file, status, error, video }]. A step is failed if any of its tests
 * failed, passed if all did; with no test it is planned, untested (built, with the registry's
 * reason) or skipped (its tests did not run on this device).
 */
export function stepResults(journey, tests) {
	return journey.steps.map((step) => {
		const mine = tests.filter((t) => t.ids.includes(step.id));
		let result;
		if (mine.some((t) => ['failed', 'timedOut', 'interrupted'].includes(t.status)))
			result = 'failed';
		else if (mine.length && mine.every((t) => t.status === 'passed')) result = 'passed';
		else if (mine.length) result = 'skipped';
		else result = step.status === 'planned' ? 'planned' : 'no test';
		const failure = mine.find((t) => t.error);
		return {
			id: step.id,
			text: step.text,
			result,
			note: result === 'no test' ? (step.untested ?? '') : (failure?.error ?? ''),
			tests: mine.map((t) => t.title)
		};
	});
}

/** Counts over a list of step results. */
export function counts(steps) {
	const n = { passed: 0, failed: 0, other: 0 };
	for (const s of steps) {
		if (s.result === 'passed') n.passed++;
		else if (s.result === 'failed') n.failed++;
		else n.other++;
	}
	return n;
}

/** HTML for a title or end card, drawn at the video's size and screenshotted. */
export function cardHtml({ heading, sub = '', lines = [], tone = 'info' }) {
	const colour = { info: '#3ea6ff', passed: '#3ddc84', failed: '#ff4d4d' }[tone] ?? '#3ea6ff';
	return `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:#0b1b2b;color:#fff;font-family:system-ui,sans-serif}
body{display:flex;flex-direction:column;justify-content:center;padding:0 8vmin;box-sizing:border-box;border-left:2vmin solid ${colour}}
h1{font-size:6vmin;margin:0 0 2vmin;line-height:1.15}
p{font-size:3vmin;margin:0 0 1.5vmin;color:#9cc9f0}
li{font-size:2.8vmin;margin:.6vmin 0;list-style:none}
.passed{color:#3ddc84}.failed{color:#ff4d4d}.other{color:#b8b8b8}
</style><h1>${esc(heading)}</h1><p>${esc(sub)}</p><ul style="padding:0">${lines
		.map((l) => `<li class="${esc(l.tone ?? '')}">${esc(l.text)}</li>`)
		.join('')}</ul>`;
}

export function titleCard(journey, device) {
	return cardHtml({
		heading: `${journey.id}  ${journey.name}`,
		sub: `${journey.persona} · ${device}`
	});
}

export function endCard(journey, device, steps) {
	const n = counts(steps);
	return cardHtml({
		heading: `${journey.id}: ${n.passed} passed, ${n.failed} failed`,
		sub: `${journey.name} · ${device}${n.other ? ` · ${n.other} without a test here` : ''}`,
		tone: n.failed ? 'failed' : 'passed',
		lines: steps.map((s) => ({
			tone: s.result === 'passed' ? 'passed' : s.result === 'failed' ? 'failed' : 'other',
			text: `${s.id}  ${s.result.toUpperCase()}  ${s.text}`
		}))
	});
}

/**
 * The HTML report. `devices`: [{ name, project, journeys: [{ journey, steps, video, tests }] }]
 * where `video` is the assembled mp4 (or null) and each test has { title, status, video, error }.
 */
export function renderReport({ generated, devices }) {
	const all = devices.flatMap((d) => d.journeys.flatMap((j) => j.steps));
	const n = counts(all);
	const link = (href, label) => (href ? `<a href="${esc(href)}">${esc(label)}</a>` : '');
	const sections = devices
		.map(
			(d) =>
				`<section><h2>${esc(d.name)} <small>${esc(d.project)}</small></h2>${d.journeys
					.map((j) => {
						const c = counts(j.steps);
						return `<article><h3>${esc(j.journey.id)} ${esc(j.journey.name)} <span class="${c.failed ? 'failed' : 'passed'}">${c.passed} passed, ${c.failed} failed</span></h3>
<p>${esc(j.journey.persona)}. ${j.video ? link(j.video, 'Watch the journey video') : 'No assembled video (ffmpeg missing or no tests): see the clips below.'}</p>
<table><thead><tr><th>Step</th><th>What happens</th><th>Result</th><th>Tests</th></tr></thead><tbody>${j.steps
							.map(
								(s) =>
									`<tr><td>${esc(s.id)}</td><td>${esc(s.text)}</td><td class="r ${esc(s.result.replace(' ', '-'))}">${esc(s.result)}${s.note ? `<br><small>${esc(s.note)}</small>` : ''}</td><td>${esc(s.tests.join('; '))}</td></tr>`
							)
							.join('')}</tbody></table>
<details><summary>${j.tests.length} clip(s)</summary><ul>${j.tests
							.map(
								(t) =>
									`<li class="${esc(t.status)}">${esc(t.status)}: ${esc(t.title)} ${link(t.video, 'clip')}${t.error ? `<br><small>${esc(t.error)}</small>` : ''}</li>`
							)
							.join('')}</ul></details></article>`;
					})
					.join('')}</section>`
		)
		.join('\n');
	return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Journey evidence report</title><style>
body{font:15px/1.45 system-ui,sans-serif;margin:2rem auto;max-width:72rem;padding:0 1rem;background:#fff;color:#111}
table{border-collapse:collapse;width:100%;margin:.5rem 0}td,th{border:1px solid #ccc;padding:.35rem .5rem;text-align:left;vertical-align:top}
.passed{color:#0a7a3a}.failed{color:#b00020}td.r.passed{background:#e6f6ec}td.r.failed{background:#fde8ea}
td.r.planned,td.r.no-test,td.r.skipped{background:#f1f1f1}small{color:#555}
@media (prefers-color-scheme:dark){body{background:#111;color:#eee}td,th{border-color:#444}td.r.passed{background:#12351f}td.r.failed{background:#3d1519}td.r.planned,td.r.no-test,td.r.skipped{background:#222}small{color:#aaa}.passed{color:#5fd48a}.failed{color:#ff7a8a}}
</style><h1>Journey evidence report</h1>
<p>Generated ${esc(generated)}. ${n.passed} steps passed, ${n.failed} failed, ${n.other} without a result on these devices.</p>
${sections}</html>`;
}
