export const BOT_PURPOSES = {
  "OAI-SearchBot": "search",
  PerplexityBot: "search",
  "Claude-SearchBot": "search",
  GPTBot: "training",
  ClaudeBot: "training",
  "Google-Extended": "training",
  "ChatGPT-User": "user_request",
  "Claude-User": "user_request",
} as const;

/** Most specific user-agent group wins; Allow wins an equal-length path match. */
export function robotsAllows(text: string, bot: string, path = "/") {
  const groups: Array<{
    agents: string[];
    rules: Array<{ allow: boolean; path: string }>;
  }> = [];
  let group = {
    agents: [] as string[],
    rules: [] as Array<{ allow: boolean; path: string }>,
  };
  let hasDirectives = false;
  for (const line of text.split(/\r?\n/)) {
    const [key, ...parts] = line.replace(/#.*$/, "").trim().split(":");
    const value = parts.join(":").trim();
    if (key?.toLowerCase() === "user-agent") {
      if (hasDirectives) {
        groups.push(group);
        group = { agents: [], rules: [] };
        hasDirectives = false;
      }
      group.agents.push(value.toLowerCase());
    } else if (
      group.agents.length &&
      ["allow", "disallow"].includes(key?.toLowerCase())
    ) {
      hasDirectives = true;
      if (value)
        group.rules.push({ allow: key.toLowerCase() === "allow", path: value });
    }
  }
  if (group.agents.length) groups.push(group);
  const matching = groups.map((g) => ({
    ...g,
    specificity: Math.max(
      -1,
      ...g.agents.map((a) =>
        a === "*" ? 0 : bot.toLowerCase().includes(a) ? a.length : -1,
      ),
    ),
  }));
  const max = Math.max(-1, ...matching.map((g) => g.specificity));
  if (max < 0) return true;
  const rules = matching
    .filter((g) => g.specificity === max)
    .flatMap((g) => g.rules)
    .filter((rule) => {
      const pattern = rule.path
        .replace(/[.+?^{}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*");
      return new RegExp(`^${pattern}`).test(path);
    })
    .sort(
      (a, b) =>
        b.path.replace(/\*/g, "").length - a.path.replace(/\*/g, "").length ||
        Number(b.allow) - Number(a.allow),
    );
  return rules[0]?.allow ?? true;
}
export function observeBotPolicy(robots: string | null, path = "/") {
  return Object.entries(BOT_PURPOSES).map(([bot, purpose]) => ({
    bot,
    purpose,
    allowed: robots === null ? null : robotsAllows(robots, bot, path),
  }));
}
