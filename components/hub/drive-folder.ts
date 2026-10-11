/** Accept only a Drive folder ID or an HTTPS Google Drive folder URL. */
export function driveFolderId(value: string): string | null {
  const input = value.trim();
  if (!input) return "";
  const validId = /^[A-Za-z0-9_-]{10,200}$/;
  if (validId.test(input)) return input;
  try {
    const url = new URL(input);
    if (url.protocol !== "https:" || url.hostname !== "drive.google.com" || url.port || url.username || url.password) return null;
    const match = url.pathname.match(/^\/drive\/(?:u\/\d+\/)?folders\/([A-Za-z0-9_-]{10,200})\/?$/);
    return match?.[1] || null;
  } catch {
    return null;
  }
}
