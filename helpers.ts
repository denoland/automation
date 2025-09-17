// Copyright 2018-2025 the Deno authors. All rights reserved. MIT license.

import * as semver from "@std/semver";

export interface GitLogLine {
  rev: string;
  message: string;
}

export class GitLogOutput {
  lines: GitLogLine[];

  constructor(lines: GitLogLine[]) {
    this.lines = lines;
  }

  formatForReleaseMarkdown(): string {
    const IGNORED_COMMIT_PREFIX = [
      "bench",
      "build",
      "chore",
      "ci",
      "cleanup",
      "docs",
      "refactor",
      "test",
    ];
    return this.lines
      .filter((l) => {
        // don't include version commits
        if (/^v?[0-9]+\.[0-9]+\.[0-9]+/.test(l.message)) {
          return false;
        }

        return !IGNORED_COMMIT_PREFIX
          .some((prefix) => l.message.startsWith(prefix)) &&
          l.message.length > 0;
      })
      .map((line) => `- ${line.message}`)
      .sort()
      .join("\n");
  }
}

export class GitTags {
  #tags: string[];

  constructor(tags: string[]) {
    this.#tags = tags;
  }

  /** Gets the tags that are for a version. */
  getGitVersionTags(): { name: string; version: semver.SemVer }[] {
    const result: { name: string; version: semver.SemVer }[] = [];
    for (const name of this.#tags) {
      try {
        const version = semver.parse(name.replace(/^v/, ""));
        if (version != null) {
          result.push({
            name,
            version,
          });
        }
      } catch {
        // ignore parse errors
      }
    }
    return result;
  }

  /** Gets if the most recent version tag uses a `v` prefix. */
  usesVersionVPrefix(): boolean {
    const versionTags = this.getGitVersionTags();
    versionTags.sort((a, b) => semver.compare(a.version, b.version));
    const mostRecentTag = versionTags[versionTags.length - 1];
    return mostRecentTag?.name.startsWith("v") ?? false;
  }

  has(tagName: string): boolean {
    return this.#tags.includes(tagName);
  }

  getTagNameForVersion(version: string): string {
    version = version.replace(/^v/, "");
    return this.usesVersionVPrefix() ? `v${version}` : version;
  }

  getPreviousVersionTag(version: string): string | undefined {
    const v = semver.parse(version);
    if (v == null) {
      throw new Error(`Provided version was not a version: ${version}`);
    }
    let previousVersion;
    for (const tagInfo of this.getGitVersionTags()) {
      const isGtPrevious = previousVersion == null ||
        semver.compare(previousVersion.version, tagInfo.version) < 0;
      if (isGtPrevious && semver.compare(tagInfo.version, v) < 0) {
        previousVersion = tagInfo;
      }
    }
    return previousVersion?.name;
  }
}

export function containsVersion(text: string): boolean {
  return /[0-9]+\.[0-9]+\.[0-9]+/.test(text);
}
