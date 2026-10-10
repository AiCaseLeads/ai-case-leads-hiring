import { HiringError } from "../hiring/errors";
export function expectedRecruitingSender(config: {EXPECTED_RECRUITING_EMAIL?:string} = {}) {
  const email=(config.EXPECTED_RECRUITING_EMAIL || "mariam@aicaseleads.com").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HiringError("invalid_recruiting_sender",503,"Check the configured recruiting account.");
  return email;
}
export function assertRecruitingSender(sender:string,config:{EXPECTED_RECRUITING_EMAIL?:string}={}){
 if(sender.trim().toLowerCase()!==expectedRecruitingSender(config))throw new HiringError("wrong_sender",422,"Connect the selected recruiting Google account.");
}

