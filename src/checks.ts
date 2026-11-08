import { alert } from './discord';
import { probe } from './probe';
import { readChecks, writeChecks, type ChecksState } from './store';
import type { Check } from './watch-list';

/**
 * Runs every check, and alerts tech-team-alerts when one goes down or comes back. State is written
 * only when a check changes, so a quiet run costs no KV writes and a check that stays down alerts
 * once.
 */
export async function runChecks(env: Env, now: Date, list: Check[]): Promise<void> {
	const before = await readChecks(env);
	const results = await Promise.all(
		list.map(async (check) => ({ check, ...(await probe(check)) }))
	);

	const after: ChecksState = {};
	const alerts: string[] = [];
	for (const { check, up, detail } of results) {
		const previous = before[check.name];
		if (previous && previous.up === up) {
			after[check.name] = previous;
			continue;
		}
		after[check.name] = { up, since: now.toISOString(), detail };
		if (!up) {
			alerts.push(`🔴 **${check.name}** is down: ${detail} (${target(check)})`);
		} else if (previous) {
			alerts.push(`🟢 **${check.name}** is back up after ${duration(previous.since, now)}.`);
		}
	}

	if (changed(before, after)) await writeChecks(env, after);
	for (const message of alerts) await alert(env, message);
}

function target(check: Check): string {
	return 'url' in check ? check.url : `${check.host}:${check.port}`;
}

function changed(before: ChecksState, after: ChecksState): boolean {
	const names = new Set([...Object.keys(before), ...Object.keys(after)]);
	for (const name of names) {
		const a = before[name];
		const b = after[name];
		if (!a || !b || a.up !== b.up || a.since !== b.since) return true;
	}
	return false;
}

/** "20 min", "3 h 5 min" or "2 d 4 h". */
export function duration(since: string, now: Date): string {
	const minutes = Math.max(0, Math.round((now.getTime() - Date.parse(since)) / 60_000));
	if (minutes < 60) return `${minutes} min`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours} h ${minutes % 60} min`;
	return `${Math.floor(hours / 24)} d ${hours % 24} h`;
}
