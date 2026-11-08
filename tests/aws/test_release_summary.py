import importlib.util,json,pathlib,unittest,subprocess,sys,tempfile,os
spec=importlib.util.spec_from_file_location('summary',str(pathlib.Path(__file__).resolve().parents[2]/'scripts/aws/summarize-release.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Tests(unittest.TestCase):
 def invocation(self):
  self.sha='a'*40
  report={'schemaVersion':1,'storageReady':True,'backgroundReady':True,'backgroundEnabled':True,'cacheSchemaReady':True,'private':'PRIVATE EMAIL','fileTextBackfill':{'totalFiles':2,'undiscovered':0,'pending':1,'running':0,'ready':1,'partial':0,'failed':0,'state':'in_progress','private':'PRIVATE RESUME'}}
  return {'Status':'Success','StandardOutputContent':'PRIVATE DOCKER LOG\n'+json.dumps({'status':'deployed','sha':self.sha,'verification':report,'private':'PRIVATE TOKEN'}),'StandardErrorContent':'PRIVATE ERROR'}
 def test_safe_aggregates_only(self):
  safe,markdown=m.summarize(self.invocation(),self.sha)
  self.assertEqual(safe['fileTextBackfill']['state'],'in_progress');self.assertNotIn('PRIVATE',json.dumps(safe)+markdown);self.assertIn('Pending',markdown)
 def test_wrong_revision_missing_report_and_raw_output_rejected(self):
  for mode in ['revision','missing','failed','not_json']:
   invocation=self.invocation()
   if mode=='revision':self.sha='b'*40
   if mode=='missing':invocation['StandardOutputContent']=json.dumps({'status':'deployed','sha':self.sha})
   if mode=='failed':invocation['Status']='Failed'
   if mode=='not_json':invocation['StandardOutputContent']='PRIVATE ERROR'
   with self.assertRaises(ValueError):m.summarize(invocation,self.sha)
 def test_injected_counts_and_inconsistent_state_rejected(self):
  for key,value in [('pending','PRIVATE'),('ready',True),('totalFiles',9),('state','complete')]:
   invocation=self.invocation();release=json.loads(invocation['StandardOutputContent'].splitlines()[-1]);release['verification']['fileTextBackfill'][key]=value;invocation['StandardOutputContent']=json.dumps(release)
   with self.assertRaises(ValueError):m.summarize(invocation,self.sha)
 def test_cli_emits_only_sanitized_report_and_fixed_failure(self):
  with tempfile.TemporaryDirectory() as directory:
   source=pathlib.Path(directory)/'input.json';summary=pathlib.Path(directory)/'summary.md'
   source.write_text(json.dumps(self.invocation()))
   result=subprocess.run([sys.executable,str(pathlib.Path(m.__file__)),str(source),self.sha],capture_output=True,text=True,env={**os.environ,'GITHUB_STEP_SUMMARY':str(summary)})
   self.assertEqual(result.returncode,0);self.assertNotIn('PRIVATE',result.stdout+result.stderr+summary.read_text())
   source.write_text('PRIVATE TOKEN')
   result=subprocess.run([sys.executable,str(pathlib.Path(m.__file__)),str(source),self.sha],capture_output=True,text=True)
   self.assertNotEqual(result.returncode,0);self.assertNotIn('PRIVATE',result.stdout+result.stderr);self.assertIn('No raw SSM output',result.stderr)
if __name__=='__main__':unittest.main()
