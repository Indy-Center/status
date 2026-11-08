/**
 * What the status page watches. Each check is a site, checked over HTTPS, or a TCP port.
 *
 * - A site is up when it answers with any status below 500 within the timeout. A redirect or a
 *   sign-in page still counts as up: the check asks "is it answering?", not "is the page right?".
 * - A TCP port is up when a connection opens within the timeout.
 *
 * The name is what the page and the alerts show, and is how the Worker remembers each check's
 * state, so renaming a check starts it afresh. To add a check, add a line here and open a pull
 * request; it is checked from the next run after the deploy.
 */
export type SiteCheck = { name: string; url: string };
export type PortCheck = { name: string; host: string; port: number };
export type Check = SiteCheck | PortCheck;

export const WATCH_LIST: Check[] = [
	// Workers on Cloudflare
	{ name: 'Community website', url: 'https://flyindycenter.com/' },
	{ name: 'Sign-in (identity)', url: 'https://auth.flyindycenter.com/healthz' },
	{ name: 'Training app', url: 'https://training.flyindycenter.com/' },
	{ name: 'Library', url: 'https://library.flyindycenter.com/' },
	{ name: 'Charts', url: 'https://charts.flyindycenter.com/' },

	// Static sites
	{ name: 'Tech docs', url: 'https://tech.flyindycenter.com/' },
	{ name: 'Brand guide', url: 'https://brand.flyindycenter.com/' },

	// Apps on the VPS, behind Traefik
	{ name: 'CMS', url: 'https://cms.flyindycenter.com/' },
	{ name: 'Wiki', url: 'https://wiki.flyindycenter.com/' },
	{ name: 'Social (Postiz)', url: 'https://social.flyindycenter.com/' },
	{ name: 'Moodle', url: 'https://moodle.flyindycenter.com/' },

	// TeamSpeak's file-transfer port. Voice is UDP (9987), which a Worker cannot check, so this
	// TCP port stands in for "the server is up". The host must stay DNS-only (not proxied):
	// a Worker cannot open a TCP connection to a Cloudflare-proxied address.
	{ name: 'TeamSpeak', host: 'ts.flyzid.org', port: 30033 }
];
