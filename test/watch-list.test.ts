import { createExecutionContext, createScheduledController, reset } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeNet } from './helpers/fakes';

vi.mock('cloudflare:sockets', async () => (await import('./helpers/fakes')).fakeSockets());

import worker from '../src/index';
import { readChecks } from '../src/store';
import { WATCH_LIST } from '../src/watch-list';

beforeEach(async () => {
	await reset();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('the watch list', () => {
	it('names each check once', () => {
		const names = WATCH_LIST.map((check) => check.name);
		expect(new Set(names).size).toBe(names.length);
	});

	it('checks sites over HTTPS on flyindycenter.com', () => {
		for (const check of WATCH_LIST) {
			if (!('url' in check)) continue;
			const url = new URL(check.url);
			expect(url.protocol).toBe('https:');
			expect(
				url.hostname === 'flyindycenter.com' || url.hostname.endsWith('.flyindycenter.com')
			).toBe(true);
		}
	});

	it('includes the CMS and a TCP check for TeamSpeak', () => {
		expect(WATCH_LIST).toContainEqual(
			expect.objectContaining({ url: 'https://cms.flyindycenter.com/' })
		);
		expect(WATCH_LIST).toContainEqual(
			expect.objectContaining({ name: 'TeamSpeak', port: expect.any(Number) })
		);
	});

	it('is what the cron runs', async () => {
		const net = fakeNet();
		const scheduledTime = new Date('2026-10-25T12:00:00Z');

		await worker.scheduled(
			createScheduledController({ scheduledTime }),
			env,
			createExecutionContext()
		);

		expect(Object.keys(await readChecks(env)).sort()).toEqual(
			WATCH_LIST.map((check) => check.name).sort()
		);
		expect(net.alerts).toEqual([]);
	});
});
