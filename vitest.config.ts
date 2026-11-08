import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [
		cloudflareTest({
			wrangler: { configPath: './wrangler.jsonc' },
			miniflare: {
				bindings: {
					STATUS_PING_TOKEN: 'test-ping-token',
					DISCORD_STATUS_ALERT_WEBHOOK: 'https://discord.com/api/webhooks/1/test'
				}
			}
		})
	]
});
