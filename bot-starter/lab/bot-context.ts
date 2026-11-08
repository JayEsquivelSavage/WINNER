/** Public configuration bridge for the Python collector. Never includes tokens. */
import {botContext,resolveBotId,saveBotIdentity,readPublicSnapshots} from '../src/bot-context.js';
const context=botContext(),botId=resolveBotId(context);
if(process.argv.includes('--bind'))saveBotIdentity(context,botId);
console.log(JSON.stringify({...context,botId,cachedMatches:process.argv.includes('--cache')?readPublicSnapshots(context):undefined}));
