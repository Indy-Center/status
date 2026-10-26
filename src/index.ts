import { checkMorning, handlePing } from './backups';
import { runChecks } from './checks';
import { renderPage } from './page';
import { WATCH_LIST } from './watch-list';

export default {
	async fetch(request, env, _ctx): Promise<Response> {
		const { pathname } = new URL(request.url);
		if (pathname === '/backup-finished') return handlePing(request, env);
		if (pathname === '/' && (request.method === 'GET' || request.method === 'HEAD')) {
			return renderPage(env, WATCH_LIST);
		}
		return new Response('Not found', { status: 404 });
	},

	async scheduled(controller, env, _ctx): Promise<void> {
		const now = new Date(controller.scheduledTime);
		await Promise.all([runChecks(env, now, WATCH_LIST), checkMorning(env, now)]);
	}
} satisfies ExportedHandler<Env>;
