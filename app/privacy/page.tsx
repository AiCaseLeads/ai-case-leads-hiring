import { PageChrome } from "@/components/careers/chrome";
export default function PrivacyPage() {
  return (
    <PageChrome>
      <main id="main" className="site-width privacy-page">
        <a className="back-link" href="/">
          Careers home
        </a>
        <p className="eyebrow dark">APPLICANT INFORMATION</p>
        <h1>
          Your application.
          <br />
          Handled with care.
        </h1>
        <div className="privacy-copy">
          <h2>What you share</h2>
          <p>
            Application forms collect the information
            shown on each form, such as your name, contact details, resume,
            portfolio, and responses to job-specific questions. Application
            source information may also be recorded. Help and privacy request forms
            also store your email address, optional job title, request type, and message.
          </p>
          <h2>How it is used</h2>
          <p>
            AI Case Leads uses this information to review applications,
            communicate with candidates, coordinate assessments and interviews,
            and maintain hiring records. Approved application rules may
            determine eligibility. Reviewers can see the application answers
            supporting each rule result and make hiring decisions.
          </p>
          <h2>Where it is stored</h2>
          <p>
            Hiring records are stored in AI Case Leads’ hiring system.
            Original documents are stored privately with the application.
            When the company’s Google connection is enabled, application documents
            and hiring-history exports are also archived in a company-controlled
            Google Drive location. Authorized recruiting
            staff and managers can access hiring records.
          </p>
          <h2>Optional AI-assisted review</h2>
          <p>
            If enabled for a job by the hiring team, relevant application answers
            and résumé text are sent to OpenRouter and OpenAI to compare evidence
            with that job’s requirements. This may run automatically and produce
            a job-match evidence score used to order applications for human review.
            Reviewers can also request evidence summaries and follow-up questions.
            Scores are not hiring decisions or predictions of success. Missing
            evidence may need clarification; AI matching does not automatically
            reject applications or determine whether text was written with AI.
            Results become part of the hiring record. Contact us to correct
            information or discuss how your information is used.
          </p>
          <h2>Questions about your information</h2>
          <p>
            Recruiting emails are sent from an automated no-reply address. Replies
            are not accepted. Requests to correct information, withdraw an
            application, or remove your information must be made through this
            hiring website. Use our <a href="/help">application help and privacy request form</a>.
          </p>
          <p>Open help requests are kept until handled. Resolved help requests become eligible for removal after 90 days and are removed in bounded batches when staff open the request queue. This cleanup does not delete applications.</p>
          <p className="privacy-note">
            Closing a job or creating another job posting does not delete earlier
            applications. Access is restricted to authorized hiring staff.
          </p>
        </div>
      </main>
    </PageChrome>
  );
}
