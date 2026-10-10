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
            When applications open, application forms collect the information
            shown on each form, such as your name, contact details, resume,
            portfolio, and responses to job-specific questions. Application
            source information may also be recorded.
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
          <h2>Questions about your information</h2>
          <p>
            Email <a href="mailto:mariam@aicaseleads.com">mariam@aicaseleads.com</a>
            {" "}for questions about your application information, to correct
            information, withdraw an application, or request removal of your
            information. The recruiting team handles these requests.
          </p>
          <p className="privacy-note">
            Applications remain closed while recruiting setup and the company’s
            final applicant privacy notice are being completed.
          </p>
        </div>
      </main>
    </PageChrome>
  );
}
