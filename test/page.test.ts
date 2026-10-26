import { createExecutionContext, reset } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';

import worker from '../src/index';
import { writeChecks, writePings } from '../src/store';
import { WATCH_LIST } from '../src/watch-list';

async function get(path: string) {
	const request = new Request<unknown, IncomingRequestCfProperties>(
		`https://status.flyindycenter.com${path}`
	);
	return worker.fetch(request, env, createExecutionContext());
}

/** The page's text with tags and repeated whitespace removed, to match on what a reader sees. */
async function pageText(): Promise<string> {
	const html = await (await get('/')).text();
	return html
		.replace(/<style[\s\S]*?<\/style>/g, '')
		.replace(/<[^>]+>/g, ' ')
		.replace(/\s+/g, ' ');
}

beforeEach(async () => {
	await reset();
});

describe('the status page', () => {
	it('is plain HTML that needs no sign-in and is never cached', async () => {
		const response = await get('/');

		expect(response.status).toBe(200);
		expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
		expect(response.headers.get('Cache-Control')).toBe('no-store');
		expect(await response.text()).toMatch(/^<!doctype html>/);
	});

	it('lists every check on the watch list, as not checked yet before the first run', async () => {
		const text = await pageText();

		for (const check of WATCH_LIST) {
			expect(text).toContain(`${check.name} Not checked yet`);
		}
	});

	it("shows each check's state and when it last changed", async () => {
		await writeChecks(env, {
			CMS: { up: false, since: '2026-10-25T06:40:00.000Z', detail: 'HTTP 502' },
			Wiki: { up: true, since: '2026-10-20T12:00:00.000Z', detail: 'HTTP 200' }
		});

		const text = await pageText();

		expect(text).toContain('CMS Down (HTTP 502) 2026-10-25 06:40 UTC');
		expect(text).toContain('Wiki Up 2026-10-20 12:00 UTC');
	});

	it("shows each server's last backup ping", async () => {
		await writePings(env, {
			vanderbilt: '2026-10-25T07:12:00.000Z',
			alexandria: '2026-10-25T07:09:00.000Z'
		});

		const text = await pageText();

		expect(text).toContain('alexandria 2026-10-25 07:09 UTC');
		expect(text).toContain('vanderbilt 2026-10-25 07:12 UTC');
	});

	it('says when no backup ping has arrived yet', async () => {
		expect(await pageText()).toContain('No backup ping yet');
	});

	it('escapes what it shows', async () => {
		await writePings(env, { '<b>x</b>': '2026-10-25T07:12:00.000Z' });

		const html = await (await get('/')).text();

		expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
		expect(html).not.toContain('<b>x</b>');
	});

	it('answers 404 for any other path', async () => {
		expect((await get('/admin')).status).toBe(404);
	});
});
