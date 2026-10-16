// Files that define the quality bar. Agents must not change them without a human
// (ADR 0002 "Guardrails specific to overnight agents"). Protected path itself.
export const PROTECTED = [
	/^\.github\//,
	/^scripts\/ci\//,
	/^budgets\.json$/,
	/^tests\/visual\/baselines\//,
	/^eslint\.config\.js$/,
	/^\.?stylelint/,
	/^prettier\.config\.js$/,
	/^\.prettierignore$/,
	/^vite\.config\.ts$/,
	/^playwright\.config\.ts$/,
	/^tsconfig\.json$/,
	/^lighthouserc/,
	/^\.size-limit/,
	/^docs\/decisions\//
];
