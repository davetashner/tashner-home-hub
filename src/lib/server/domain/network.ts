import { isIP } from 'node:net';

/**
 * Source-address classification for the LAN-only default (NFR-3).
 * Private = loopback, RFC1918, link-local, IPv6 ULA/link-local/loopback.
 * IPv4-mapped IPv6 (::ffff:a.b.c.d) is classified by its embedded IPv4 address.
 */

function isPrivateV4(octets: number[]): boolean {
	const [a, b] = octets as [number, number, number, number];
	return (
		a === 127 || // loopback
		a === 10 || // RFC1918
		(a === 172 && b >= 16 && b <= 31) || // RFC1918
		(a === 192 && b === 168) || // RFC1918
		(a === 169 && b === 254) // link-local
	);
}

function parseV4(s: string): number[] {
	return s.split('.').map(Number);
}

/** Expand an IPv6 literal to 8 16-bit groups. Input must already pass isIP === 6. */
function parseV6(s: string): number[] {
	let addr = s;
	// Trailing dotted quad -> two hex groups.
	const lastColon = addr.lastIndexOf(':');
	const tail = addr.slice(lastColon + 1);
	if (tail.includes('.')) {
		const [a, b, c, d] = parseV4(tail) as [number, number, number, number];
		addr = `${addr.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
	}
	const [head = '', rest] = addr.split('::');
	const headGroups = head ? head.split(':') : [];
	const restGroups = rest === undefined ? [] : rest ? rest.split(':') : [];
	const fill = rest === undefined ? 0 : 8 - headGroups.length - restGroups.length;
	return [...headGroups, ...Array<string>(fill).fill('0'), ...restGroups].map((g) =>
		parseInt(g, 16)
	);
}

export function isPrivateAddress(raw: string | undefined | null): boolean {
	if (!raw) return false;
	let ip = raw.trim();
	const zone = ip.indexOf('%');
	if (zone !== -1) ip = ip.slice(0, zone);
	if (ip.startsWith('[') && ip.endsWith(']')) ip = ip.slice(1, -1);

	const version = isIP(ip);
	if (version === 4) return isPrivateV4(parseV4(ip));
	if (version !== 6) return false;

	const g = parseV6(ip) as [number, number, number, number, number, number, number, number];
	const allZeroTo = (n: number) => g.slice(0, n).every((x) => x === 0);
	if (allZeroTo(7) && g[7] === 1) return true; // ::1
	if (allZeroTo(5) && g[5] === 0xffff) {
		// ::ffff:a.b.c.d
		return isPrivateV4([g[6] >> 8, g[6] & 0xff, g[7] >> 8, g[7] & 0xff]);
	}
	if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
	if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
	return false;
}

export interface AccessPolicy {
	allowPublic: boolean;
}

/** Whether a request from `clientAddress` should be served under `policy`. */
export function isRequestAllowed(
	clientAddress: string | undefined | null,
	policy: AccessPolicy
): boolean {
	return policy.allowPublic || isPrivateAddress(clientAddress);
}
