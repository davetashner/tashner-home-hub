<script lang="ts">
	import { onMount } from 'svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import OnScreenKeyboard from './OnScreenKeyboard.svelte';
	import { maintenanceDue } from './maintenance-due.svelte.js';
	import {
		MAINTENANCE_FREQUENCIES,
		MAINTENANCE_NOTES_MAX,
		MAINTENANCE_TIME_MAX,
		MAINTENANCE_TITLE_MAX,
		dueCount,
		dueLabel,
		formatDay,
		frequencyLabel,
		nextDueAfter,
		sortTasks,
		statusOf,
		type MaintenanceStatus,
		type MaintenanceTaskLike
	} from '#lib/domain/maintenance.js';
	import { createLiveChannel } from '#lib/domain/live-events.js';
	import { deliver } from '#lib/offline/client.js';

	/** House jobs on a schedule (hub-6zbd): soonest due first, Done in one tap. */
	let { wall, adult }: { wall: boolean; adult: boolean } = $props();

	type Task = MaintenanceTaskLike;
	interface Draft {
		id: string | null;
		title: string;
		intervalMonths: number | null;
		lastDone: string;
		nextDue: string;
		estTime: string;
		notes: string;
	}

	const POLL_MS = 60_000;
	const JSON_HEADERS = { 'content-type': 'application/json' };

	let tasks = $state<Task[]>([]);
	/** The household's day from the server, never the browser's clock. */
	let today = $state('');
	let loaded = $state(false);
	let error = $state('');
	let draft = $state<Draft | null>(null);
	let confirming = $state(false);
	/** What a Done tap replaced, so Undo can put it back. */
	let undo = $state<{ id: string; lastDone: string | null; nextDue: string | null } | null>(null);
	let pending = 0;
	/** Writes go out one at a time, in tap order: a quick Done, Undo, Done must land as tapped. */
	let chain: Promise<unknown> = Promise.resolve();
	/** A new job's temp id to its real one: a tap on it before the add answers is sent there. */
	const realIds: Record<string, string> = {};
	const realId = (id: string) => realIds[id] ?? id;
	function serial<T>(fn: () => Promise<T>): Promise<T> {
		const next = chain.then(fn);
		chain = next.catch(() => undefined);
		return next;
	}

	const sorted = $derived(sortTasks(tasks));

	$effect(() => {
		if (today) maintenanceDue.count = dueCount(tasks, today);
	});

	async function refresh() {
		try {
			const res = await fetch('/api/maintenance');
			if (!res.ok) return;
			const data = (await res.json()) as { today: string; tasks: Task[] };
			if (pending > 0) return;
			today = data.today;
			tasks = data.tasks;
			loaded = true;
		} catch {
			// Offline: keep what we have.
		}
	}

	onMount(() => {
		void refresh();
		const channel = createLiveChannel({
			url: '/api/events',
			topics: ['lists'],
			create: (url) => new EventSource(url),
			onEvent: () => void refresh(),
			onOpen: () => void refresh()
		});
		channel.start();
		const timer = setInterval(() => void refresh(), POLL_MS);
		return () => {
			channel.stop();
			clearInterval(timer);
		};
	});

	async function run(fn: () => Promise<boolean>, failure: string) {
		pending++;
		error = '';
		// Offline or a network error counts as a failure: the refresh below shows the truth.
		const ok = await serial(fn).catch(() => false);
		pending--;
		if (!ok) error = failure;
		await refresh();
	}

	function patchLocal(id: string, change: Partial<Task>) {
		tasks = tasks.map((t) => (realId(t.id) === realId(id) ? { ...t, ...change } : t));
	}

	async function markDone(task: Task) {
		if (!today) return;
		undo = { id: task.id, lastDone: task.lastDone, nextDue: task.nextDue };
		patchLocal(task.id, { lastDone: today, nextDue: nextDueAfter(today, task.intervalMonths) });
		pending++;
		// Queued when offline: the day is sent with it, so a late replay lands on the right day.
		const date = today;
		const r = await serial(() =>
			deliver({
				kind: 'check',
				url: `/api/maintenance/${realId(task.id)}/done`,
				body: { date },
				choreId: realId(task.id)
			})
		);
		pending--;
		if (!r.sent && !r.queued) error = `Could not mark "${task.title}" done.`;
		if (r.sent || !r.queued) await refresh();
	}

	async function undoDone() {
		if (!undo) return;
		const { id, lastDone, nextDue } = undo;
		undo = null;
		patchLocal(id, { lastDone, nextDue });
		await run(async () => {
			const res = await fetch(`/api/maintenance/${realId(id)}`, {
				method: 'PATCH',
				headers: JSON_HEADERS,
				body: JSON.stringify({ lastDone, nextDue })
			});
			return res.ok;
		}, 'Could not undo.');
	}

	function startAdd() {
		undo = null;
		confirming = false;
		draft = {
			id: null,
			title: '',
			intervalMonths: 12,
			lastDone: '',
			nextDue: '',
			estTime: '',
			notes: ''
		};
	}

	function startEdit(task: Task) {
		undo = null;
		confirming = false;
		draft = {
			id: task.id,
			title: task.title,
			intervalMonths: task.intervalMonths,
			lastDone: task.lastDone ?? '',
			nextDue: task.nextDue ?? '',
			estTime: task.estTime ?? '',
			notes: task.notes ?? ''
		};
	}

	async function save() {
		if (!draft) return;
		const d = draft;
		const title = d.title.trim();
		if (!title) {
			error = 'Give the job a name.';
			return;
		}
		draft = null;
		const lastDone = d.lastDone || null;
		const body = {
			title,
			intervalMonths: d.intervalMonths,
			lastDone,
			// Blank: worked out from the last done day and the frequency.
			nextDue: d.nextDue || (lastDone ? nextDueAfter(lastDone, d.intervalMonths) : null),
			estTime: d.estTime,
			notes: d.notes
		};
		if (d.id) {
			const id = d.id;
			patchLocal(id, { ...body, estTime: body.estTime || null, notes: body.notes || null });
			await run(async () => {
				const res = await fetch(`/api/maintenance/${realId(id)}`, {
					method: 'PATCH',
					headers: JSON_HEADERS,
					body: JSON.stringify(body)
				});
				return res.ok;
			}, `Could not save "${title}".`);
		} else {
			const temp = `temp-${crypto.randomUUID()}`;
			tasks = [
				...tasks,
				{ id: temp, ...body, estTime: body.estTime || null, notes: body.notes || null }
			];
			await run(async () => {
				const res = await fetch('/api/maintenance', {
					method: 'POST',
					headers: JSON_HEADERS,
					body: JSON.stringify(body)
				});
				if (res.ok) realIds[temp] = ((await res.json()) as Task).id;
				else tasks = tasks.filter((t) => t.id !== temp);
				return res.ok;
			}, `Could not add "${title}".`);
		}
	}

	async function remove() {
		if (!draft?.id) return;
		const { id, title } = draft;
		draft = null;
		confirming = false;
		const before = tasks;
		tasks = tasks.filter((t) => t.id !== id);
		await run(async () => {
			const res = await fetch(`/api/maintenance/${realId(id)}`, {
				method: 'DELETE',
				headers: JSON_HEADERS,
				body: '{}'
			});
			if (!res.ok && res.status !== 404) tasks = before;
			return res.ok || res.status === 404;
		}, `Could not delete "${title}".`);
	}

	const CHIP: Record<MaintenanceStatus, string> = {
		overdue: 'bg-danger-soft text-danger',
		due: 'bg-star text-on-star',
		soon: 'bg-accent-soft text-accent',
		later: 'bg-surface-sunken text-ink-muted',
		unscheduled: 'bg-surface-sunken text-ink-muted'
	};
	const tap = $derived(wall ? 'min-h-tap-kid' : 'min-h-tap');
	const field =
		'min-h-tap min-w-0 rounded-control border-2 border-control-line bg-surface px-4 text-body text-ink';
