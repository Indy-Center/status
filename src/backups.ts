import { alert } from './discord';
import { readMissed, readPings, writeMissed, writePings } from './store';
import { formatTime } from './time';

/** What a ping without `?server=` is filed under: a runner from before servers had names. */
export const UNNAMED_SERVER = 'unnamed server';

const MAX_SERVER_NAME = 64;

/**
 * `POST /backup-finished?server=<name>` with `Authorization: Bearer <secret>`, no body: the runner's
 * daily "backup finished" ping. Records the time against the server.
 */
export async function handlePing(request: Request, env: Env): Promise<Response> {
	if (request.method !== 'POST') {
		return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
	}
	if (!(await authorized(request, env))) {
		return new Response('Unauthorized', { status: 401 });
	}

	const server = new URL(request.url).searchParams.get('server')?.trim() || UNNAMED_SERVER;
	if (server.length > MAX_SERVER_NAME || /[\p{Cc}]/u.test(server)) {
		return new Response('Bad server name', { status: 400 });
	}

	const pings = await readPings(env);
	pings[server] = new Date().toISOString();
	await writePings(env, pings);
	return new Response(null, { status: 204 });
}

async function authorized(request: Request, env: Env): Promise<boolean> {
	const secret = env.STATUS_PING_TOKEN;
	if (!secret) {
		console.error('STATUS_PING_TOKEN is not set: refusing every ping');
		return false;
	}
	const header = request.headers.get('Authorization') ?? '';
	if (!header.startsWith('Bearer ')) return false;
	// Compare digests, so the comparison takes the same time whatever the lengths.
	const [given, expected] = await Promise.all([digest(header.slice(7)), digest(secret)]);
	return crypto.subtle.timingSafeEqual(given, expected);
}

async function digest(value: string): Promise<ArrayBuffer> {
	return crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
}

/**
 * Alerts for each server that has pinged before but not yet today, once the deadline hour (UTC)
 * has passed. Each server is alerted once per missed day; if Discord doesn't take the alert, the
 * next run tries again.
 */
export async function checkMorning(env: Env, now: Date): Promise<void> {
	const deadlineHour = deadlineHourUtc(env);
	if (now.getUTCHours() < deadlineHour) return;

	const today = now.toISOString().slice(0, 10);
	const pings = await readPings(env);
	const missed = await readMissed(env);
	let alerted = false;

	for (const [server, last] of Object.entries(pings)) {
		if (last.slice(0, 10) >= today || missed[server] === today) continue;
		const sent = await alert(
			env,
			`🟠 No backup finished on **${server}** by ${String(deadlineHour).padStart(2, '0')}:00 UTC today. ` +
				`Its last "backup finished" ping was ${formatTime(last)}. Check the runner's log on the server.`
		);
		if (sent) {
			missed[server] = today;
			alerted = true;
		}
	}

	if (alerted) await writeMissed(env, missed);
}

const DEFAULT_DEADLINE_HOUR = 9;

/** BACKUP_DEADLINE_HOUR_UTC as a whole hour, 0 to 23. A bad value falls back to 09:00 UTC. */
export function deadlineHourUtc(env: Env): number {
	const hour = Number(env.BACKUP_DEADLINE_HOUR_UTC);
	if (Number.isInteger(hour) && hour >= 0 && hour <= 23) return hour;
	console.error(`BACKUP_DEADLINE_HOUR_UTC is not an hour (0-23); using ${DEFAULT_DEADLINE_HOUR}`);
	return DEFAULT_DEADLINE_HOUR;
}
