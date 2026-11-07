import importlib.util,json,pathlib,tempfile,types,unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('deploy',str(pathlib.Path(__file__).resolve().parents[2] / 'scripts/aws/deploy-hiring.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Tests(unittest.TestCase):
 def checkcase(self,fail=None):
  sha='a'*40; old='b'*64; new='c'*64; imageid='sha256:'+'d'*64
  state={old:{'name':'hiring','running':True}}; calls=[]
  def inspect(cid):
   cid=next((i for i,v in state.items() if v['name']==cid),cid)
   return {'Id':cid,'Name':'/'+state[cid]['name'],'Image':imageid if cid==new else 'oldimage','Mounts':[{'Source':'/data','Destination':'/data','RW':True}], 'NetworkSettings':{'Networks':{'hiring':{'Aliases':['hiring',old[:12]]}}},'HostConfig':{'RestartPolicy':{'Name':'unless-stopped'},'Privileged':False,'PortBindings':{}}}
  failed=False
  def run(*a,capture=False):
   nonlocal failed
   calls.append(a)
   if a[:2]==('docker','inspect'):return json.dumps([inspect(a[2])])
   if a[:3]==('docker','image','inspect'):
    if '--format' in a:return 'arm64'
    return json.dumps([{'Architecture':'arm64','Id':imageid,'Config':{'Labels':{'org.opencontainers.image.revision':sha}},'RepoDigests':[m.REGISTRY+'/hiring@sha256:'+'e'*64]}])
   if a[:2]==('docker','pull'):return
   if a[:2]==('docker','exec'):
    if fail=='backup':raise RuntimeError('backup')
    return
   if a[:2]==('docker','create'):state[new]={'name':a[a.index('--name')+1],'running':False};return new
   if a[:2]==('docker','stop'):
    state[a[-1]]['running']=False
    if fail=='stop' and not failed:failed=True;raise RuntimeError('stop')
    return
   if a[:2]==('docker','rename'):
    cid=a[2]
    if fail=='rename' and not failed:failed=True;raise RuntimeError('rename')
    if state[cid]['name']==a[3]:raise RuntimeError('same name')
    state[cid]['name']=a[3];return
   if a[:2]==('docker','start'):
    cid=next((i for i,v in state.items() if v['name']==a[2]),a[2]);state[cid]['running']=True;return
   raise AssertionError(a)
  def subrun(a,**kw):
   if a[:3]==['docker','rm','-f']:
    state.pop(a[3],None);return types.SimpleNamespace(returncode=0)
   return types.SimpleNamespace(returncode=1 if fail=='health' else 0)
  class Login:
   stdout=types.SimpleNamespace(close=lambda:None)
   def wait(self,**kw):return 0
  class Resp:
   status=200
   def __enter__(self):return self
   def __exit__(self,*a):pass
   def read(self):return b'{"status":"ready"}'
  realstat=pathlib.Path.stat
  def stat(p,*a,**kw):
   if p.name=='hiring.env':return types.SimpleNamespace(st_mode=0o100600,st_uid=0)
   return realstat(p,*a,**kw)
  ticks=iter(range(0,10000,30))
  with tempfile.TemporaryDirectory() as tmp,patch.object(m,'BASE',pathlib.Path(tmp)),patch.object(m,'run',run),patch.object(m.os,'geteuid',return_value=0),patch.object(m.sys,'argv',['x',sha]),patch.object(pathlib.Path,'is_file',return_value=True),patch.object(pathlib.Path,'is_symlink',return_value=False),patch.object(pathlib.Path,'stat',stat),patch.object(m.subprocess,'Popen',return_value=Login()),patch.object(m.subprocess,'run',subrun),patch.object(m.urllib.request,'urlopen',return_value=Resp()),patch.object(m.time,'sleep'),patch.object(m.time,'monotonic',side_effect=lambda:next(ticks)):
   if fail:
    with self.assertRaises(Exception):m.main()
   else:m.main()
  if fail:self.assertTrue(state[old]['running']);self.assertEqual(state[old]['name'],'hiring')
  else:self.assertTrue(state[new]['running']);self.assertEqual(state[new]['name'],'hiring');self.assertFalse(state[old]['running'])
  self.assertFalse(any(a[:3]==('docker','rm','-v') for a in calls))
 def test_healthy(self):self.checkcase()
 def test_backup_failure(self):self.checkcase('backup')
 def test_health_failure(self):self.checkcase('health')
 def test_stop_failure(self):self.checkcase('stop')
 def test_rename_failure(self):self.checkcase('rename')
if __name__=='__main__':unittest.main()