</script>

<div class="flex min-h-0 flex-1 flex-col gap-4" data-testid="maint-panel">
	<div class="flex shrink-0 flex-wrap items-center justify-between gap-3">
		<h2 class="text-title font-extrabold text-ink">Home upkeep</h2>
		{#if !draft}
			<Button class={tap} data-testid="maint-add" onclick={startAdd}>+ Add job</Button>
		{/if}
	</div>

	{#if error}
		<p class="text-body text-danger" role="alert" data-testid="maint-error">{error}</p>
	{/if}

	{#if draft}
		{@const d = draft}
		<form
			class="flex shrink-0 flex-col gap-4"
			data-testid="maint-form"
			onsubmit={(e) => {
				e.preventDefault();
				void save();
			}}
		>
			<h3 class="text-lead font-extrabold text-ink">{d.id ? 'Edit job' : 'New job'}</h3>
			{#if wall && d.id}
				<p class="text-lead text-ink">{d.title}</p>
			{:else if !wall}
				<label class="flex flex-col gap-2 text-body text-ink-muted">
					Job
					<input
						class={field}
						bind:value={d.title}
						maxlength={MAINTENANCE_TITLE_MAX}
						data-testid="maint-title"
						placeholder="Change the furnace filter"
					/>
				</label>
			{/if}
			<div class="flex flex-col gap-2">
				<span class="text-body text-ink-muted">How often</span>
				<div class="flex flex-wrap gap-2" role="group" aria-label="How often">
					{#each MAINTENANCE_FREQUENCIES as f (f ?? 'needed')}
						<button
							type="button"
							aria-pressed={d.intervalMonths === f}
							data-testid="maint-freq"
							data-months={f ?? ''}
							class="{tap} rounded-chip px-5 text-body whitespace-nowrap {d.intervalMonths === f
								? 'bg-accent text-on-accent'
								: 'border-2 border-control-line bg-control text-ink'}"
							onclick={() => (d.intervalMonths = f)}>{frequencyLabel(f)}</button
						>
					{/each}
				</div>
			</div>
			<div class="flex flex-wrap gap-4">
				<label class="flex flex-col gap-2 text-body text-ink-muted">
					Last done
					<input type="date" class={field} bind:value={d.lastDone} data-testid="maint-last" />
				</label>
				<label class="flex flex-col gap-2 text-body text-ink-muted">
					Next due (blank: from last done)
					<input type="date" class={field} bind:value={d.nextDue} data-testid="maint-next" />
				</label>
			</div>
			{#if !wall}
				<div class="flex flex-wrap gap-4">
					<label class="flex flex-col gap-2 text-body text-ink-muted">
						Takes about
						<input
							class={field}
							bind:value={d.estTime}
							maxlength={MAINTENANCE_TIME_MAX}
							data-testid="maint-time"
							placeholder="30 minutes"
						/>
					</label>
					<label class="flex flex-1 flex-col gap-2 text-body text-ink-muted">
						Notes
						<input
							class={field}
							bind:value={d.notes}
							maxlength={MAINTENANCE_NOTES_MAX}
							data-testid="maint-notes"
							placeholder="20x25x1 filter, in the garage"
						/>
					</label>
				</div>
			{/if}
			{#if confirming}
				<div
					class="flex flex-wrap items-center gap-3 rounded-card border-2 border-danger p-4"
					role="alertdialog"
					aria-label="Confirm delete job"
				>
					<p class="min-w-0 flex-1 text-body text-ink">Delete "{d.title}"?</p>
					<Button variant="secondary" onclick={() => (confirming = false)}>Cancel</Button>
					<Button class="bg-danger" data-testid="maint-confirm-delete" onclick={remove}
						>Delete</Button
					>
				</div>
			{/if}
			<div class="flex flex-wrap gap-3">
				{#if !(wall && !d.id)}
					<Button type="submit" class={tap} data-testid="maint-save">Save</Button>
				{/if}
				<Button
					variant="secondary"
					class={tap}
					data-testid="maint-cancel"
					onclick={() => (draft = null)}>Cancel</Button
				>
				{#if adult && d.id && !confirming}
					<Button
						variant="secondary"
						class="{tap} ml-auto border-danger text-danger"
						data-testid="maint-delete"
						onclick={() => (confirming = true)}>Delete</Button
					>
				{/if}
			</div>
			{#if wall && !d.id}
				<!-- The wall has no OS keyboard: type the name last, and its Save key saves the job. -->
				<OnScreenKeyboard
					onsubmit={(text) => {
						d.title = text;
						void save();
					}}
					placeholder="Name the job…"
					submitLabel="Save"
					max={MAINTENANCE_TITLE_MAX}
				/>
			{/if}
		</form>
	{:else}
		<ul class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto" data-testid="maint-list">
			{#each sorted as task (task.id)}
				{@const status = today ? statusOf(task, today) : 'later'}
				<li
					class="flex flex-wrap items-center gap-3 rounded-card border-2 border-control-line bg-control p-3"
					data-testid="maint-task"
					data-status={status}
				>
					<button
						type="button"
						class="{tap} flex min-w-0 flex-1 flex-col items-start justify-center gap-1 px-2 text-left"
						data-testid="maint-edit"
						onclick={() => startEdit(task)}
					>
						<span class="text-lead break-words text-ink">{task.title}</span>
						<span class="text-caption text-ink-muted">
							{frequencyLabel(task.intervalMonths)}{task.estTime
								? ` · ${task.estTime}`
								: ''}{task.lastDone ? ` · Last done ${formatDay(task.lastDone)}` : ''}
						</span>
						{#if task.notes}<span class="text-caption break-words text-ink-muted">{task.notes}</span
							>{/if}
					</button>
					<span
						class="shrink-0 rounded-chip px-4 py-2 text-body font-extrabold whitespace-nowrap {CHIP[
							status
						]}"
						data-testid="maint-due">{today ? dueLabel(task, today) : ''}</span
					>
					{#if undo && realId(undo.id) === realId(task.id)}
						<Button variant="secondary" class={tap} data-testid="maint-undo" onclick={undoDone}
							>Undo</Button
						>
					{:else}
						<Button class={tap} data-testid="maint-done" onclick={() => markDone(task)}>Done</Button
						>
					{/if}
				</li>
			{:else}
				{#if loaded}
					<li class="p-8 text-center text-lead text-ink-muted">
						No jobs yet. Add one, like the furnace filter or the smoke alarms.
					</li>
				{/if}
			{/each}
		</ul>
	{/if}
</div>
