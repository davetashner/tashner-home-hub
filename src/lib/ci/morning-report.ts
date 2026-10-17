// Pure aggregation and formatting for the daily morning report (ADR 0002, Tier 3).
// No I/O here: scripts/morning-report.mjs fetches from the GitHub API and calls these.
// Loaded directly by Node (type stripping), so keep it to erasable TypeScript: no enums.

export type MergedPr = { number: number; title: string; url: string; mergedAt: string };
export type OpenPr = {
	number: number;
	title: string;
	url: string;
	mergeStateStatus: string;
	labels: string[];
	checks: { name: string; conclusion: string | null }[];
};
export type WorkflowRun = {
	id: number;
	name: string;
	conclusion: string | null;
	status: string;
	url: string;
	createdAt: string;
	event: string;
};
export type JobResult = { name: string; conclusion: string | null };
export type RunAttempts = { runId: number; sha: string; url: string; attempts: JobResult[][] };
export type NightlyReport = {
	label: string;
	run: WorkflowRun | null;
	numbers: string[];
};

export type ReportData = {
	date: string;
	merged: MergedPr[];
	open: OpenPr[];
	tower: NightlyReport;
	nightly: NightlyReport;
	flakes: { name: string; sha: string; url: string }[];
};

const BAD_CHECK = new Set(['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED']);
const BAD_RUN = new Set([
	'failure',
	'timed_out',
	'cancelled',
	'action_required',
	'startup_failure'
]);

export function beadId(title: string): string | null {
	return /\b(hub-[a-z0-9]+(?:\.[a-z0-9]+)*)\b/i.exec(title)?.[1]?.toLowerCase() ?? null;
}

export function reportTitle(date: string): string {
	return `Morning report ${date}`;
}

export function isoDay(d: Date): string {
	return d.toISOString().slice(0, 10);
}

export function mergedSince(prs: MergedPr[], since: Date): MergedPr[] {
	return prs
		.filter((p) => p.mergedAt && new Date(p.mergedAt) >= since)
		.sort((a, b) => a.mergedAt.localeCompare(b.mergedAt));
}

export function failingChecks(pr: OpenPr): string[] {
	const bad = pr.checks.filter((c) => c.conclusion && BAD_CHECK.has(c.conclusion));
	return [...new Set(bad.map((c) => c.name))];
}

export function needsHuman(prs: OpenPr[]): OpenPr[] {
	return prs.filter((p) => p.labels.includes('needs-human'));
}

/** Newest run of a workflow by creation time, or null when there are none. */
export function latestRun(runs: WorkflowRun[]): WorkflowRun | null {
	return [...runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}

/** Jobs that failed in an earlier attempt of a run and passed in the final one. */
export function detectFlakes(runs: RunAttempts[]): ReportData['flakes'] {
	const out: ReportData['flakes'] = [];
	for (const run of runs) {
		const last = run.attempts[run.attempts.length - 1] ?? [];
		const passed = new Set(last.filter((j) => j.conclusion === 'success').map((j) => j.name));
		const seen = new Set<string>();
		for (const attempt of run.attempts.slice(0, -1)) {
			for (const job of attempt) {
				if (job.conclusion !== 'failure' || !passed.has(job.name) || seen.has(job.name)) continue;
				seen.add(job.name);
				out.push({ name: job.name, sha: run.sha.slice(0, 7), url: run.url });
			}
		}
	}
	return out;
}

const num = (v: unknown): number | null => (typeof v === 'number' && isFinite(v) ? v : null);

/** Key numbers from a nightly JSON artifact. Skips anything absent; never throws. */
export function summarizeArtifact(kind: 'soak' | 'mutation', json: unknown): string[] {
	if (!json || typeof json !== 'object') return [];
	const o = json as Record<string, unknown>;
	const out: string[] = [];
	if (kind === 'mutation') {
		const score = num(o.mutationScore ?? o.score);
		if (score !== null) out.push(`mutation score ${score.toFixed(1)}% (floor 70%)`);
	} else {
		const heap = num(o.heapGrowthPct ?? o.heapGrowthPercent);
		if (heap !== null) out.push(`soak heap growth ${heap.toFixed(1)}% (limit 20%)`);
		const reconnects = num(o.sseReconnects);
		if (reconnects !== null) out.push(`${reconnects} SSE reconnects`);
	}
	return out;
}

const icon = (c: string | null, status = 'completed') =>
	status !== 'completed' ? 'running' : c === 'success' ? 'passed' : (c ?? 'unknown');

function runLine(r: NightlyReport): string {
	if (!r.run) return `- **${r.label}:** no run found (workflow not present yet or no runs).`;
	const when = r.run.createdAt.slice(0, 16).replace('T', ' ');
	const bad = r.run.status === 'completed' && BAD_RUN.has(r.run.conclusion ?? '');
	const head = `- **${r.label}:** ${bad ? 'FAILED' : icon(r.run.conclusion, r.run.status)} (${r.run.event}, ${when} UTC) [run](${r.run.url})`;
	return [head, ...r.numbers.map((n) => `  - ${n}`)].join('\n');
}

function prLine(p: { number: number; title: string }): string {
	const bead = beadId(p.title);
	return `#${p.number} ${p.title}${bead && !p.title.toLowerCase().includes(bead) ? ` [${bead}]` : ''}`;
}

export function formatReport(d: ReportData): string {
	const human = needsHuman(d.open);
	const lines: string[] = [`## Needs you`, ''];
	if (human.length === 0) lines.push('Nothing is waiting on you.');
	for (const p of human) {
		const failing = failingChecks(p);
		lines.push(
			`- [ ] [${prLine(p)}](${p.url}) (${p.mergeStateStatus.toLowerCase()}${failing.length ? `; failing: ${failing.join(', ')}` : ''})`
		);
	}

	lines.push('', `## Merged (last 24 h): ${d.merged.length}`, '');
	if (d.merged.length === 0) lines.push('No PRs merged.');
	for (const p of d.merged) lines.push(`- [${prLine(p)}](${p.url})`);

	const others = d.open.filter((p) => !human.includes(p));
	lines.push('', `## Open and blocked: ${others.length}`, '');
	if (others.length === 0) lines.push('No other open PRs.');
	for (const p of others) {
		const failing = failingChecks(p);
		const note = failing.length ? `; failing: ${failing.join(', ')}` : '';
		lines.push(`- [${prLine(p)}](${p.url}) (${p.mergeStateStatus.toLowerCase()}${note})`);
	}

	lines.push('', '## Overnight runs', '', runLine(d.tower), runLine(d.nightly));
	lines.push('- **Pi fps:** not wired yet (hub-ugl.7 / hub-ugl.10)');
	lines.push('- **AI design notes:** not wired yet (hub-ugl.7 / hub-ugl.10)');

	lines.push('', '## Flakes', '');
	if (d.flakes.length === 0) lines.push('No job failed then passed on rerun.');
	for (const f of d.flakes)
		lines.push(`- ${f.name} failed then passed on ${f.sha} ([run](${f.url}))`);

	lines.push('', '---', '_Generated by `.github/workflows/morning-report.yml`._');
	return lines.join('\n') + '\n';
}
