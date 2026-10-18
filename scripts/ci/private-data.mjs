// ADR 0002 Tier 1 "Private data" gate. The repo is public: no private family data.
// Protected path: changes need a human.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fail, pass, trackedFiles } from './lib.mjs';

const ALLOWED_EMAIL_DOMAINS = [
	/(^|\.)example\.(com|org|net)$/i,
	/\.(test|invalid|localhost)$/i,
	/^users\.noreply\.github\.com$/i,
	/^anthropic\.com$/i
];
// The maintainer's identity already appears in every commit sign-off.
const ALLOWED_EMAILS = new Set(['dave@mainstreetlogic.com', 'noreply@anthropic.com']);
const FORBIDDEN_PATHS = [/^data\//, /(^|\/)photos\//, /(^|\/)\.env(?!\.example$)(\..*)?$/];
const IMAGE = /\.(jpe?g|png|heic|heif|tiff?|webp|avif)$/i;
const SKIP = [/^pnpm-lock\.yaml$/, /\.(woff2?|ttf|otf|ico)$/i];
const EMAIL = /[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
// North American numbers; 555-0100..0199 are reserved for fiction and allowed.
const PHONE = /\(?\b\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b/g;
// Public US hotlines shown on the sitter emergency sheet (not anyone's private number).
const PUBLIC_HOTLINES = new Set([
	'8002221222' // Poison Control
]);

const problems = [];
const files = trackedFiles();
const images = [];

for (const file of files) {
	if (FORBIDDEN_PATHS.some((re) => re.test(file))) problems.push(`${file}: forbidden path`);
	if (IMAGE.test(file)) images.push(file);
	if (SKIP.some((re) => re.test(file)) || IMAGE.test(file)) continue;
	let text;
	try {
		text = readFileSync(file, 'utf8');
	} catch {
		continue;
	}
	if (text.includes('\0')) continue;
	for (const [address, domain] of text.matchAll(EMAIL)) {
		if (ALLOWED_EMAILS.has(address.toLowerCase())) continue;
		if (ALLOWED_EMAIL_DOMAINS.some((re) => re.test(domain))) continue;
		problems.push(`${file}: real-looking email "${address}" (use example.com)`);
	}
	for (const [phone] of text.matchAll(PHONE)) {
		const digits = phone.replace(/\D/g, '');
		if (/^\d{3}55501\d\d$/.test(digits)) continue;
		if (PUBLIC_HOTLINES.has(digits)) continue;
		problems.push(`${file}: real-looking phone number "${phone}" (use 555-01xx)`);
	}
}

if (images.length > 0) {
	let output = '';
	try {
		output = execFileSync(
			'exiftool',
			[
				'-json',
				'-GPSLatitude',
				'-GPSLongitude',
				'-OwnerName',
				'-Artist',
				'-SerialNumber',
				...images
			],
			{ encoding: 'utf8' }
		);
	} catch (error) {
		if (error.code === 'ENOENT') {
			if (process.env.CI) problems.push('exiftool is not installed; cannot check image metadata');
			else console.warn('! exiftool not installed; skipping image metadata check locally');
		} else {
			output = error.stdout ?? '';
		}
	}
	for (const entry of output ? JSON.parse(output) : []) {
		const found = ['GPSLatitude', 'GPSLongitude', 'OwnerName', 'Artist', 'SerialNumber'].filter(
			(key) => entry[key] !== undefined
		);
		if (found.length) problems.push(`${entry.SourceFile}: image metadata ${found.join(', ')}`);
	}
}

if (problems.length) fail('private-data', problems);
pass('private-data', `${files.length} files, ${images.length} images scanned`);
