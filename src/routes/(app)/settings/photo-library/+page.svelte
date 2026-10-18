<script lang="ts">
	import { onMount } from 'svelte';
	import { errorMessage, safeFetch } from '#lib/domain/api-error.js';
	import Button from '#lib/components/ui/Button.svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import GooglePhotosImport from '#lib/components/GooglePhotosImport.svelte';
	import type { SourceView } from '#lib/server/photo-source/service.js';

	interface Thumb {
		id: string;
		album: string | null;
		hidden: boolean;
	}

	let sources = $state<SourceView[]>([]);
	let thumbs = $state<Record<string, Thumb[]>>({});
	let label = $state('Family photos');
	let root = $state('');
	let error = $state<string>();
	let busy = $state<string>();

	async function call(url: string, method = 'GET', body?: unknown) {
		const res = await safeFetch(url, {
			method,
			headers: { 'content-type': 'application/json' },
			body: body === undefined ? undefined : JSON.stringify(body)
		});
		if (!res.ok) {
			error = await errorMessage(res);
			return null;
		}
		error = undefined;
		return res.json();
	}

	async function loadThumbs(id: string, offset = 0) {
		const rows: Thumb[] | null = await call(
			`/api/photo-sources/${id}/images?limit=24&offset=${offset}`
		);
		if (rows) thumbs[id] = offset ? [...(thumbs[id] ?? []), ...rows] : rows;
	}

	/** Bumped by every refresh and every optimistic change, so a slower, older answer never wins. */
	let generation = 0;

	async function refresh() {
		const mine = ++generation;
		const list: SourceView[] | null = await call('/api/photo-sources');
		if (!list || mine !== generation) return;
		sources = list;
		await Promise.all(list.map((s) => loadThumbs(s.id)));
	}
	onMount(refresh);

	async function add() {
		busy = 'add';
		const view: SourceView | null = await call('/api/photo-sources', 'POST', {
			kind: 'folder',
			label,
			root
		});
		busy = undefined;
		if (view) {
			root = '';
			// The answer already holds the scanned albums and counts: show the card now, and let an
			// older refresh still in flight drop its list instead of hiding the new folder.
			generation++;
			sources = [...sources.filter((s) => s.id !== view.id), view];
			await refresh();
		}
	}

	async function scan(s: SourceView) {
		busy = s.id;
		await call(`/api/photo-sources/${s.id}/scan`, 'POST');
		busy = undefined;
		await refresh();
	}

	async function remove(s: SourceView) {
		if (await call(`/api/photo-sources/${s.id}`, 'DELETE')) await refresh();
	}

	/** Optimistic: the box flips first, then the selection is saved (all checked is stored as "all"). */
	async function toggle(s: SourceView, name: string) {
		const next = s.albums.map((a) => ({
			...a,
			selected: a.name === name ? !a.selected : a.selected
		}));
		if (!next.some((a) => a.selected)) return;
		generation++;
		s.albums = next;
		const all = next.every((a) => a.selected);
		await call(`/api/photo-sources/${s.id}`, 'PATCH', {
			albums: all ? [] : next.filter((a) => a.selected).map((a) => a.name)
		});
	}

	async function setHidden(sourceId: string, t: Thumb, hidden: boolean) {
		t.hidden = hidden;
		if (!(await call(`/api/photo/${t.id}/hide`, 'POST', { hidden }))) t.hidden = !hidden;
	}

	const when = (at: number) => new Date(at).toLocaleString();

	// Yearly windows: an album shows only between two days each year (e.g. around an anniversary).
	type Album = SourceView['albums'][number];
	const MONTHS = Array.from({ length: 12 }, (_, i) =>
		new Date(2000, i, 1).toLocaleString(undefined, { month: 'short' })
	);
	const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
	const pad = (n: number) => String(n).padStart(2, '0');
	const monthDay = (m: number, d: number) => `${pad(m)}-${pad(d)}`;
	const split = (md: string) => [Number(md.slice(0, 2)), Number(md.slice(3))] as const;
	const dayLabel = (md: string) => `${MONTHS[split(md)[0] - 1]} ${split(md)[1]}`;
	const field = 'min-h-tap rounded-control border-2 border-line bg-surface px-3 text-body';

	let editing = $state<string>();
	let draft = $state({ fromM: 1, fromD: 1, toM: 1, toD: 1 });
	const key = (s: SourceView, a: Album) => `${s.id}:${a.name}`;

	function edit(s: SourceView, a: Album) {
		const [fromM, fromD] = split(a.window?.from ?? '01-01');
		const [toM, toD] = split(a.window?.to ?? '01-01');
		draft = { fromM, fromD, toM, toD };
		editing = key(s, a);
	}

	/** Optimistic: the album shows its new dates first, then the change is saved. */
	async function setWindow(s: SourceView, a: Album, w: { from: string; to: string } | null) {
		const before = a.window;
		generation++;
		a.window = w && { ...w, open: false };
		editing = undefined;
		const view: SourceView | null = await call(`/api/photo-sources/${s.id}`, 'PATCH', {
			windows: { [a.name]: w }
		});
		if (view) sources = sources.map((x) => (x.id === view.id ? view : x));
		else a.window = before;
	}
</script>

<svelte:head><title>Photo library</title></svelte:head>

