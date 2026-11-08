import { env } from 'cloudflare:workers';
import { vi } from 'vitest';

/** What a faked site answers: an HTTP status, or 'unreachable' for a network error or timeout. */
export type SiteAnswer = number | 'unreachable';

export type FakeNet = {
	/** Set what a URL answers from now on. URLs not set answer 200. */
	site(url: string, answer: SiteAnswer): void;
	/** Answer `first` once, then `answer` after that. */
	siteOnce(url: string, first: SiteAnswer, answer: SiteAnswer): void;
	/** Make the Discord webhook fail (true) or work (false). */
	discordDown(down: boolean): void;
	/** Every message posted to the Discord webhook, in order. */
	alerts: string[];
	/** Every site URL fetched, in order. */
	fetched: string[];
};

/**
 * Stands in for the internet: the Discord webhook records what it is sent, and every other URL is
 * a site that answers 200 unless told otherwise.
 */
export function fakeNet(): FakeNet {
	const answers = new Map<string, SiteAnswer[]>();
	let discordFails = false;
	const net: FakeNet = {
		alerts: [],
		fetched: [],
		site(url, answer) {
			answers.set(url, [answer]);
		},
		siteOnce(url, first, answer) {
			answers.set(url, [first, answer]);
		},
		discordDown(down) {
			discordFails = down;
		}
	};
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = input instanceof Request ? input.url : String(input);
			if (url === env.DISCORD_STATUS_ALERT_WEBHOOK) {
				if (discordFails) return new Response('Discord is down', { status: 500 });
				const body = JSON.parse(String(init?.body)) as { content: string };
				net.alerts.push(body.content);
				return new Response(null, { status: 204 });
			}
			net.fetched.push(url);
			const queue = answers.get(url);
			const answer = queue && queue.length > 1 ? queue.shift()! : (queue?.[0] ?? 200);
			if (answer === 'unreachable') throw new Error(`fake network error for ${url}`);
			return new Response(null, { status: answer });
		})
	);
	return net;
}

/** Ports the faked TCP checks find closed. Every other host:port opens. */
export const closedPorts = new Set<string>();

/** For vi.mock('cloudflare:sockets'): a connect() that opens unless the port is in closedPorts. */
export function fakeSockets() {
	return {
		connect: ({ hostname, port }: { hostname: string; port: number }) => {
			const closed = closedPorts.has(`${hostname}:${port}`);
			const opened = closed ? Promise.reject(new Error('connection refused')) : Promise.resolve({});
			opened.catch(() => {});
			return { opened, close: async () => {} };
		}
	};
}
