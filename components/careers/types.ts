export type CareerJob = {
  eligibleCountries?: string[] | "worldwide";
  id: string;
  slug: string;
  title: string;
  department: string;
  descriptionHtml?: string;
  location?: string;
  employmentType?: string;
};
export type CareerField = {
  path: string;
  title: string;
  type: string;
  required: boolean;
  description?: string;
  minWords?: number;
  numberFormat?: "number" | "currency";
  currency?: "USD";
  options?: { value: string; label: string }[];
};
export type JobsResponse = {
  jobs: CareerJob[];
  mode: string;
  submissionEnabled: boolean;
};
export type JobResponse = {
  formVersion?: number;
  job: CareerJob;
  fields: CareerField[];
  submissionEnabled: boolean;
  mode?: string;
  formUnavailable?: string;
};
