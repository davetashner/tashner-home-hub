<script lang="ts">
	import { resolve } from '$app/paths';
	import Button from '#lib/components/ui/Button.svelte';
	import Card from '#lib/components/ui/Card.svelte';

	interface Pending {
		doc: unknown;
		exportedAt: string;
		counts: [string, number][];
	}

	let pending = $state<Pending | null>(null);
	let message = $state('');
	let busy = $state(false);
	let done = $state<string[] | null>(null);

	async function pick(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		pending = null;
		message = '';
		if (!file) return;
		try {
			const doc = JSON.parse(await file.text()) as {
				exportedAt?: string;
				tables?: Record<string, unknown[]>;
			};
			if (!doc.tables || typeof doc.tables !== 'object') throw new Error('no tables');
			const counts = Object.entries(doc.tables).map(
				([t, rows]) => [t, Array.isArray(rows) ? rows.length : 0] as [string, number]
			);
			pending = { doc, exportedAt: String(doc.exportedAt ?? ''), counts };
		} catch {
			message = 'That file is not a Home Hub export.';
		}
		input.value = '';
	}

	async function replaceAll() {
		if (!pending) return;
		busy = true;
		message = '';
		try {
			const res = await fetch('/api/admin/import', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(pending.doc)
			});
			const body = (await res.json()) as {
				error?: string;
				reconnect?: { label: string }[];
			};
			if (!res.ok) {
				message = body.error ?? 'Import failed.';
				return;
			}
			done = (body.reconnect ?? []).map((r) => r.label);
			pending = null;
		} catch {
			message = 'Could not reach the hub. Nothing was changed.';
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head>
	<title>Backup · Settings · Home Hub</title>
</svelte:head>

<section class="mx-auto flex w-full max-w-4xl flex-col gap-8 p-8 max-sm:p-3">
	<h1 class="text-headline font-extrabold">Backup</h1>
	<Card>
		<div class="flex flex-col gap-4">
			<h2 class="text-title font-bold">Export data</h2>
			<p class="text-body text-ink-muted">
				Downloads family, Star Jobs, stars, rewards, lists, meals and settings as one file. Calendar
				and photo logins are not included, so reconnect those after restoring. Photo files stay on
				the server; only their details are saved.
			</p>
			<div>
				<a
					href={resolve('/api/admin/export')}
					download
					data-testid="export-link"
					class="inline-flex min-h-tap items-center rounded-card bg-accent px-8 text-body font-bold text-on-accent shadow-raised"
					>Export data</a
				>
			</div>
		</div>
	</Card>
	<Card>
		<div class="flex flex-col gap-4">
			<h2 class="text-title font-bold">Import data</h2>
			<p class="text-body text-ink-muted">
				Replaces everything on this hub with the contents of an export file. A backup is taken
				first.
			</p>
			<input
				type="file"
				accept="application/json,.json"
				aria-label="Choose export file"
				data-testid="import-file"
				class="min-h-tap text-body"
				onchange={pick}
			/>
			{#if pending}
				<div class="flex flex-col gap-4" data-testid="import-summary">
					<p class="text-body">
						Exported {pending.exportedAt}. This will replace:
					</p>
					<ul class="text-body text-ink-muted">
						{#each pending.counts as [table, n] (table)}
							<li>{table}: {n}</li>
						{/each}
					</ul>
					<div class="flex flex-wrap gap-4">
						<Button variant="danger" disabled={busy} onclick={replaceAll}>Replace all data</Button>
						<Button variant="secondary" onclick={() => (pending = null)}>Cancel</Button>
					</div>
				</div>
			{/if}
			{#if done}
				<div role="status" class="flex flex-col gap-2 text-body" data-testid="import-done">
					<p>Done. All data replaced.</p>
					{#if done.length}<p class="text-ink-muted">Reconnect: {done.join(', ')}</p>{/if}
					<div>
						<Button onclick={() => location.reload()}>Reload</Button>
					</div>
				</div>
			{/if}
			{#if message}<p role="alert" class="text-body text-danger">{message}</p>{/if}
		</div>
	</Card>
</section>
