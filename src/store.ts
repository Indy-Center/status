/**
 * The Worker's state in KV. Three keys, each written by one part only, so two writers never race
 * over the same key:
 *
 * - `checks`, by the scheduled checks: each check's state and when it last changed.
 * - `pings`, by the "backup finished" endpoint: each server's last ping.
 * - `missed`, by the morning backup check: the last day each server was alerted for.
 */

export type CheckState = {
	up: boolean;
	/** When the check last changed state (ISO 8601). */
	since: string;
	/** What the last change saw, such as "HTTP 502" or "connection refused". */
	detail: string;
};

/** Check name → state. */
export type ChecksState = Record<string, CheckState>;
/** Server name → time of its last "backup finished" ping (ISO 8601). */
export type Pings = Record<string, string>;
/** Server name → the UTC day (YYYY-MM-DD) it was last alerted for missing its ping. */
export type Missed = Record<string, string>;

async function read<T>(env: Env, key: string): Promise<Record<string, T>> {
	return (await env.STATUS.get<Record<string, T>>(key, 'json')) ?? {};
}

async function write<T>(env: Env, key: string, value: Record<string, T>): Promise<void> {
	await env.STATUS.put(key, JSON.stringify(value));
}

export const readChecks = (env: Env) => read<CheckState>(env, 'checks');
export const writeChecks = (env: Env, value: ChecksState) => write(env, 'checks', value);
export const readPings = (env: Env) => read<string>(env, 'pings');
export const writePings = (env: Env, value: Pings) => write(env, 'pings', value);
export const readMissed = (env: Env) => read<string>(env, 'missed');
export const writeMissed = (env: Env, value: Missed) => write(env, 'missed', value);
