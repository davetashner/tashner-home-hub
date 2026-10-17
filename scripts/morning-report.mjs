// Daily morning report (ADR 0002, Tier 3). Reads GitHub state for the last 24 h and
// creates/updates one "Morning report YYYY-MM-DD" issue, closing the previous ones.
// Usage: GITHUB_TOKEN=... node scripts/morning-report.mjs [--dry-run]
// --dry-run prints the markdown and writes nothing. The token is never printed.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	detectFlakes,
	formatReport,
	isoDay,
	latestRun,
	mergedSince,
	reportTitle,
	summarizeArtifact
} from '../src/lib/ci/morning-report.ts';

const DRY = process.argv.includes('--dry-run');
const TOKEN = process.env.GITHUB_TOKEN;
const REPO = process.env.GITHUB_REPOSITORY ?? 'davetashner/tashner-home-hub';
const LABEL = 'morning-report';
const API = 'https://api.github.com';
if (!TOKEN) {
	console.error('GITHUB_TOKEN is not set');
	process.exit(1);
}

const headers = {
	authorization: `Bearer ${TOKEN}`,
	accept: 'application/vnd.github+json',
	'x-github-api-version': '2022-11-28',
	'user-agent': 'tashner-home-hub-morning-report'
};

async function api(path, { method = 'GET', body, allow = [] } = {}) {
	const res = await fetch(path.startsWith('http') ? path : `${API}/repos/${REPO}${path}`, {
		method,
		headers: body ? { ...headers, 'content-type': 'application/json' } : headers,
		body: body ? JSON.stringify(body) : undefined
	});
	if (allow.includes(res.status)) return null;
	if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status}`);
	return res.status === 204 ? null : res.json();
}

async function graphql(query, variables) {
	const res = await fetch(`${API}/graphql`, {
		method: 'POST',
		headers,
		body: JSON.stringify({ query, variables })
	});
	const json = await res.json();
	if (!res.ok || json.errors) throw new Error(`graphql: HTTP ${res.status}`);
	return json.data;
}

const now = new Date();
const since = new Date(now.getTime() - 24 * 3600 * 1000);
const [owner, name] = REPO.split('/');

async function mergedPrs() {
	const prs = await api('/pulls?state=closed&sort=updated&direction=desc&per_page=50');
	return mergedSince(
		prs
			.filter((p) => p.merged_at)
			.map((p) => ({ number: p.number, title: p.title, url: p.html_url, mergedAt: p.merged_at })),
		since
	);
}

async function openPrs() {
	const data = await graphql(
		`
			query ($owner: String!, $name: String!) {
				repository(owner: $owner, name: $name) {
					pullRequests(states: OPEN, first: 50, orderBy: { field: CREATED_AT, direction: ASC }) {
						nodes {
							number
							title
							url
							mergeStateStatus
							labels(first: 20) {
								nodes {
									name
								}
							}
							commits(last: 1) {
								nodes {
									commit {
										statusCheckRollup {
											contexts(first: 60) {
												nodes {
													... on CheckRun {
														name
														conclusion
													}
													... on StatusContext {
														context
														state
													}
												}
											}
										}
									}
								}
							}
						}
					}
				}
			}
		`,
		{ owner, name }
	);
	return data.repository.pullRequests.nodes.map((p) => ({
		number: p.number,
		title: p.title,
		url: p.url,
		mergeStateStatus: p.mergeStateStatus,
		labels: p.labels.nodes.map((l) => l.name),
		checks: (p.commits.nodes[0]?.commit.statusCheckRollup?.contexts.nodes ?? []).map((c) => ({
			name: c.name ?? c.context,
			conclusion: c.conclusion ?? c.state ?? null
		}))
	}));
}

const toRun = (r) => ({
	id: r.id,
	name: r.name,
	conclusion: r.conclusion,
	status: r.status,
	url: r.html_url,
	createdAt: r.created_at,
	event: r.event
});

/** Latest run of a workflow file, or null if the workflow does not exist (yet). */
async function workflowRun(file) {
	const res = await api(`/actions/workflows/${file}/runs?per_page=10`, { allow: [404] });
	return latestRun((res?.workflow_runs ?? []).map(toRun));
}

/** Key numbers from soak/mutation JSON artifacts of a run. Best effort; never throws. */
async function artifactNumbers(run) {
	if (!run) return [];
	const out = [];
	try {
		const { artifacts } = await api(`/actions/runs/${run.id}/artifacts?per_page=50`);
		for (const a of artifacts.filter((x) => !x.expired)) {
			const kind = /soak/i.test(a.name) ? 'soak' : /mutation/i.test(a.name) ? 'mutation' : null;
			if (!kind) continue;
			const res = await fetch(a.archive_download_url, { headers });
			if (!res.ok) continue;
			const dir = mkdtempSync(join(tmpdir(), 'morning-'));
			const zip = join(dir, 'a.zip');
			writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
			const listing = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' });
			const json = listing.split('\n').find((f) => f.endsWith('.json'));
			if (!json) continue;
			const text = execFileSync('unzip', ['-p', zip, json], { encoding: 'utf8' });
			out.push(...summarizeArtifact(kind, JSON.parse(text)));
		}
	} catch (e) {
		console.error(`artifact summary skipped: ${e.message}`);
	}
	return out;
}

async function flakes() {
	const { workflow_runs } = await api(
		`/actions/workflows/ci.yml/runs?per_page=100&created=%3E%3D${since.toISOString()}`
	);
	const out = [];
	for (const r of workflow_runs.filter((x) => x.run_attempt > 1 && x.status === 'completed')) {
		const attempts = [];
		for (let n = 1; n <= r.run_attempt; n++) {
			const { jobs } = await api(`/actions/runs/${r.id}/attempts/${n}/jobs?per_page=100`);
			attempts.push(jobs.map((j) => ({ name: j.name, conclusion: j.conclusion })));
		}
		out.push({ runId: r.id, sha: r.head_sha, url: r.html_url, attempts });
	}
	return detectFlakes(out);
}

async function ensureLabel() {
	await api('/labels', {
		method: 'POST',
		body: { name: LABEL, color: '0e8a16', description: 'Daily overnight summary' },
		allow: [422]
	});
}

async function publish(title, body) {
	await ensureLabel();
	const open = await api(`/issues?labels=${LABEL}&state=open&per_page=30`);
	const reports = open.filter((i) => !i.pull_request);
	const today = reports.find((i) => i.title === title);
	for (const old of reports.filter((i) => i !== today)) {
		await api(`/issues/${old.number}`, { method: 'PATCH', body: { state: 'closed' } });
	}
	if (today) {
		await api(`/issues/${today.number}`, { method: 'PATCH', body: { body } });
		return today.html_url;
	}
	return (await api('/issues', { method: 'POST', body: { title, body, labels: [LABEL] } }))
		.html_url;
}

const [merged, open, towerRun, nightlyRun, flakeList] = await Promise.all([
	mergedPrs(),
	openPrs(),
	workflowRun('tower.yml'),
	workflowRun('tower-nightly.yml'),
	flakes()
]);
const data = {
	date: isoDay(now),
	merged,
	open,
	tower: { label: 'Tower', run: towerRun, numbers: [] },
	nightly: { label: 'Tower nightly', run: nightlyRun, numbers: await artifactNumbers(nightlyRun) },
	flakes: flakeList
};
const markdown = formatReport(data);

if (DRY) {
	process.stdout.write(`# ${reportTitle(data.date)}\n\n${markdown}` + '\n');
} else {
	process.stdout.write(`Report: ${await publish(reportTitle(data.date), markdown)}` + '\n');
}
