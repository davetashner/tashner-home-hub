<script lang="ts">
	import type { MemberColor } from '#lib/domain/member-colors.js';

	type Size = 'sm' | 'md' | 'lg' | 'kid';

	interface Props {
		name: string;
		color: MemberColor;
		avatar?: string | null;
		size?: Size;
	}

	let { name, color, avatar = null, size = 'md' }: Props = $props();

	// Full class names so Tailwind can see them.
	const colors: Record<MemberColor, string> = {
		'member-1': 'bg-member-1',
		'member-2': 'bg-member-2',
		'member-3': 'bg-member-3',
		'member-4': 'bg-member-4',
		'member-5': 'bg-member-5',
		'member-6': 'bg-member-6'
	};
	const sizes: Record<Size, string> = {
		sm: 'size-12 text-body',
		md: 'size-tap text-lead',
		lg: 'size-28 text-title tablet:size-16 tablet:text-lead',
		kid: 'size-tap-kid text-title'
	};
	const initial = $derived([...name.trim()][0]?.toUpperCase() ?? '?');
</script>

<span
	role="img"
	aria-label={name.trim() || 'New member'}
	class="inline-flex shrink-0 items-center justify-center rounded-chip font-extrabold text-on-accent {colors[
		color
	]} {sizes[size]}"
>
	<span aria-hidden="true">{avatar ?? initial}</span>
</span>
