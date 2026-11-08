import { readChecks, readPings } from './store';
import { formatTime } from './time';
import type { Check } from './watch-list';

/** The status page: each check's state and when it last changed, and each server's last backup ping. */
export async function renderPage(env: Env, list: Check[]): Promise<Response> {
	const [checks, pings] = await Promise.all([readChecks(env), readPings(env)]);

	const checkRows = list
		.map((check) => {
			const state = checks[check.name];
			if (!state) {
				return row(check.name, '<span class="unknown">Not checked yet</span>', '—');
			}
			const label = state.up
				? '<span class="up">Up</span>'
				: `<span class="down">Down (${escape(state.detail)})</span>`;
			return row(check.name, label, formatTime(state.since));
		})
		.join('');

	const servers = Object.keys(pings).sort();
	const backupRows = servers.length
		? servers.map((server) => row(server, formatTime(pings[server]!))).join('')
		: '<tr><td colspan="2">No backup ping yet</td></tr>';

	const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="60">
<title>Indy Center status</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<h1>Indy Center status</h1>
<p class="note">Checked every 5 minutes. Times are UTC. This page refreshes itself every minute.</p>
<h2>Services</h2>
<table>
<thead><tr><th>Service</th><th>State</th><th>Since</th></tr></thead>
<tbody>${checkRows}</tbody>
</table>
<h2>Backups</h2>
<table>
<thead><tr><th>Server</th><th>Last backup finished</th></tr></thead>
<tbody>${backupRows}</tbody>
</table>
</main>
</body>
</html>
`;
	return new Response(html, {
		headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
	});
}

/** One table row. The first cell is escaped here; the rest are HTML already. */
function row(first: string, ...rest: string[]): string {
	return `<tr><td>${escape(first)}</td>${rest.map((cell) => `<td>${cell}</td>`).join('')}</tr>`;
}

function escape(text: string): string {
	return text
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}

const STYLE = `
:root { color-scheme: light dark; --bg: #fff; --fg: #1a1a1a; --muted: #666; --line: #ddd;
  --up: #1a7f37; --down: #cf222e; }
@media (prefers-color-scheme: dark) {
  :root { --bg: #111; --fg: #eee; --muted: #999; --line: #333; --up: #3fb950; --down: #f85149; }
}
body { margin: 0; background: var(--bg); color: var(--fg);
  font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 44rem; margin: 0 auto; padding: 1.5rem 1rem; }
h1 { font-size: 1.5rem; margin: 0 0 .25rem; }
h2 { font-size: 1.125rem; margin: 2rem 0 .5rem; }
.note { color: var(--muted); margin: 0; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: .5rem .5rem .5rem 0; border-bottom: 1px solid var(--line);
  vertical-align: top; }
th { font-weight: 600; color: var(--muted); font-size: .875rem; }
.up { color: var(--up); font-weight: 600; }
.down { color: var(--down); font-weight: 600; }
.unknown { color: var(--muted); }
`;
