<script lang="ts">
	import { onDestroy } from 'svelte';
	import { resolve } from '$app/paths';
	import Button from '#lib/components/ui/Button.svelte';
	import Card from '#lib/components/ui/Card.svelte';

	type Status = 'waiting' | 'sending' | 'sent' | 'failed';
	interface Item {
		key: number;
		file: File;
		url: string;
		status: Status;
		message?: string;
	}

	let items = $state<Item[]>([]);
	let input: HTMLInputElement;
	let nextKey = 0;
	let running = false;

	const sent = $derived(items.filter((i) => i.status === 'sent').length);
	const failed = $derived(items.filter((i) => i.status === 'failed').length);
	const busy = $derived(items.some((i) => i.status === 'waiting' || i.status === 'sending'));

	function picked(files: FileList | null) {
		// Optimistic: thumbnails appear at once; the uploads follow one at a time.
		for (const file of files ?? [])
			items.push({ key: nextKey++, file, url: URL.createObjectURL(file), status: 'waiting' });
		input.value = '';
		void pump();
	}

	async function send(item: Item): Promise<void> {
		item.status = 'sending';
		const res = await fetch('/api/photo-upload', {
			method: 'POST',
			headers: { 'content-type': item.file.type || 'image/jpeg' },
			body: item.file
		}).catch(() => null);
		if (res?.ok) {
			item.status = 'sent';
			return;
		}
		const body = res ? await res.json().catch(() => null) : null;
		item.status = 'failed';
		item.message =
			res?.status === 401
				? 'Unlock again to keep sending.'
				: ((body as { message?: string } | null)?.message ??
					'Could not reach the hub. Are you on the home Wi-Fi?');
	}

	async function pump() {
		if (running) return;
		running = true;
		for (let next = items.find((i) => i.status === 'waiting'); next;) {
			await send(next);
			next = items.find((i) => i.status === 'waiting');
		}
		running = false;
	}

	function retry() {
		for (const i of items) if (i.status === 'failed') i.status = 'waiting';
		void pump();
	}

	onDestroy(() => items.forEach((i) => URL.revokeObjectURL(i.url)));

	const label = (s: Status) =>
		({ waiting: 'Waiting', sending: 'Sending…', sent: 'Sent', failed: 'Not sent' })[s];
</script>

<svelte:head>
	<title>Send photos · Settings · Home Hub</title>
</svelte:head>

<section class="mx-auto flex w-full max-w-4xl flex-col gap-8 p-8 max-sm:p-3 short:gap-4 short:p-3">
	<h1 class="text-headline font-extrabold">Send photos</h1>
	<p class="text-body text-ink-muted">
		Pick photos on this phone and they join the photo frame in the
		<a class="font-bold text-accent underline" href={resolve('/(app)/settings/photo-library')}
			>From phones</a
		>
		album. Location and other hidden details are removed. Works on the home Wi-Fi.
	</p>
	<div class="flex flex-wrap items-center gap-4">
		<label
			class="press inline-flex min-h-tap min-w-tap cursor-pointer items-center justify-center gap-3 rounded-control bg-accent px-8 text-body font-extrabold text-on-accent shadow-raised focus-within:outline-4 focus-within:outline-accent-soft"
		>
			<span aria-hidden="true">📷</span>Choose photos
			<input
				bind:this={input}
				type="file"
				accept="image/*"
				multiple
				class="sr-only"
				data-testid="send-photos-input"
				onchange={(e) => picked(e.currentTarget.files)}
			/>
		</label>
		{#if failed && !busy}
			<Button variant="secondary" onclick={retry}>Try again</Button>
		{/if}
	</div>
	{#if items.length}
		<p class="text-body" role="status" data-testid="send-photos-summary">
			{sent} of {items.length} sent{failed ? `, ${failed} not sent` : ''}.
		</p>
		<Card>
			<ul class="grid grid-cols-3 gap-4 max-sm:grid-cols-2">
				{#each items as item (item.key)}
					<li class="flex flex-col gap-2" data-testid="send-photo" data-status={item.status}>
						<img
							src={item.url}
							alt=""
							class="aspect-square w-full rounded-control object-cover transition-opacity {item.status ===
							'sent'
								? 'opacity-100'
								: 'opacity-60'}"
						/>
						<span
							class="text-caption font-bold {item.status === 'failed'
								? 'text-danger'
								: item.status === 'sent'
									? 'text-success'
									: 'text-ink-muted'}">{label(item.status)}</span
						>
						{#if item.message}<span class="text-caption text-danger">{item.message}</span>{/if}
					</li>
				{/each}
			</ul>
		</Card>
	{/if}
</section>
