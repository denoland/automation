// Copyright 2018-2023 the Deno authors. All rights reserved. MIT license.

import { Octokit } from "npm:octokit@^3.1";

export function getGitHubRepository(): { owner: string, repo: string } {
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

export function createOctoKit() {
  return new Octokit({
    auth: getGitHubToken(),
  });
}

export function getGitHubToken() {
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
