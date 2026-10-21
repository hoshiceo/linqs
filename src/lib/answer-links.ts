// Only known documentation links become clickable. Arbitrary model-supplied
// destinations (including links in old answers) must not transmit class data.
const documentationHosts = new Set([
  "learn.microsoft.com", "support.microsoft.com", "ai.google.dev",
  "developers.google.com", "support.google.com", "docs.python.org",
  "developer.mozilla.org", "platform.openai.com", "help.openai.com",
  "react.dev", "nextjs.org", "supabase.com", "docs.netlify.com",
]);

export function safeAnswerHref(href: string | undefined) {
  if (!href) return undefined;
  try {
    const url = new URL(href);
    if (url.protocol !== "https:" || !documentationHosts.has(url.hostname) || url.username || url.password || url.port || url.search) return undefined;
    return url.href;
  } catch { return undefined; }
}
