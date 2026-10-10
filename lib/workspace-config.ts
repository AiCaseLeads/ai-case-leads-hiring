import { env } from "cloudflare:workers";
import { GoogleWorkspace, openToken } from "./google/workspace";
import { ArchiveStore } from "./archive/store";
import { HiringError } from "./hiring/errors";
import { readGoogleConfiguration,configurationFingerprint,coherentGoogleGrant } from "./google/config-state";
import { expectedRecruitingSender } from "./google/sender";

export type WorkspaceEnv={DB?:D1Database;BUCKET?:R2Bucket;GOOGLE_CLIENT_ID?:string;GOOGLE_CLIENT_SECRET?:string;GOOGLE_TOKEN_KEY?:string;HUB_SCHEDULER_SECRET?:string;APPLICATIONS_ENABLED?:string;PUBLIC_SITE_ORIGIN?:string;EXPECTED_RECRUITING_EMAIL?:string;GOOGLE_CLIENT_REVISION?:number;HOSTING_PLATFORM?:string;BACKGROUND_ENABLED?:string};
export function workspaceEnv():WorkspaceEnv {
  const bindings=env as unknown as WorkspaceEnv;
  return {...process.env,...bindings};
}
export async function resolvedWorkspaceEnv(bindings:WorkspaceEnv=workspaceEnv()):Promise<WorkspaceEnv>{
  if(!bindings.DB||!bindings.GOOGLE_TOKEN_KEY)return bindings;
  if(bindings.GOOGLE_CLIENT_REVISION!==undefined)return bindings;
  const snapshot=await readGoogleConfiguration(bindings.DB);
  const clientId=bindings.GOOGLE_CLIENT_ID||snapshot.clientId;
  const sealed=snapshot.clientSecret;
  const clientSecret=bindings.GOOGLE_CLIENT_SECRET||(typeof sealed==="string"?await openToken(sealed,bindings.GOOGLE_TOKEN_KEY):undefined);
  return {...bindings,GOOGLE_CLIENT_ID:typeof clientId==="string"?clientId:undefined,GOOGLE_CLIENT_SECRET:clientSecret,GOOGLE_CLIENT_REVISION:snapshot.revision};
}
export async function readSetting(db:D1Database,key:string):Promise<unknown>{
  const row=await db.prepare("SELECT value FROM hub_settings WHERE key=?").bind(key).first<{value:string}>();
  if(!row)return null;
  try{return JSON.parse(row.value);}catch{return row.value;}
}
export async function saveSetting(db:D1Database,key:string,value:unknown):Promise<void>{
  await db.prepare("INSERT INTO hub_settings (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(key,JSON.stringify(value),Date.now()).run();
}
export async function workspaceStatus(bindings:WorkspaceEnv=workspaceEnv()){
  const credentialsManaged=!!(bindings.GOOGLE_CLIENT_ID||bindings.GOOGLE_CLIENT_SECRET);
  bindings=await resolvedWorkspaceEnv(bindings);
  const configured=!!(bindings.GOOGLE_CLIENT_ID&&bindings.GOOGLE_CLIENT_SECRET&&bindings.GOOGLE_TOKEN_KEY);
  const db=bindings.DB;
  const sender=db?await readSetting(db,"google_sender"):null;
  const token=db?await readSetting(db,"google_refresh_token"):null;
  const calendarId=db?await readSetting(db,"google_calendar_id"):null;
  const driveRootId=db?await readSetting(db,"google_drive_root_id"):null;
  const expectedSender=expectedRecruitingSender(bindings);
  const revision=db?await readSetting(db,"google_client_revision"):null,grantRevision=db?await readSetting(db,"google_grant_revision"):null;
  const grantFingerprint=db?await readSetting(db,"google_grant_fingerprint"):null;
  const coherent=coherentGoogleGrant({revision:grantRevision,fingerprint:grantFingerprint},bindings.GOOGLE_CLIENT_REVISION??0,await configurationFingerprint(bindings))&&(revision??0)===(bindings.GOOGLE_CLIENT_REVISION??0);
  return {configured,connected:configured&&coherent&&typeof token==="string"&&typeof sender==="string"&&sender.toLowerCase()===expectedSender,expectedSender,sender:typeof sender==="string"?sender:null,calendarId:typeof calendarId==="string"?calendarId:null,driveRootId:typeof driveRootId==="string"?driveRootId:null,credentialsManaged,hostingPlatform:bindings.HOSTING_PLATFORM==="railway"?"railway":"sites",backgroundEnabled:bindings.HOSTING_PLATFORM==="railway"&&bindings.BACKGROUND_ENABLED!=="false"};
}
export async function workspaceClient(bindings:WorkspaceEnv=workspaceEnv()):Promise<GoogleWorkspace>{
  bindings=await resolvedWorkspaceEnv(bindings);
  const status=await workspaceStatus(bindings);
  if(!status.connected||!bindings.DB)throw new HiringError("google_not_connected",503,"Connect your recruiting Google Workspace account in Settings first.");
  const rows=await bindings.DB.prepare("SELECT key,value FROM hub_settings WHERE key IN ('google_client_revision','google_grant_revision','google_refresh_token','google_sender','google_grant_fingerprint')").all<{key:string;value:string}>();
  const grant=Object.fromEntries(rows.results.map(row=>[row.key,JSON.parse(row.value)]));
  if((grant.google_client_revision??0)!==bindings.GOOGLE_CLIENT_REVISION||!coherentGoogleGrant({revision:grant.google_grant_revision,fingerprint:grant.google_grant_fingerprint},bindings.GOOGLE_CLIENT_REVISION??0,await configurationFingerprint(bindings))||typeof grant.google_refresh_token!=="string"||grant.google_sender!==status.sender)throw new HiringError("google_not_connected",503,"Google configuration changed. Reconnect Workspace in Settings.");
  const refreshToken=await openToken(grant.google_refresh_token,bindings.GOOGLE_TOKEN_KEY!);
  return new GoogleWorkspace({clientId:bindings.GOOGLE_CLIENT_ID!,clientSecret:bindings.GOOGLE_CLIENT_SECRET!,refreshToken,sender:status.sender!,calendarId:status.calendarId||undefined,driveRootId:status.driveRootId||undefined,archiveState:new ArchiveStore(bindings.DB)});
}
