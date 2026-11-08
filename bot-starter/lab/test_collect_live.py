"""Exercise the actual collector with a local curl fixture; never uses network."""
import json, os, pathlib, subprocess, tempfile, unittest
REPO=pathlib.Path(__file__).resolve().parent.parent
class CollectorTests(unittest.TestCase):
 def run_collector(self, public_name='winner', cached_venue=None):
  with tempfile.TemporaryDirectory(prefix='winner-collector-') as root:
   root=pathlib.Path(root);bindir=root/'bin';bindir.mkdir();log=root/'queries.jsonl';data=root/'data'
   if cached_venue:
    data.mkdir();(data/'recent-public.json').write_text(json.dumps({'schema':1,'botName':'winner','botId':'307','venue':cached_venue,'matches':[{'match_state':[{'id':1}]}]}))
   stub=bindir/'curl'
   stub.write_text('''#!/usr/bin/env python3
import sys,json,os
sql=sys.argv[sys.argv.index('--data')+1]
with open(os.environ['FIXTURE_LOG'],'a') as out:out.write(json.dumps(sql)+'\\n')
names=['id','name'] if sql.startswith('SELECT * FROM bot WHERE') else []
rows=[[307,os.environ['FIXTURE_NAME']]] if names else []
print(json.dumps([{'schema':{'elements':[{'name':{'some':n}} for n in names]},'rows':rows}]))
''');stub.chmod(0o700)
   env={**os.environ,'PATH':str(bindir)+os.pathsep+os.environ['PATH'],'BOT_NAME':'winner','BOT_ID':'307','WORDGOAT_DATA_DIR':str(data),'STDB_HOST':'https://maincloud.spacetimedb.com','STDB_DB':'scrabblebot','FIXTURE_LOG':str(log),'FIXTURE_NAME':public_name}
   result=subprocess.run(['python3','lab/collect-live.py'],cwd=REPO,env=env,text=True,capture_output=True)
   queries=[json.loads(x) for x in log.read_text().splitlines()] if log.exists() else []
   return result,queries,json.loads((data/'recent-public.json').read_text()) if (data/'recent-public.json').exists() else None
 def test_fresh_winner_collects_zero_games_for_id307(self):
  result,queries,snapshot=self.run_collector()
  self.assertEqual(result.returncode,0,result.stderr);self.assertEqual(snapshot['matches'],[]);self.assertEqual(snapshot['botId'],'307');self.assertEqual(snapshot['venue'],'https://maincloud.spacetimedb.com/scrabblebot')
  self.assertTrue(any('bot_id = 307' in q for q in queries));self.assertFalse(any('bot_id = 175' in q for q in queries))
 def test_mismatched_public_identity_is_rejected(self):
  result,queries,snapshot=self.run_collector('WORDGOAT')
  self.assertNotEqual(result.returncode,0);self.assertIsNone(snapshot)
  self.assertIn('identity',result.stderr.lower())
 def test_cache_from_another_venue_is_rejected_even_if_match_ids_collide(self):
  result,queries,snapshot=self.run_collector(cached_venue='https://other.example/scrabblebot')
  self.assertNotEqual(result.returncode,0);self.assertIn('provenance',result.stderr.lower())
  self.assertEqual(snapshot['venue'],'https://other.example/scrabblebot')
if __name__=='__main__':unittest.main()
