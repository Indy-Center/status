/** "2026-10-25 07:05 UTC" from an ISO 8601 time. */
export function formatTime(iso: string): string {
	return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}
