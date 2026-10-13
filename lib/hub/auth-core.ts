export type HubMember = { email: string; userId: string; role: "admin" | "recruiter"; isOwner?: boolean };
export type AuthEnv = { DB?: D1Database; ADMIN_EMAILS?: string };
// These identity headers are supplied by the Sites authentication dispatcher.
// Anonymous application cookies are deliberately irrelevant to staff membership.
export async function memberFromHeaders(requestHeaders: Headers, bindings: AuthEnv): Promise<HubMember | null> {
  const userId = requestHeaders.get("oai-authenticated-user-id");
  const email = requestHeaders.get("oai-authenticated-user-email")?.trim().toLowerCase();
  if (!userId || !email) return null;
  const owners = (bindings.ADMIN_EMAILS || "").split(",").map(value => value.trim().toLowerCase()).filter(Boolean);
  if (owners.includes(email)) return { email, userId, role: "admin", isOwner: true };
  if (!bindings.DB) return null;
  const member = await bindings.DB.prepare("SELECT role FROM hub_members WHERE email = ? AND active = 1").bind(email).first<{ role: string }>();
  return member && (member.role === "admin" || member.role === "recruiter") ? { email, userId, role: member.role, isOwner: false } : null;
}
