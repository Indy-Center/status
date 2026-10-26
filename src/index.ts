import { runChecks } from './checks';
import { WATCH_LIST } from './watch-list';

export default {
	async fetch(): Promise<Response> {
		return new Response('Not found', { status: 404 });
	},

	async scheduled(controller, env, _ctx): Promise<void> {
		const now = new Date(controller.scheduledTime);
		await runChecks(env, now, WATCH_LIST);
	}
} satisfies ExportedHandler<Env>;
