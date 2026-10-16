export const DEFAULT_MATCH_HOURLY_LIMIT=120;
export const MIN_MATCH_HOURLY_LIMIT=30;
export const MAX_MATCH_HOURLY_LIMIT=1000;
/** Invalid historical configuration keeps the existing spend guard. Never fail open. */
export function matchHourlyLimit(config:{hourlyLimit?:number}):number {
 return Number.isSafeInteger(config.hourlyLimit)&&config.hourlyLimit!>=MIN_MATCH_HOURLY_LIMIT&&config.hourlyLimit!<=MAX_MATCH_HOURLY_LIMIT?config.hourlyLimit!:DEFAULT_MATCH_HOURLY_LIMIT;
}
