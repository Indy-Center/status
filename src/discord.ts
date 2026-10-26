/**
 * Posts an alert to tech-team-alerts through the Status webhook. Returns whether Discord took it;
 * a failure is logged, never thrown, so one lost alert can't stop the rest of a run.
 */
export async function alert(env: Env, content: string): Promise<boolean> {
	try {
		const response = await fetch(env.DISCORD_STATUS_ALERT_WEBHOOK, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			// No pings: the alert is for whoever reads the channel.
			body: JSON.stringify({ content, allowed_mentions: { parse: [] } })
		});
		if (response.ok) return true;
		console.error(`Discord refused an alert: HTTP ${response.status}`, content);
	} catch (error) {
		console.error('Could not post an alert to Discord', error, content);
	}
	return false;
}
