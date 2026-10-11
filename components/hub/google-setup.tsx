"use client";
import { useEffect, useState } from "react";
import { useHubMutation, useHubResource } from "./api";
import { Badge, Feedback, Field, ResourceState } from "./shared";
export function GoogleConfiguration() {
  const [clientId, setClientId] = useState(""),
    [clientSecret, setClientSecret] = useState(""),
    [redirectUri, setRedirectUri] = useState("");
  const resource = useHubResource<{
      configured: boolean;
      connected: boolean;
      sender?: string;
      expectedSender?: string;
      credentialsManaged?: boolean;
      hostingPlatform?: string;
    }>("/api/google/status"),
    mutation = useHubMutation();
  useEffect(() => {
    queueMicrotask(() =>
      setRedirectUri(window.location.origin + "/api/google/callback"),
    );
  }, []);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const result = await mutation.run(
      "/api/google/configure",
      "POST",
      { clientId: clientId.trim(), clientSecret },
      "Google client configuration saved securely. Connect Google Workspace below to authorize the company account.",
    );
    if (result !== undefined) {
      setClientSecret("");
      setClientId("");
      void resource.reload();
    }
  }
  if (!resource.data) return <section className="hub-card">
    <h3>Google connection setup</h3>
    <ResourceState loading={resource.loading} error={resource.error} retry={() => void resource.reload()} />
  </section>;
  return (
    <section className="hub-card">
      <div className="hub-section-heading compact">
        <div>
          <h3>Google connection setup</h3>
          <p>
            Set up the company’s Google OAuth client once, then authorize
            Workspace.
          </p>
        </div>
        {resource.data && (
          <Badge tone={resource.data.configured ? "success" : "warning"}>
            {resource.data.configured
              ? "Client configured"
              : "Client not configured"}
          </Badge>
        )}
      </div>
      <ResourceState
        loading={resource.loading}
        error={resource.error}
        retry={() => void resource.reload()}
      />
      <p className="hub-notice"><span>Authorize the recruiting account <strong>{resource.data?.expectedSender || "shown after configuration loads"}</strong>. This account sends recruiting email and manages the connected Calendar and Drive. Choosing another account will not complete setup.</span></p>
      {resource.data?.hostingPlatform === "railway" && <p className="hub-muted">Your staff login and the recruiting connection are separate. Stay signed in to this dashboard as the owner, then choose the recruiting Google account when granting access. Workspace administrators still need that account’s authorization.</p>}
      <details className="hub-setup-details" open={!resource.data?.configured}>
        <summary>OAuth client setup instructions</summary>
        <ol>
          <li>
            Open{" "}
            <a
              href="https://console.cloud.google.com/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Google Cloud Console
            </a>{" "}
            with the company account and create or choose a project.
          </li>
          <li>Enable Gmail API, Google Calendar API, and Google Drive API.</li>
          <li>
            Configure the OAuth consent screen for the company’s internal
            Workspace application.
          </li>
          <li>
            Create a Web application OAuth client. Add this exact authorized
            redirect URI for the recruiting connection:{" "}
            <code>{redirectUri || "Loading redirect address…"}</code>
            {resource.data?.hostingPlatform === "railway" && <span> Also add the staff sign-in redirect: <code>{redirectUri.replace("/api/google/callback", "/api/auth/google/callback") || "Loading redirect address…"}</code>.</span>}
          </li>
          <li>
            {resource.data?.credentialsManaged ? "The client ID and secret are managed in Railway’s Variables. Update them there if needed, then reconnect Google Workspace here." : "Enter the client ID and client secret below, save, then connect Google Workspace. Secrets are encrypted on the server."}
          </li>
        </ol>
      </details>
      {!resource.loading && !resource.data?.credentialsManaged && <form onSubmit={save}>
        <fieldset disabled={mutation.busy}>
          <div className="hub-form-grid">
            <Field label="Google OAuth client ID">
              <input
                autoComplete="off"
                required
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
              />
            </Field>
            <Field label="Google OAuth client secret">
              <input
                type="password"
                autoComplete="new-password"
                required
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
              />
            </Field>
          </div>
          <button
            type="submit"
            className="hub-button secondary"
            disabled={mutation.busy}
          >
            {mutation.busy
              ? "Saving securely…"
              : "Save Google client configuration"}
          </button>
          <Feedback error={mutation.error} success={mutation.success} />
        </fieldset>
      </form>}
    </section>
  );
}
