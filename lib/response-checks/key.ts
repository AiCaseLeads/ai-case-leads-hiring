import { HiringError } from "../hiring/errors";
import type { HubStore } from "../hub/store";
import { openToken, sealToken } from "../google/oauth";
import { getDetectorAllowance, DetectorError } from "./gptzero";

const setting = "response_checks_gptzero_connection";
export async function getDetectorKey(store: HubStore): Promise<string|null> {
  const sealed = await store.setting<string|null>(setting, null);
  if (!sealed) return process.env.GPTZERO_API_KEY?.trim() || null;
  const encryption = process.env.GOOGLE_TOKEN_KEY;
  if (!encryption) throw new HiringError("encryption_unavailable",503,"Server encryption is unavailable.");
  return openToken(sealed, encryption);
}
export async function saveDetectorKey(store: HubStore, key: unknown) {
  const encryption = process.env.GOOGLE_TOKEN_KEY;
  if (!encryption) throw new HiringError("encryption_unavailable",503,"Server encryption is unavailable.");
  if (typeof key !== "string" || !/^[a-zA-Z0-9_\-.]{16,512}$/.test(key.trim())) {
    throw new HiringError("invalid_detector_key",422,"Enter a valid GPTZero API key.");
  }
  const value = key.trim();
  try {
    const wordsRemaining = await getDetectorAllowance(value);
    await store.setSetting(setting, await sealToken(value,encryption));
    return {connected:true,wordsRemaining};
  } catch (error) {
    if (!(error instanceof DetectorError)) throw error;
    if (error.status===401 || error.status===403) throw new HiringError("detector_key_rejected",422,"GPTZero rejected the API key.");
    throw new HiringError("detector_unavailable",503,"GPTZero could not verify the connection right now. Try again later.");
  }
}