<section class="mx-auto flex max-w-4xl flex-col gap-6 p-6 max-sm:p-3">
	<h1 class="text-headline font-extrabold">Photo library</h1>

	{#if error}<p role="alert" class="text-body font-bold text-danger">{error}</p>{/if}

	<Card elevation="float">
		<form
			class="flex flex-col gap-4"
			data-testid="add-folder"
			onsubmit={(e) => {
				e.preventDefault();
				void add();
			}}
		>
			<h2 class="text-title font-extrabold">Add a folder</h2>
			<label class="flex flex-col gap-2 text-body font-bold">
				Name
				<input
					bind:value={label}
					class="min-h-tap rounded-control border-2 border-line bg-surface px-4 text-body"
				/>
			</label>
			<label class="flex flex-col gap-2 text-body font-bold">
				Folder path
				<input
					bind:value={root}
					type="text"
					inputmode="url"
					autocomplete="off"
					autocapitalize="off"
					autocorrect="off"
					spellcheck="false"
					placeholder="/media/photos-in"
					class="min-h-tap rounded-control border-2 border-line bg-surface px-4 text-body"
				/>
			</label>
			<p class="text-caption text-ink-muted">
				The path inside the hub's container, for example the folder you bind-mounted read-only (<code
					class="break-all">/mnt/user/Photos:/media/photos-in:ro</code
				>). It must be under HUB_PHOTO_ROOTS.
			</p>
			<Button type="submit" disabled={busy === 'add' || !root}>
				{busy === 'add' ? 'Scanning…' : 'Add folder'}
			</Button>
		</form>
	</Card>

	<GooglePhotosImport folders={sources} onimported={refresh} />

	{#each sources as s (s.id)}
		<Card>
			<div class="flex flex-col gap-4" data-testid="source-{s.label}">
				<div>
					<h2 class="text-title font-extrabold">{s.label}</h2>
					<p class="text-caption break-all text-ink-muted">{s.root}</p>
					<p class="text-caption text-ink-muted" data-testid="scan-status">
						{s.photoCount} photos{s.lastScan ? ` · scanned ${when(s.lastScan.at)}` : ''}
					</p>
				</div>
				<div class="flex flex-wrap gap-3">
					<Button disabled={busy === s.id} onclick={() => scan(s)}>
						{busy === s.id ? 'Scanning…' : 'Scan now'}
					</Button>
					<Button variant="ghost" onclick={() => remove(s)}>Remove</Button>
				</div>
				<ul class="flex flex-col gap-2" aria-label="Albums">
					{#each s.albums as a (a.name)}
						<li>
							<label class="flex min-h-tap items-center gap-4 text-body">
								<input
									type="checkbox"
									class="size-tap"
									checked={a.selected}
									onchange={() => toggle(s, a.name)}
								/>
								<span class="flex-1">{a.name}</span>
								<span class="text-ink-muted">{a.count}</span>
							</label>
							{#if editing === key(s, a)}
								<form
									class="flex flex-wrap items-end gap-3 pb-2"
									aria-label="Dates for {a.name}"
									onsubmit={(e) => {
										e.preventDefault();
										void setWindow(s, a, {
											from: monthDay(draft.fromM, draft.fromD),
											to: monthDay(draft.toM, draft.toD)
										});
									}}
								>
									{#each [['From', 'fromM', 'fromD'], ['To', 'toM', 'toD']] as const as [name, m, d] (name)}
										<fieldset class="flex gap-2">
											<legend class="text-caption text-ink-muted">{name}</legend>
											<select
												class={field}
												aria-label="{name} month"
												bind:value={draft[m]}
												onchange={() =>
													(draft[d] = Math.min(draft[d], DAYS_IN_MONTH[draft[m] - 1]!))}
											>
												{#each MONTHS as label, i (label)}<option value={i + 1}>{label}</option
													>{/each}
											</select>
											<select class={field} aria-label="{name} day" bind:value={draft[d]}>
												{#each { length: DAYS_IN_MONTH[draft[m] - 1]! }, i (i)}
													<option value={i + 1}>{i + 1}</option>
												{/each}
											</select>
										</fieldset>
									{/each}
									<Button type="submit">Save dates</Button>
									<Button variant="ghost" onclick={() => (editing = undefined)}>Cancel</Button>
								</form>
							{:else}
								<div class="flex flex-wrap items-center gap-3 pb-2">
									{#if a.window}
										<span class="text-caption text-ink-muted" data-testid="album-window">
											Only {dayLabel(a.window.from)} – {dayLabel(a.window.to)} each year{a.window
												.open
												? ' · showing now'
												: ''}
										</span>
										<Button variant="ghost" onclick={() => edit(s, a)}>Change dates</Button>
										<Button variant="ghost" onclick={() => setWindow(s, a, null)}
											>Clear dates</Button
										>
									{:else}
										<Button variant="ghost" onclick={() => edit(s, a)}>Show only between…</Button>
									{/if}
								</div>
							{/if}
						</li>
					{/each}
				</ul>
				<ul class="grid grid-cols-2 gap-3 lg:grid-cols-3" aria-label="Photos">
					{#each thumbs[s.id] ?? [] as t (t.id)}
						<li class="flex flex-col gap-2" class:opacity-50={t.hidden}>
							<img
								src="/api/photo/{t.id}?w=480&h=270&fmt=webp"
								alt={t.album ?? 'Photo'}
								loading="lazy"
								class="aspect-video w-full rounded-control bg-surface-sunken object-cover"
							/>
							<Button
								variant="secondary"
								aria-label="{t.hidden ? 'Show' : 'Hide'} photo"
								onclick={() => setHidden(s.id, t, !t.hidden)}>{t.hidden ? 'Show' : 'Hide'}</Button
							>
						</li>
					{/each}
				</ul>
				{#if (thumbs[s.id]?.length ?? 0) < s.photoCount}
					<Button variant="secondary" onclick={() => loadThumbs(s.id, thumbs[s.id]?.length ?? 0)}>
						More photos
					</Button>
				{/if}
			</div>
		</Card>
	{/each}
</section>
