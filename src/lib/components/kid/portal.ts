/** Svelte action: re-parent a node to <body>, out from under transformed ancestors that clip `fixed`. */
export function toBody(node: HTMLElement) {
	document.body.append(node);
	return { destroy: () => node.remove() };
}
