// Copyright 2018-2025 the Deno authors. All rights reserved. MIT license.

import { Octokit } from "octokit";

export function getGitHubRepository(): { owner: string; repo: string } {
  const repoEnvVar = getEnvVarOrThrow("GITHUB_REPOSITORY");
  const [owner, repo] = repoEnvVar.split("/");
  if (repo === undefined) {
    throw new Error(
      `Environment variable GITHUB_REPOSITORY ` +
        `must be formatted as "{owner}/{repo}".`,
    );
  }
  return {
    owner,
    repo,
  };
}

export function createOctoKit(): Octokit {
  return new Octokit({
    auth: getGitHubToken(),
  });
}

export function getGitHubToken(): string {
  return getEnvVarOrThrow("GITHUB_TOKEN");
}

function getEnvVarOrThrow(name: string) {
  const value = Deno.env.get(name);
  if (value == null) {
    throw new Error(
      `Could not find environment variable ${name}. ` +
        `Ensure you are running in a GitHub action.`,
    );
  }
  return value;
}
