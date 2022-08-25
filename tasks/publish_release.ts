// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.

// # Overview
//
// Bumps the version, tags, and releases the repo.
//
// Note: this will detect whether to add a `v` prefix or not based on the most recent
// version tag.
//
// # CLI Arguments
//
// If you have multiple crates, then you will need to provide the crate name
// to use to determine the tag name as an argument to the script.
//
// ```bash
// deno run -A --no-check <url-to-this-module> --minor <crate-name-goes-here>
// ```
//
// Flags:
// - `--major` - Do a major release
// - `--minor` - Do a minor release
// - `--patch` - Do a patch release
// - `--skip-release` - Skips doing a GitHub release.
//
// # Example Use
//
// Add some inputs to the workflow:
// ```yml
// on:
//   workflow_dispatch:
//     inputs:
//       releaseKind:
//         description: 'Kind of release'
//         default: 'minor'
//         type: choice
//         options:
//         - patch
//         - minor
//         - major
//         required: true
// ```
//
// Then in your steps:
// ```yml
// - name: Clone repository
//   uses: actions/checkout@v3
//   with:
//     token: ${{ secrets.DENOBOT_PAT }}
// - uses: denoland/setup-deno@v1
// - uses: dtolnay/rust-toolchain@stable
// - name: Release on Version Change
//   env:
//     GITHUB_TOKEN: ${{ secrets.DENOBOT_PAT }} # ensure this account is excluded from pushing to main
//     GH_WORKFLOW_ACTOR: ${{ github.actor }}
//   run: |
//     git config user.email "${{ github.actor }}@users.noreply.github.com"
//     git config user.name "${{ github.actor }}"
//     deno run -A <url-to-this-module> --${{github.event.inputs.releaseKind}}
// ```

import { $, Repo } from "../mod.ts";
import { createOctoKit, getGitHubRepository } from "../github_actions.ts";

const cliArgs = getCliArgs();
const cwd = $.path.resolve(".");
const repoName = $.path.basename(cwd);
const repo = await Repo.load({
  name: repoName,
  path: cwd,
});

const octokit = createOctoKit();

// safeguard for in case if someone doesn't run this on the main branch
if ((await repo.gitCurrentBranch()) !== "main") {
  console.log("Exiting: Not on main branch.");
  Deno.exit();
}

// bump the versions
for (const crate of repo.crates) {
  if (crate.version === "0.0.0") {
    continue; // skip
  }
  await crate.increment(cliArgs.kind);
}

// run a cargo check on everything in order to update the lockfiles
for (const crate of repo.crates) {
  await crate.cargoCheck();
}

// now get the tag name to use based on the previous tags
const mainCrate = getMainCrate();
await repo.gitFetchTags("origin");
const repoTags = await repo.getGitTags();
const tagName = repoTags.getTagNameForVersion(mainCrate.version);

$.logStep(`Committing...`);
await repo.gitAdd();
await repo.gitCommit(tagName);

$.logStep("Pushing to main...");
await repo.gitPush("-u", "origin", "HEAD");

$.logStep(`Tagging ${tagName}...`);
await repo.gitTag(tagName);
await repo.gitPush("origin", tagName);

if (cliArgs.release) {
  $.logStep("Creating release...");
  const previousTag = repoTags.getPreviousVersionTag(mainCrate.version);
  const gitLog = await repo.getGitLogFromTags("origin", previousTag, tagName);
  await octokit.request(`POST /repos/{owner}/{repo}/releases`, {
    ...getGitHubRepository(),
    tag_name: tagName,
    name: tagName,
    body: gitLog.formatForReleaseMarkdown(),
    draft: false,
  });
}

/** Gets the crate to pull the version from. */
function getMainCrate() {
  if (repo.crates.length === 1) {
    return repo.crates[0];
  } else if (cliArgs.crate != null) {
    return repo.getCrate(cliArgs.crate);
  } else {
    throw new Error(
      `You must supply a crate name CLI argument.\n${repo.crateNamesText()}`,
    );
  }
}

interface CliArgs {
  crate: string | undefined;
  kind: "major" | "minor" | "patch";
  release: boolean;
}

function getCliArgs() {
  // very basic arg parsing... should improve later
  const args: CliArgs = {
    kind: "patch",
    release: true,
    crate: undefined,
  };
  for (const arg of Deno.args) {
    if (arg === "--major") {
      args.kind = "major";
    } else if (arg === "--minor") {
      args.kind = "minor";
    } else if (arg === "--patch") {
      args.kind = "patch";
    } else if (arg === "--skip-release") {
      args.release = false;
    } else if (arg.startsWith("--")) {
      throw new Error(`Invalid argument: ${arg}`);
    } else if (args.crate == null) {
      args.crate = arg;
    } else {
      throw new Error(`Invalid arguments: ${Deno.args.join(" ")}`);
    }
  }
  return args;
}
