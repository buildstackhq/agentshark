#!/usr/bin/env -S tsx
// Re-validates DCO sign-off (https://developercertificate.org/) against every
// commit in a range, mirroring scripts/hooks/commit-msg. CI-only backstop for
// the local hook, which can be bypassed with --no-verify or a GitHub UI edit.

import { execFileSync } from "node:child_process";

const SIGNED_OFF_BY = /^Signed-off-by: .+ <.+>$/m;

// Scoped to the semantic-release bot's committer identity, not just the
// subject line, so a human can't dodge sign-off by typing "chore(release): ...".
const RELEASE_BOT_EMAIL = "41898282+github-actions[bot]@users.noreply.github.com";

const range = process.argv[2];
if (!range) {
  console.error("usage: check-dco.ts <git-range>  (e.g. origin/main..HEAD)");
  process.exit(2);
}

const log = execFileSync("git", ["log", "--format=%H%x1f%s%x1f%ce%x1f%B%x1e", range], {
  encoding: "utf8",
});

const commits = log
  .split("\x1e")
  .filter((entry) => entry.trim().length > 0)
  .map((entry) => {
    const [sha, subject, committerEmail, body] = entry.replace(/^\n/, "").split("\x1f");
    return { sha, subject, committerEmail, body };
  });

let failed = false;

for (const { sha, subject, committerEmail, body } of commits) {
  if (/^Merge/.test(subject)) continue;
  if (/^chore\(release\):/.test(subject) && committerEmail === RELEASE_BOT_EMAIL) continue;
  if (!SIGNED_OFF_BY.test(body)) {
    console.error(`✗ ${sha.slice(0, 7)}: "${subject}" is missing a DCO sign-off`);
    failed = true;
  }
}

if (failed) {
  console.error("");
  console.error("expected a trailer: Signed-off-by: Name <email>");
  console.error("fix: commit with -s, e.g. `git commit -s -m \"...\"`");
  console.error("see: https://developercertificate.org/");
  process.exit(1);
}

console.log(`✓ ${commits.length} commit(s) have a valid DCO sign-off`);
