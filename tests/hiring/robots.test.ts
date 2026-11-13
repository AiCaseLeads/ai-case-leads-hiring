import test from "node:test";
import assert from "node:assert/strict";
import { GET } from "../../app/robots.txt/route";

test("robots asks identified AI crawlers not to crawl while allowing Google search", async () => {
  const response = GET();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") || "", /^text\/plain/);
  const body = await response.text();
  const groups = body.trim().split(/\n\s*\n/).map(group => ({
    agents: [...group.matchAll(/^User-agent:\s*(.+)$/gim)].map(match => match[1]),
    allow: /^Allow:\s*\/\s*$/im.test(group),
    disallow: /^Disallow:\s*\/\s*$/im.test(group),
  }));
  assert.ok(groups.some(group => group.agents.includes("*") && group.allow && !group.disallow));
  assert.ok(!groups.some(group => group.agents.some(agent => agent.toLowerCase() === "googlebot") && group.disallow));
  for (const agent of ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-SearchBot", "Claude-User", "PerplexityBot", "Perplexity-User", "Google-Extended", "Applebot-Extended", "Meta-ExternalAgent", "Amazonbot", "Amzn-SearchBot", "CCBot"]) {
    assert.ok(groups.some(group => group.agents.includes(agent) && group.disallow), `${agent} must be disallowed`);
  }
});
