import { DatabaseSync } from "node:sqlite";
import { readdirSync,readFileSync } from "node:fs";
import { HubStore } from "../lib/hub/store";
export function customDatabase(){
  const database=new DatabaseSync(":memory:");
  const folder=new URL("../drizzle/",import.meta.url);
  for(const name of readdirSync(folder).filter(name=>/^\d+.*\.sql$/.test(name)).sort())database.exec(readFileSync(new URL(name,folder),"utf8"));
  const db={
    prepare(sql:string){
      const stmt=database.prepare(sql);let values:(string|number|null)[]=[];
      const prepared={bind(...args:(string|number|null)[]){values=args;return prepared;},
        runSync(){const result=stmt.run(...values);return {success:true,meta:{changes:Number(result.changes)}};},
        async run(){return prepared.runSync();},async first(){return stmt.get(...values)||null;},async all(){return {success:true,results:stmt.all(...values)};}};
      return prepared;
    },
    async batch(statements:{runSync():unknown}[]){database.exec("BEGIN");try{const result=statements.map(stmt=>stmt.runSync());database.exec("COMMIT");return result;}catch(error){database.exec("ROLLBACK");throw error;}}
  } as unknown as D1Database;
  return {database,db,store:new HubStore(db)};
}
export async function openSyntheticRole(store:HubStore){
  return store.saveJob({title:"Synthetic Full-stack Engineer",slug:"synthetic-full-stack-engineer",department:"Test",descriptionHtml:"<p>Isolated synthetic test only.</p>",status:"open",fields:[{path:"_systemfield_name",title:"Name",type:"String",required:true},{path:"_systemfield_email",title:"Email",type:"Email",required:true}],rules:[],autoReject:false,rejectionTemplate:"Thank you, {{name}}. We are not moving forward with your application.",assessmentPrompt:"Describe an approach to a synthetic test problem."});
}
