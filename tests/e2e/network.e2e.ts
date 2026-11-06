import { expect, test } from '@playwright/test';
import { signInAsAdult } from './adult';
import { gotoHydrated } from './hydrated';

// NET-2: the Network page. A synthetic network in TEST-NET space is unroutable, so every device
// reads as down; the test checks the page shows the plan, the list and the state, not real reachability.
// Every project writes the same list and plan, so parallel runs sharing one database agree.
const devices = [
	{ id: 'e2e-router', name: 'Test router', ip: '10.255.1.1', probe: { kind: 'nest' } },
	{ id: 'e2e-server', name: 'Test server', ip: '10.255.1.4', probe: { kind: 'tcp', port: 22 } }
];
const plan = {
	rooms: [
		{ id: 'den', name: 'Den', x: 0, y: 0, w: 14, h: 12, floor: 1 },
		{ id: 'loft', name: 'Loft', x: 0, y: 0, w: 10, h: 8, floor: 2 }
	],
	devices: [
		{ id: 'e2e-router', x: 4, y: 4, floor: 1 },
		{ id: 'e2e-server', x: 5, y: 5, floor: 2 }
	]
};

test('an adult sees the network on the floor plan @J20.1', async ({ page }, info) => {
	await signInAsAdult(page, `e2e-network-${info.project.name}`);
	expect((await page.request.put('/api/network', { data: { devices } })).ok()).toBe(true);
	expect((await page.request.put('/api/network/layout', { data: plan })).ok()).toBe(true);

	await gotoHydrated(page, '/settings/network');
	await expect(page.getByRole('heading', { name: 'Network' })).toBeVisible();
	await expect(page.getByTestId('net-floorplan')).toBeVisible();
	await expect(page.getByTestId('net-device')).toHaveCount(2);
	const server = page.getByTestId('net-device').filter({ hasText: 'Test server' });
	await expect(server).toContainText('Loft');
	await expect(server).toContainText('10.255.1.4');

	// The server sits upstairs: picking it switches the plan to that floor.
	await server.click();
	await expect(page.getByRole('button', { name: 'Upstairs' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await expect(server).toHaveAttribute('aria-expanded', 'true');
	await expect(page.getByTestId('net-pin')).toHaveCount(2);
});

test('settings links to the Network page @J20.1', async ({ page }, info) => {
	await signInAsAdult(page, `e2e-network-link-${info.project.name}`);
	await gotoHydrated(page, '/settings');
	await page.getByRole('link', { name: /Network/ }).click();
	await expect(page).toHaveURL(/\/settings\/network$/);
});

test('an adult imports a plan, edits devices and moves one @J20.2', async ({ page }, info) => {
	await signInAsAdult(page, `e2e-network-setup-${info.project.name}`);
	expect((await page.request.put('/api/network', { data: { devices } })).ok()).toBe(true);
	await gotoHydrated(page, '/settings/network');

	// Import by pasting the plan builder's JSON.
	await page.getByTestId('net-paste').fill(JSON.stringify(plan));
	await page.getByTestId('net-paste-import').click();
	await expect(page.getByText('Imported 2 rooms and 2 device spots.')).toBeVisible();

	// Move the router upstairs: pick it, switch floors, tap the plan. (Projects share one database,
	// so only the page's own optimistic state is asserted, never the starting room.)
	const router = page.getByTestId('net-device').filter({ hasText: 'Test router' });
	await router.click();
	await page.getByTestId('net-move').click();
	await expect(page.getByTestId('net-placing')).toBeVisible();
	await page.getByRole('button', { name: 'Upstairs' }).click();
	await page.getByTestId('net-place-sheet').click();
	await expect(router).toContainText('Loft');

	// The device list editor shows each device with its check.
	await page.getByTestId('net-edit-devices').click();
	await expect(page.getByTestId('net-row')).toHaveCount(2);
	await expect(page.getByTestId('net-row-ip').first()).toHaveValue('10.255.1.1');
	await page.getByTestId('net-save').click();
	await expect(page.getByText('Saved. The hub checks them every minute.')).toBeVisible();

	// Leave the shared plan as the other tests expect it.
	expect((await page.request.put('/api/network/layout', { data: plan })).ok()).toBe(true);
});
