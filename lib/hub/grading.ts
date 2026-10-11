export type GradingScorecard = {
  id?: string;
  actor: string;
  score: number;
  criteria: string;
  text: string;
  createdAt: number;
};
/** A person's latest overall review counts once. Missing reviews have no score. */
export function gradeForScorecards(cards: readonly GradingScorecard[]) {
  const latest = new Map<string, GradingScorecard>();
  let scorecardCount = 0;
  for (const card of cards) {
    if (!card.actor || !Number.isFinite(card.createdAt) || !Number.isFinite(card.score) || card.score < 1 || card.score > 5) continue;
    scorecardCount++;
    const actor = card.actor.trim().toLowerCase();
    if (!actor) continue;
    const previous = latest.get(actor);
    if (!previous || card.createdAt > previous.createdAt || (card.createdAt === previous.createdAt && (card.id || "") > (previous.id || ""))) latest.set(actor, {...card, actor});
  }
  const latestReviews = [...latest.values()].sort((a, b) => a.actor.localeCompare(b.actor)).map(({actor, score, criteria, text, createdAt}) => ({actor, score, criteria, text, createdAt}));
  const reviewerCount = latestReviews.length;
  const raw = reviewerCount ? latestReviews.reduce((sum, card) => sum + card.score, 0) / reviewerCount : null;
  // Preserve the raw mean for stable comparisons; round only at presentation.
  return {reviewed: reviewerCount > 0, averageScore: raw, scorePercent: raw === null ? null : raw * 20, reviewerCount, scorecardCount, latestReviews};
}

