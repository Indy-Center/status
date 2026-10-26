import { connect } from 'cloudflare:sockets';
import type { Check } from './watch-list';

export type ProbeResult = { up: boolean; detail: string };

const TIMEOUT_MS = 10_000;

/** Checks one item from the watch list once more if it fails, so one dropped request isn't an outage. */
export async function probe(check: Check): Promise<ProbeResult> {
	const first = await probeOnce(check);
	return first.up ? first : probeOnce(check);
}

function probeOnce(check: Check): Promise<ProbeResult> {
	return 'url' in check ? probeSite(check.url) : probePort(check.host, check.port);
}

async function probeSite(url: string): Promise<ProbeResult> {
	try {
		const response = await fetch(url, {
			// A redirect is an answer: don't follow it to somewhere else.
			redirect: 'manual',
			headers: { 'User-Agent': 'IndyCenterStatus/1.0 (+https://status.flyindycenter.com)' },
			signal: AbortSignal.timeout(TIMEOUT_MS)
		});
		await response.body?.cancel();
		return { up: response.status < 500, detail: `HTTP ${response.status}` };
	} catch (error) {
		return { up: false, detail: describe(error) };
	}
}

async function probePort(hostname: string, port: number): Promise<ProbeResult> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new Error(`no answer in ${TIMEOUT_MS / 1000} s`)), TIMEOUT_MS);
	});
	let socket: ReturnType<typeof connect> | undefined;
	try {
		socket = connect({ hostname, port });
		await Promise.race([socket.opened, timeout]);
		return { up: true, detail: `port ${port} open` };
	} catch (error) {
		return { up: false, detail: describe(error) };
	} finally {
		if (timer !== undefined) clearTimeout(timer);
		await socket?.close().catch(() => {});
	}
}

function describe(error: unknown): string {
	if (error instanceof Error) {
		return error.name === 'TimeoutError' ? `no answer in ${TIMEOUT_MS / 1000} s` : error.message;
	}
	return String(error);
}
