import type {HubMember} from './auth-core';
import {HiringError} from '../hiring/errors';
import {sha256} from '../archive/security';

/** Return a private Google viewer link, never an access token or public share grant. */
export async function privateDrivePreview(id:string,member:HubMember|null,db?:D1Database):Promise<Response>{
 if(!member?.email)throw new HiringError('staff_access_required',403,'Sign in with an authorized hiring account.');
 if(!db)throw new HiringError('storage_unavailable',503,'File storage is unavailable.');
 const file=await db.prepare('SELECT f.application_id,a.job_id,a.drive_folder_id FROM hub_files f JOIN hub_applications a ON a.id=f.application_id WHERE f.id=? AND f.uploaded_at>0').bind(id).first<{application_id:string;job_id:string;drive_folder_id:string|null}>();
 const unavailable=()=>new HiringError('drive_preview_unavailable',404,'The archived original is not ready. Download the original or use the local preview.');
 if(!file?.drive_folder_id)throw unavailable();
 const originalKey=await sha256(`hub:application:${file.application_id}:original:${id}`);
 const folderKey=await sha256(`hub:application:${file.application_id}:job:${file.job_id}`);
 const original=await db.prepare('SELECT drive_id,parent_id,content_hash,session_url FROM archive_items WHERE key=?').bind(originalKey).first<{drive_id:string;parent_id:string;content_hash:string|null;session_url:string|null}>();
 const folder=await db.prepare('SELECT drive_id FROM archive_items WHERE key=?').bind(folderKey).first<{drive_id:string}>();
 if(!original||!folder||folder.drive_id!==file.drive_folder_id||original.parent_id!==folder.drive_id||!original.content_hash||original.session_url||! /^[a-zA-Z0-9_-]{1,256}$/.test(original.drive_id))throw unavailable();
 return Response.json({previewUrl:`https://drive.google.com/file/d/${original.drive_id}/preview`,webViewUrl:`https://drive.google.com/file/d/${original.drive_id}/view`},{headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
}
