"""Anonymous public reads only. Never reads bot credentials or opens a bot socket."""
import subprocess,json,pathlib,os
from urllib.parse import quote
URL='https://maincloud.spacetimedb.com/v1/database/scrabblebot/sql'
def query(sql):
 raw=subprocess.check_output(['curl','--fail-with-body','--silent','--show-error','--max-time','30','--data',sql,URL],text=True)
 return json.loads(raw)
def records(result):
 keys=[x['name']['some'] for x in result['schema']['elements']]
 return [dict(zip(keys,r)) for r in result['rows']]
if __name__=='__main__':
 config=json.loads(subprocess.check_output(['node','--import','tsx','lab/bot-context.ts','--cache'],text=True))
 bot=int(config['botId'])
 URL=config['host'].replace('wss://','https://',1).replace('ws://','http://',1)+'/v1/database/'+quote(config['database'],safe='')+'/sql'
 public=records(query(f'SELECT * FROM bot WHERE id = {bot}')[0])
 if len(public)!=1 or public[0]['name']!=config['name']:
  raise ValueError('Public bot identity differs from BOT_NAME/BOT_ID')
 subprocess.check_output(['node','--import','tsx','lab/bot-context.ts','--bind'],text=True)
 rows=records(query(f'SELECT match_state.* FROM match_state JOIN match_participant ON match_state.id = match_participant.match_id WHERE match_participant.bot_id = {bot}')[0])
 ended=sorted([r for r in rows if r['status'][0]==2],key=lambda r:r['ended_at'][1][0],reverse=True)[:30]
 store=pathlib.Path(config['dataDir']);store.mkdir(parents=True,exist_ok=True,mode=0o700)
 existing_file=store/'recent-public.json'
 old=config.get('cachedMatches',[])
 cached={s['match_state'][0]['id']:s for s in old}
 result=[]
 for m in ended:
  mid=m['id']
  if mid in cached:
   result.append(cached[mid]);continue
  tables=['match_participant','auction','auction_result','word_play','auction_top_bid_archive']
  data=[query(f'SELECT * FROM {t} WHERE match_id = {mid}')[0] for t in tables]
  result.append({'match_state':[m],**{t:records(r) for t,r in zip(tables,data)}})
 temp=existing_file.with_name(existing_file.name+f'.{os.getpid()}.tmp')
 try:
  temp.write_text(json.dumps({'schema':1,'botName':config['name'],'botId':str(bot),'venue':config['venue'],'matches':result},indent=2));temp.chmod(0o600);temp.replace(existing_file)
 finally:
  if temp.exists():temp.unlink()
 print(json.dumps({'botName':config['name'],'botId':str(bot),'matches':len(result),'scores':[next(p['score'] for p in s['match_participant'] if p['bot_id']==bot) for s in result],'ids':[s['match_state'][0]['id'] for s in result]}))
