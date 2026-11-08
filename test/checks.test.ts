import { reset } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closedPorts, fakeNet, type FakeNet } from './helpers/fakes';

vi.mock('cloudflare:sockets', async () => (await import('./helpers/fakes')).fakeSockets());

import { runChecks } from '../src/checks';
import { readChecks } from '../src/store';
import type { Check } from '../src/watch-list';

const SITE_A = 'https://a.example.com/';
const SITE_B = 'https://b.example.com/healthz';

const LIST: Check[] = [
	{ name: 'Site A', url: SITE_A },
	{ name: 'Site B', url: SITE_B },
	{ name: 'Voice', host: 'voice.example.com', port: 30033 }
];

const T0 = new Date('2026-10-25T12:00:00Z');
const minutesAfter = (m: number) => new Date(T0.getTime() + m * 60_000);

let net: FakeNet;

beforeEach(async () => {
	await reset();
	closedPorts.clear();
	net = fakeNet();
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('the scheduled checks', () => {
	it('records every check as up on the first run, without alerting', async () => {
		await runChecks(env, T0, LIST);

		expect(net.alerts).toEqual([]);
		const state = await readChecks(env);
		expect(Object.keys(state).sort()).toEqual(['Site A', 'Site B', 'Voice']);
		for (const check of Object.values(state)) {
			expect(check).toMatchObject({ up: true, since: T0.toISOString() });
		}
	});

	it('checks each site over HTTPS at its URL', async () => {
		await runChecks(env, T0, LIST);

		expect(net.fetched.sort()).toEqual([SITE_A, SITE_B]);
	});

	it('alerts once when a site goes down, and records when', async () => {
		await runChecks(env, T0, LIST);
		net.site(SITE_A, 502);

		await runChecks(env, minutesAfter(5), LIST);

		expect(net.alerts).toHaveLength(1);
		expect(net.alerts[0]).toContain('Site A');
		expect(net.alerts[0]).toMatch(/down/i);
		expect(net.alerts[0]).toContain('502');
		expect((await readChecks(env))['Site A']).toMatchObject({
			up: false,
			since: minutesAfter(5).toISOString()
		});
	});

	it('does not alert again, or write, while a site stays down', async () => {
		await runChecks(env, T0, LIST);
		net.site(SITE_A, 503);
		await runChecks(env, minutesAfter(5), LIST);
		const put = vi.spyOn(env.STATUS, 'put');

		await runChecks(env, minutesAfter(10), LIST);
		await runChecks(env, minutesAfter(15), LIST);

		expect(net.alerts).toHaveLength(1);
		expect(put).not.toHaveBeenCalled();
		expect((await readChecks(env))['Site A']?.since).toBe(minutesAfter(5).toISOString());
	});

	it('does not write at all while nothing changes', async () => {
		await runChecks(env, T0, LIST);
		const put = vi.spyOn(env.STATUS, 'put');

		await runChecks(env, minutesAfter(5), LIST);

		expect(put).not.toHaveBeenCalled();
	});

	it('alerts when a site comes back, saying how long it was down', async () => {
		await runChecks(env, T0, LIST);
		net.site(SITE_A, 500);
		await runChecks(env, minutesAfter(5), LIST);
		net.site(SITE_A, 200);

		await runChecks(env, minutesAfter(25), LIST);

		expect(net.alerts).toHaveLength(2);
		expect(net.alerts[1]).toContain('Site A');
		expect(net.alerts[1]).toMatch(/back up/i);
		expect(net.alerts[1]).toContain('20 min');
		expect((await readChecks(env))['Site A']).toMatchObject({
			up: true,
			since: minutesAfter(25).toISOString()
		});
	});

	it('treats a site it cannot reach as down', async () => {
		await runChecks(env, T0, LIST);
		net.site(SITE_B, 'unreachable');

		await runChecks(env, minutesAfter(5), LIST);

		expect(net.alerts).toHaveLength(1);
		expect(net.alerts[0]).toContain('Site B');
		expect((await readChecks(env))['Site B']?.up).toBe(false);
	});

	it('counts any answer below 500 as up, since the site is answering', async () => {
		net.site(SITE_A, 404);
		net.site(SITE_B, 302);

		await runChecks(env, T0, LIST);

		const state = await readChecks(env);
		expect(state['Site A']?.up).toBe(true);
		expect(state['Site B']?.up).toBe(true);
		expect(net.alerts).toEqual([]);
	});

	it('tries a failed check once more before calling it down', async () => {
		await runChecks(env, T0, LIST);
		net.siteOnce(SITE_A, 'unreachable', 200);

		await runChecks(env, minutesAfter(5), LIST);

		expect(net.alerts).toEqual([]);
		expect((await readChecks(env))['Site A']?.up).toBe(true);
	});

	it('alerts when a check is down the first time it is seen', async () => {
		net.site(SITE_A, 502);

		await runChecks(env, T0, LIST);

		expect(net.alerts).toHaveLength(1);
		expect(net.alerts[0]).toContain('Site A');
	});

	it('checks that a TCP port answers, and alerts when it stops and comes back', async () => {
		await runChecks(env, T0, LIST);
		closedPorts.add('voice.example.com:30033');

		await runChecks(env, minutesAfter(5), LIST);
		expect(net.alerts).toHaveLength(1);
		expect(net.alerts[0]).toContain('Voice');
		expect((await readChecks(env))['Voice']?.up).toBe(false);

		closedPorts.clear();
		await runChecks(env, minutesAfter(10), LIST);
		expect(net.alerts).toHaveLength(2);
		expect(net.alerts[1]).toMatch(/back up/i);
	});

	it('still records a change when Discord is down', async () => {
		await runChecks(env, T0, LIST);
		net.discordDown(true);
		net.site(SITE_A, 502);
		vi.spyOn(console, 'error').mockImplementation(() => {});

		await runChecks(env, minutesAfter(5), LIST);

		expect((await readChecks(env))['Site A']?.up).toBe(false);
	});

	it('forgets a check that has left the watch list', async () => {
		await runChecks(env, T0, LIST);

		await runChecks(env, minutesAfter(5), LIST.slice(1));

		expect(Object.keys(await readChecks(env)).sort()).toEqual(['Site B', 'Voice']);
		expect(net.alerts).toEqual([]);
	});
});
