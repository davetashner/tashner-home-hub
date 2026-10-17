<script lang="ts">
	import { onMount } from 'svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import RoutineIcon from '#lib/components/kid/RoutineIcon.svelte';
	import { MAX_STEPS, ROUTINE_ICONS, type RoutineStep } from '#lib/domain/routines.js';

	interface Member {
		id: string;
		name: string;
		role: string;
	}
	interface Routine {
		id: string;
		memberId: string;
		name: string;
		windowStart: string | null;
		windowEnd: string | null;
		steps: RoutineStep[];
	}

	let members = $state<Member[]>([]);
	let routines = $state<Routine[]>([]);
	let loaded = $state(false);
	let message = $state('');
	/** null = form closed, '' = creating, otherwise the id being edited. */
	let editing = $state<string | null>(null);
	let confirming = $state<string | null>(null);
	let pickingFor = $state<number | null>(null);
	let memberId = $state('');
	let name = $state('');
	let windowStart = $state('');
	let windowEnd = $state('');
	let steps = $state<RoutineStep[]>([]);

	const json = { 'content-type': 'application/json' };

	async function load() {
		const [m, r] = await Promise.all([fetch('/api/members'), fetch('/api/routines')]);
		members = m.ok ? await m.json() : [];
		routines = r.ok ? await r.json() : [];
		loaded = true;
	}
	onMount(load);

	const grouped = $derived(
		members
			.map((m) => ({ member: m, items: routines.filter((r) => r.memberId === m.id) }))
			.filter((g) => g.items.length > 0)
	);

	function openForm(r?: Routine) {
		editing = r?.id ?? '';
		confirming = pickingFor = null;
		message = '';
		memberId = r?.memberId ?? members.find((m) => m.role === 'child')?.id ?? members[0]?.id ?? '';
		name = r?.name ?? '';
		windowStart = r?.windowStart ?? '';
		windowEnd = r?.windowEnd ?? '';
		steps = r ? r.steps.map((s) => ({ ...s })) : [{ label: '', icon: 'toothbrush' }];
	}

	function move(i: number, by: -1 | 1) {
		const j = i + by;
		if (j < 0 || j >= steps.length) return;
		const next = [...steps];
		[next[i], next[j]] = [next[j], next[i]];
		steps = next;
		pickingFor = null;
	}

	/** Runs a request after the UI has already changed; on failure restores `before` and says why. */
	async function sync(req: Promise<Response>, before: Routine[]) {
		const res = await req.catch(() => null);
		if (res?.ok) return res;
		routines = before;
		message = (await res?.json().catch(() => null))?.message ?? 'Could not save, so it was undone';
		return null;
	}

	async function save(e: SubmitEvent) {
		e.preventDefault();
		const body = {
			memberId,
			name: name.trim(),
			windowStart: windowStart || null,
			windowEnd: windowEnd || null,
			steps: steps.map((s) => ({ label: s.label.trim(), icon: s.icon }))
		};
		const before = routines;
		const id = editing;
		editing = null;
		if (id) {
			routines = routines.map((r) => (r.id === id ? { ...r, ...body } : r));
			await sync(
				fetch(`/api/routines/${id}`, {
					method: 'PATCH',
					headers: json,
					body: JSON.stringify(body)
				}),
				before
			);
			return;
		}
		const temp = `temp-${Date.now()}`;
		routines = [...routines, { id: temp, ...body }];
		const res = await sync(
			fetch('/api/routines', { method: 'POST', headers: json, body: JSON.stringify(body) }),
			before
		);
		if (res) {
			const created = (await res.json()) as Routine;
			routines = routines.map((r) => (r.id === temp ? created : r));
		}
	}

	async function remove(r: Routine) {
		const before = routines;
		confirming = null;
		routines = routines.filter((x) => x.id !== r.id);
		await sync(
			fetch(`/api/routines/${r.id}`, { method: 'DELETE', headers: json, body: '{}' }),
			before
		);
	}

	const field =
		'min-h-tap w-full rounded-control border-2 border-line bg-surface px-6 text-body text-ink max-sm:px-3';
	const iconLabel = (key: string) => ROUTINE_ICONS.find((i) => i.key === key)?.label ?? key;
</script>

<svelte:head><title>Routines</title></svelte:head>

