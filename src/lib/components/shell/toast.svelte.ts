/** One brief, non-blocking message (e.g. "Locked"). Rendered by AppShell. */
export const toast = $state<{ message: string | null }>({ message: null });

let timer: ReturnType<typeof setTimeout> | undefined;

export function showToast(message: string, ms = 2500): void {
	toast.message = message;
	clearTimeout(timer);
	timer = setTimeout(() => (toast.message = null), ms);
}
