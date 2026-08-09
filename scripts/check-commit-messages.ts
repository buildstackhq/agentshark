#!/usr/bin/env -S tsx
// Re-validates Conventional Commits (https://www.conventionalcommits.org/en/v1.0.0/)
// against every commit in a range, mirroring scripts/hooks/commit-msg.
// CI-only backstop for the local hook, which can be bypassed with --no-verify.

import { execFileSync } from "node:child_process";

// Keep in sync with scripts/hooks/commit-msg's `pattern`.
const CONVENTIONAL_COMMIT = /^(build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(\([a-zA-Z0-9_-]+\))?!?: .+/;

const range = process.argv[2];
if (!range) {
  console.error("usage: check-commit-messages.ts <git-range>  (e.g. origin/main..HEAD)");
  process.exit(2);
}

const log = execFileSync("git", ["log", "--format=%H%x1f%s", range], {
  encoding: "utf8",
});

const commits = log
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const [sha, subject] = line.split("\x1f");
    return { sha, subject };
  });

let failed = false;

for (const { sha, subject } of commits) {
  if (/^Merge/.test(subject)) continue;
  if (!CONVENTIONAL_COMMIT.test(subject)) {
    console.error(`✗ ${sha.slice(0, 7)}: "${subject}" does not follow Conventional Commits`);
    failed = true;
  }
}

if (failed) {
  console.error("");
  console.error("expected: <type>(<optional scope>)!: <description>");
  console.error("types:    build, chore, ci, docs, feat, fix, perf, refactor, revert, style, test");
  console.error("see:      https://www.conventionalcommits.org/en/v1.0.0/");
  process.exit(1);
}

console.log(`✓ ${commits.length} commit message(s) follow Conventional Commits`);