<section class="mx-auto flex w-full max-w-5xl flex-col gap-8 p-8 max-sm:p-3">
	<header class="flex flex-wrap items-center justify-between gap-6">
		<h1 class="text-headline font-extrabold">Routines</h1>
		<Button data-testid="add-routine" onclick={() => openForm()}>Add routine</Button>
	</header>

	{#if editing !== null}
		<Card elevation="float">
			<form class="flex flex-col gap-6" onsubmit={save} data-testid="routine-form">
				<div class="flex flex-wrap gap-6">
					<label class="flex flex-col gap-2 max-sm:w-full">
						<span class="text-caption text-ink-muted">Who</span>
						<select
							class="{field} w-64 max-sm:w-full"
							bind:value={memberId}
							data-testid="routine-member"
						>
							{#each members as m (m.id)}<option value={m.id}>{m.name}</option>{/each}
						</select>
					</label>
					<label class="flex min-w-64 flex-1 flex-col gap-2 max-sm:min-w-0 max-sm:basis-full">
						<span class="text-caption text-ink-muted">Name</span>
						<input
							class={field}
							bind:value={name}
							maxlength="40"
							required
							placeholder="Morning"
							data-testid="routine-name"
						/>
					</label>
					<label class="flex flex-col gap-2">
						<span class="text-caption text-ink-muted">From (optional)</span>
						<input class="{field} w-48" type="time" bind:value={windowStart} />
					</label>
					<label class="flex flex-col gap-2">
						<span class="text-caption text-ink-muted">Until</span>
						<input class="{field} w-48" type="time" bind:value={windowEnd} />
					</label>
				</div>

				<ol class="flex flex-col gap-4">
					{#each steps as step, i (i)}
						<li class="flex flex-col gap-3" data-testid="routine-step-row">
							<div class="flex items-center gap-3">
								<Button
									variant="secondary"
									class="size-16 shrink-0 !p-2 text-accent"
									aria-label="Picture for step {i + 1}: {iconLabel(step.icon)}"
									aria-expanded={pickingFor === i}
									onclick={() => (pickingFor = pickingFor === i ? null : i)}
								>
									<RoutineIcon name={step.icon} />
								</Button>
								<input
									class="{field} min-w-0 flex-1"
									bind:value={step.label}
									maxlength="40"
									required
									aria-label="Step {i + 1} name"
									placeholder="Brush teeth"
								/>
								<Button
									variant="secondary"
									class="shrink-0 !px-3"
									disabled={i === 0}
									onclick={() => move(i, -1)}
									aria-label="Move step {i + 1} up">Up</Button
								>
								<Button
									variant="secondary"
									class="shrink-0 !px-3"
									disabled={i === steps.length - 1}
									onclick={() => move(i, 1)}
									aria-label="Move step {i + 1} down">Down</Button
								>
								<Button
									variant="ghost"
									class="shrink-0 !px-3"
									disabled={steps.length === 1}
									onclick={() => {
										steps = steps.filter((_, j) => j !== i);
										pickingFor = null;
									}}
									aria-label="Remove step {i + 1}">Remove</Button
								>
							</div>
							{#if pickingFor === i}
								<div
									class="flex flex-wrap gap-2"
									role="radiogroup"
									aria-label="Pictures for step {i + 1}"
									data-testid="icon-picker"
								>
									{#each ROUTINE_ICONS as icon (icon.key)}
										<button
											type="button"
											role="radio"
											aria-checked={step.icon === icon.key}
											aria-label={icon.label}
											class="size-16 rounded-control border-2 p-3 {step.icon === icon.key
												? 'border-accent bg-accent text-on-accent'
												: 'border-line bg-surface text-ink'}"
											onclick={() => {
												step.icon = icon.key;
												pickingFor = null;
											}}
										>
											<RoutineIcon name={icon.key} />
										</button>
									{/each}
								</div>
							{/if}
						</li>
					{/each}
				</ol>
				<div>
					<Button
						variant="secondary"
						disabled={steps.length >= MAX_STEPS}
						onclick={() => (steps = [...steps, { label: '', icon: 'star' }])}
						data-testid="add-step">Add step</Button
					>
				</div>
				<div class="flex gap-4">
					<Button type="submit" data-testid="routine-save">Save</Button>
					<Button variant="secondary" onclick={() => (editing = null)}>Cancel</Button>
				</div>
			</form>
		</Card>
	{/if}

	{#if message}<p class="text-danger" role="alert">{message}</p>{/if}

	{#if loaded && routines.length === 0}
		<p class="text-lead text-ink-muted">No routines yet. Add the first one.</p>
	{/if}

	{#each grouped as group (group.member.id)}
		<div class="flex flex-col gap-4">
			<h2 class="text-title font-bold">{group.member.name}</h2>
			<ul class="flex flex-col gap-4">
				{#each group.items as r (r.id)}
					<li data-testid="routine-row">
						<Card class="flex flex-wrap items-center gap-6 !p-6 max-sm:!gap-3 max-sm:!p-4">
							<span class="min-w-48 flex-1 max-sm:min-w-0 max-sm:basis-full">
								<span class="block text-lead font-bold">{r.name}</span>
								<span class="block text-body text-ink-muted">
									{r.steps.map((s) => s.label).join(' → ')}
									{#if r.windowStart && r.windowEnd}· {r.windowStart}–{r.windowEnd}{/if}
								</span>
							</span>
							{#if confirming === r.id}
								<span class="text-body font-bold">Delete {r.name}?</span>
								<Button variant="danger" onclick={() => remove(r)} data-testid="routine-delete-yes"
									>Yes, delete</Button
								>
								<Button variant="secondary" onclick={() => (confirming = null)}>Keep</Button>
							{:else}
								<Button
									variant="secondary"
									onclick={() => openForm(r)}
									aria-label="Edit {r.name}"
									disabled={r.id.startsWith('temp-')}>Edit</Button
								>
								<Button
									variant="ghost"
									onclick={() => (confirming = r.id)}
									aria-label="Delete {r.name}"
									disabled={r.id.startsWith('temp-')}>Delete</Button
								>
							{/if}
						</Card>
					</li>
				{/each}
			</ul>
		</div>
	{/each}
</section>
