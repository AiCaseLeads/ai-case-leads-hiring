import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore,jobInput,applicationInput,MANAGER} from './fixtures';
import {privateDrivePreview} from '../../lib/hub/drive-preview';
import {sha256} from '../../lib/archive/security';
test('private Drive viewer only exposes a completed original attached to its verified application folder',async()=>{
 const {store,database,db}=createStore();try{
 const job=await store.saveJob(jobInput()),app=await store.acceptApplication(applicationInput(job.id));
 database.prepare("INSERT INTO hub_files(id,session_hash,job_id,field_path,filename,content_type,size,object_key,expires_at,uploaded_at,application_id) VALUES('original','test',?,'resume','Résumé.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document',10,'key',1,1,?)").run(job.id,app.id);
 const originalKey=await sha256(`hub:application:${app.id}:original:original`),folderKey=await sha256(`hub:application:${app.id}:job:${job.id}`);
 await assert.rejects(privateDrivePreview('original',null,db),{code:'staff_access_required'});
 await assert.rejects(privateDrivePreview('original',MANAGER,db),{code:'drive_preview_unavailable'});
 database.prepare('INSERT INTO archive_items(key,drive_id,parent_id,updated_at) VALUES(?,?,?,1)').run(folderKey,'candidate-folder','job-folder');
 database.prepare('INSERT INTO archive_items(key,drive_id,parent_id,content_hash,session_url,updated_at) VALUES(?,?,?,?,?,1)').run(originalKey,'private-original','candidate-folder','hash','pending-upload');
 await assert.rejects(privateDrivePreview('original',MANAGER,db),{code:'drive_preview_unavailable'});
 database.prepare('UPDATE archive_items SET session_url=NULL WHERE key=?').run(originalKey);
 await assert.rejects(privateDrivePreview('original',MANAGER,db),{code:'drive_preview_unavailable'});
 database.prepare("UPDATE hub_applications SET drive_folder_id='candidate-folder' WHERE id=?").run(app.id);
 const response=await privateDrivePreview('original',MANAGER,db);assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.deepEqual(await response.json(),{previewUrl:'https://drive.google.com/file/d/private-original/preview',webViewUrl:'https://drive.google.com/file/d/private-original/view'});
 database.prepare("UPDATE archive_items SET parent_id='other-app-folder' WHERE key=?").run(originalKey);
 await assert.rejects(privateDrivePreview('original',MANAGER,db),{code:'drive_preview_unavailable'});
 database.prepare("UPDATE archive_items SET parent_id='candidate-folder',content_hash=NULL WHERE key=?").run(originalKey);
 await assert.rejects(privateDrivePreview('original',MANAGER,db),{code:'drive_preview_unavailable'});
 await assert.rejects(privateDrivePreview('missing',MANAGER,db),{code:'drive_preview_unavailable'});
 }finally{database.close();}
});
