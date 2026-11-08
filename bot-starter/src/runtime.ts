/** Queries are scoped before rows cross the network or enter the SDK cache. */
export function discoveryQueries(botId: bigint, after = 0n): string[] {
  return [
    `SELECT match_state.* FROM match_state JOIN match_participant ON match_state.id = match_participant.match_id WHERE match_participant.bot_id = ${botId} AND match_state.id >= ${after}`,
  ];
}
export function matchQueries(matchId: bigint, botId: bigint): string[] {
  return [
    `SELECT * FROM match_participant WHERE match_id = ${matchId}`,
    `SELECT * FROM auction WHERE match_id = ${matchId}`,
    `SELECT * FROM auction_result WHERE match_id = ${matchId}`,
    `SELECT * FROM word_play WHERE match_id = ${matchId}`,
    `SELECT * FROM my_rack WHERE match_id = ${matchId}`,
  ];
}
export function auctionQueries(auctionId: bigint): string[] {
  return [`SELECT * FROM auction WHERE id = ${auctionId}`, `SELECT * FROM auction_result WHERE auction_id = ${auctionId}`];
}
