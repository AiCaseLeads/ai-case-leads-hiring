export class HiringError extends Error {
  constructor(public code: string, public status: number, message: string, public fieldErrors?: Record<string, string>) {
    super(message);
    this.name = "HiringError";
  }
}

/** A write may have reached Ashby. Never automatically replay it. */
export class UncertainSubmissionError extends HiringError {
  constructor() { super("submission_pending", 202, "We are checking your submission. Please do not submit again."); }
}

export function configurationError(): HiringError {
  return new HiringError("applications_disabled", 503, "Applications are not open yet. Please check back soon.");
}
