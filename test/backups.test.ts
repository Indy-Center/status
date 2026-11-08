import { createExecutionContext, createScheduledController, reset } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeNet, type FakeNet } from './helpers/fakes';

vi.mock('cloudflare:sockets', async () => (await import('./helpers/fakes')).fakeSockets());

import { checkMorning } from '../src/backups';
import worker from '../src/index';
import { readPings, writePings } from '../src/store';

const URL_BASE = 'https://status.flyindycenter.com/backup-finished';
const GOOD = `Bearer ${env.STATUS_PING_TOKEN}`;

function ping(query: string, authorization?: string, method = 'POST', testEnv: Env = env) {
	const headers = authorization ? { Authorization: authorization } : undefined;
	const request = new Request<unknown, IncomingRequestCfProperties>(`${URL_BASE}${query}`, {
		method,
		headers
	});
	return worker.fetch(request, testEnv, createExecutionContext());
}

let net: FakeNet;

beforeEach(async () => {
	await reset();
	net = fakeNet();
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date('2026-10-25T07:10:00Z'));
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('the "backup finished" endpoint', () => {
	it('records the ping against its server', async () => {
		const response = await ping('?server=vanderbilt', GOOD);

		expect(response.status).toBe(204);
		expect(await readPings(env)).toEqual({ vanderbilt: '2026-10-25T07:10:00.000Z' });
	});

	it('keeps each server apart', async () => {
		await ping('?server=vanderbilt', GOOD);
		vi.setSystemTime(new Date('2026-10-25T07:20:00Z'));
		await ping('?server=alexandria', GOOD);

		expect(await readPings(env)).toEqual({
			vanderbilt: '2026-10-25T07:10:00.000Z',
			alexandria: '2026-10-25T07:20:00.000Z'
		});
	});

	it('records a ping without a server as an older, unnamed runner', async () => {
		const response = await ping('', GOOD);

		expect(response.status).toBe(204);
		expect(await readPings(env)).toEqual({ 'unnamed server': '2026-10-25T07:10:00.000Z' });
	});

	it('takes an URL-encoded server name, as the runner sends it', async () => {
		await ping('?server=unnamed%20server', GOOD);

		expect(Object.keys(await readPings(env))).toEqual(['unnamed server']);
	});

	it('refuses a wrong secret', async () => {
		const response = await ping('?server=vanderbilt', 'Bearer not-the-secret');

		expect(response.status).toBe(401);
		expect(await readPings(env)).toEqual({});
	});

	it('refuses a missing secret', async () => {
		const response = await ping('?server=vanderbilt');

		expect(response.status).toBe(401);
		expect(await readPings(env)).toEqual({});
	});

	it('refuses the secret without "Bearer"', async () => {
		const response = await ping('?server=vanderbilt', env.STATUS_PING_TOKEN);

		expect(response.status).toBe(401);
	});

	it('refuses every ping while the Worker has no secret set', async () => {
		const response = await ping('?server=vanderbilt', 'Bearer ', 'POST', {
			...env,
			STATUS_PING_TOKEN: ''
		});

		expect(response.status).toBe(401);
		expect(await readPings(env)).toEqual({});
	});

	it('refuses a server name too long to be one', async () => {
		const response = await ping(`?server=${'x'.repeat(65)}`, GOOD);

		expect(response.status).toBe(400);
		expect(await readPings(env)).toEqual({});
	});

	it('only takes POST', async () => {
		const response = await ping('?server=vanderbilt', GOOD, 'GET');

		expect(response.status).toBe(405);
		expect(response.headers.get('Allow')).toBe('POST');
	});
});

describe('the morning backup check', () => {
	const at = (iso: string) => new Date(iso);

	it('says nothing before any server has pinged', async () => {
		await checkMorning(env, at('2026-10-25T09:00:00Z'));

		expect(net.alerts).toEqual([]);
	});

	it('says nothing when the server pinged this morning', async () => {
		await writePings(env, { vanderbilt: '2026-10-25T07:12:00.000Z' });

		await checkMorning(env, at('2026-10-25T09:00:00Z'));

		expect(net.alerts).toEqual([]);
	});

	it('waits until the deadline hour before alerting', async () => {
		await writePings(env, { vanderbilt: '2026-10-24T07:12:00.000Z' });

		await checkMorning(env, at('2026-10-25T08:55:00Z'));

		expect(net.alerts).toEqual([]);
	});

	it('alerts when a server has not pinged by the deadline, naming it and its last ping', async () => {
		await writePings(env, { vanderbilt: '2026-10-24T07:12:00.000Z' });

		await checkMorning(env, at('2026-10-25T09:00:00Z'));

		expect(net.alerts).toHaveLength(1);
		expect(net.alerts[0]).toContain('vanderbilt');
		expect(net.alerts[0]).toContain('09:00 UTC');
		expect(net.alerts[0]).toContain('2026-10-24 07:12 UTC');
	});

	it('alerts once per missed day', async () => {
		await writePings(env, { vanderbilt: '2026-10-24T07:12:00.000Z' });

		await checkMorning(env, at('2026-10-25T09:00:00Z'));
		await checkMorning(env, at('2026-10-25T09:05:00Z'));
		await checkMorning(env, at('2026-10-25T23:55:00Z'));
		expect(net.alerts).toHaveLength(1);

		await checkMorning(env, at('2026-10-26T09:00:00Z'));
		await checkMorning(env, at('2026-10-26T09:05:00Z'));
		expect(net.alerts).toHaveLength(2);
	});

	it('alerts for the silent server only, so a healthy one cannot hide it', async () => {
		await writePings(env, {
			vanderbilt: '2026-10-24T07:12:00.000Z',
			alexandria: '2026-10-25T07:08:00.000Z'
		});

		await checkMorning(env, at('2026-10-25T09:00:00Z'));

		expect(net.alerts).toHaveLength(1);
		expect(net.alerts[0]).toContain('vanderbilt');
		expect(net.alerts[0]).not.toContain('alexandria');
	});

	it('tries again next run if Discord did not take the alert', async () => {
		await writePings(env, { vanderbilt: '2026-10-24T07:12:00.000Z' });
		net.discordDown(true);
		vi.spyOn(console, 'error').mockImplementation(() => {});

		await checkMorning(env, at('2026-10-25T09:00:00Z'));
		net.discordDown(false);
		await checkMorning(env, at('2026-10-25T09:05:00Z'));

		expect(net.alerts).toHaveLength(1);
	});

	it('uses the deadline hour from the Worker config', async () => {
		await writePings(env, { vanderbilt: '2026-10-24T07:12:00.000Z' });
		const later = { ...env, BACKUP_DEADLINE_HOUR_UTC: '11' };

		await checkMorning(later, at('2026-10-25T10:00:00Z'));
		expect(net.alerts).toEqual([]);

		await checkMorning(later, at('2026-10-25T11:00:00Z'));
		expect(net.alerts).toHaveLength(1);
	});

	it('falls back to 09:00 UTC when the deadline hour is not an hour', async () => {
		await writePings(env, { vanderbilt: '2026-10-24T07:12:00.000Z' });
		const broken = { ...env, BACKUP_DEADLINE_HOUR_UTC: 'nine' };
		vi.spyOn(console, 'error').mockImplementation(() => {});

		await checkMorning(broken, at('2026-10-25T08:00:00Z'));
		expect(net.alerts).toEqual([]);

		await checkMorning(broken, at('2026-10-25T09:00:00Z'));
		expect(net.alerts).toHaveLength(1);
	});

	it('runs on the cron', async () => {
		await writePings(env, { vanderbilt: '2026-10-24T07:12:00.000Z' });
		const scheduledTime = at('2026-10-25T09:00:00Z');

		await worker.scheduled(
			createScheduledController({ scheduledTime }),
			env,
			createExecutionContext()
		);

		expect(net.alerts).toHaveLength(1);
		expect(net.alerts[0]).toContain('vanderbilt');
	});
});
