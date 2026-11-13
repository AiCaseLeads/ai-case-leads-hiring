// These preferences apply to cooperating crawlers, not to visitors or
// scrapers that disregard robots.txt. Keep conventional search unblocked.
const robots = `User-agent: *
Allow: /

User-agent: GPTBot
User-agent: OAI-SearchBot
User-agent: ChatGPT-User
User-agent: ClaudeBot
User-agent: Claude-SearchBot
User-agent: Claude-User
User-agent: PerplexityBot
User-agent: Perplexity-User
User-agent: Google-Extended
User-agent: CCBot
Disallow: /
`;

export function GET() {
  return new Response(robots, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
