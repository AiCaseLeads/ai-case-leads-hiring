export function applicationReceipt(name: string, jobTitle: string, alreadyDecided = false): string {
  return [
    `Hi ${name},`,
    `Thank you for applying for ${jobTitle} at AI Case Leads. Your application has been received successfully.`,
    alreadyDecided
      ? "You will receive a separate email with the outcome of your application."
      : "Your application is now awaiting review by our hiring team. We will email you within 3–5 business days to let you know whether we are moving forward with your application or have decided to go in a different direction.",
    "If we move forward, we will include the next steps. You do not need to submit another application.",
    "This is an automated acknowledgment; no reply is needed.",
    "AI Case Leads Hiring Team",
  ].join("\n\n");
}
