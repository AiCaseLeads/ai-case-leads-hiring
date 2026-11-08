/* Native anchors avoid the reproduced Vinext production Link runtime failure. */
/* eslint-disable @next/next/no-html-link-for-pages */
import { HUB_HISTORY_GUARD } from "@/components/hub/history";
import { getHubMember } from "@/lib/hub/auth";
import {
  chatGPTSignInPath,
  chatGPTSignOutPath,
  getChatGPTUser,
  usesGoogleStaffAuth,
} from "@/app/chatgpt-auth";
import { HiringDashboard } from "@/components/hub/dashboard";
import { PageChrome } from "@/components/careers/chrome";
import "@/components/hub/hub.css";
import "@/components/hub/workspace-v3.css";
import "@/components/hub/workspace-surfaces.css";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Hiring workspace | AI Case Leads",
  robots: "noindex,nofollow",
  referrer: "no-referrer",
};
export default async function TeamPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const signInDestination = query?.view === "settings" ? "/team?view=settings" : "/team";
  const notices: Record<string, string> = {
    expired: "Your sign-in link expired or has already been used. Start a new sign-in below.",
    failed: "Sign-in could not be completed. Please try again with your hiring-team Google account.",
    not_authorized: "This Google account does not have hiring-team access. Use the owner account or ask an administrator to add your email.",
    unavailable: "Google sign-in is temporarily unavailable. Please try again shortly.",
  };
  const notice = usesGoogleStaffAuth() && typeof query?.auth === "string" && Object.hasOwn(notices, query.auth) ? notices[query.auth] : undefined;
  const member = await getHubMember();
  if (member)
    return (
      <>
      <script dangerouslySetInnerHTML={{ __html: HUB_HISTORY_GUARD }} />
      <HiringDashboard
        member={member}
        signOutHref={chatGPTSignOutPath("/team")}
      />
      </>
    );
  const identity = await getChatGPTUser();
  return (
    <PageChrome>
      <main id="main" className="site-width team-page">
        <p className="eyebrow dark">PRIVATE HIRING WORKSPACE</p>
        <h1>Your team’s hiring hub.</h1>
        <p className="team-lead">
          {identity
            ? "This account does not have hiring-team access. Ask the AI Case Leads owner to add your email as an administrator or recruiter."
            : "Sign in to review applications, manage your roles, and coordinate hiring."}
        </p>
        {notice && <p className="team-boundary" role="alert">{notice}</p>}
        {identity ? (
          <p className="team-boundary">
            Signed in as {identity.email}. Candidate records are available only
            to authorized team members.
          </p>
        ) : (
          usesGoogleStaffAuth() ? <form action="/api/auth/google/start" method="get" className="team-sign-in">
            <input type="hidden" name="return_to" value={signInDestination}/>
            <label className="team-remember"><input type="checkbox" name="remember" value="1" aria-describedby="remember-help"/> Keep me signed in for 30 days</label>
            <p id="remember-help" className="team-remember-help">Leave unchecked on shared devices. Otherwise, sign-in lasts 24 hours.</p>
            <button type="submit" className="button ink">Sign in with Google</button>
          </form> : <a className="button ink" href={chatGPTSignInPath(signInDestination)}>Sign in to the hiring hub</a>
        )}
        {usesGoogleStaffAuth() && <p className="team-boundary">Sign in with your own invited Google Workspace account. In Settings → My setup, recruiters connect their own recruiting email and calendar. The owner manages company Drive storage and the fallback calendar separately.</p>}
        <p>
          <a className="back-link" href="/">
            Back to the applicant website
          </a>
        </p>
      </main>
    </PageChrome>
  );
}
