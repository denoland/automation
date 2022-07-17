// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.

// # Overview
//
// Automatically tags and releases the repo with a "version tag" when the version
// of the repo's crate or specified crate changes when merged to main. For example,
// say you have version 1.1.0 tagged and you merge in a commit to main that changes
// the version in Cargo.toml to 1.1.1... this would detect that and tag the repo
// with 1.1.1.
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
// deno run -A --no-check <url-to-this-module> <crate-name-goes-here>
// ```
//
// Flags:
// - `--publish` - Publishes all the unpublished crates in the repo to crates.io
// - `--skip-release` - Skips doing a GitHub release.
//
// # Example Use
//
// ```yml
// - name: Release on Version Change
//   env:
//     GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
//   if: |
//     github.repository == 'denoland/<REPO_NAME_GOES_HERE>' &&
//     github.ref == 'refs/heads/main'
//    run: deno run -A --no-check <url-to-this-module>
// ```

import { $, containsVersion, Repo } from "../mod.ts";
import { createOctoKit, getGitHubRepository } from "../github_actions.ts";

const cliArgs = getCliArgs();
const cwd = $.path.resolve(".");
const repoName = $.path.basename(cwd);
const repo = await Repo.load({
  name: repoName,
  path: cwd,
});

const octokit = createOctoKit();

// only run this for commits that contain a version number in the commit message
if (!containsVersion(await repo.gitCurrentCommitMessage())) {
  console.log("Exiting: No version found in commit name.");
  Deno.exit();
}

// safeguard for in case if someone doesn't run this on the main branch
if ((await repo.gitCurrentBranch()) !== "main") {
  console.log("Exiting: Not on main branch.");
  Deno.exit();
}

// now ensure this tag exists
const mainCrate = getMainCrate();
await repo.gitFetchTags("origin");
const repoTags = await repo.getGitTags();
const tagName = repoTags.getTagNameForVersion(mainCrate.version);
if (repoTags.has(tagName)) {
  console.log(`Tag ${tagName} already exists.`);
} else {
  if (cliArgs.publish) {
    $.logStep(`Publishing ${tagName}...`);
    for (const crate of repo.getCratesPublishOrder()) {
      await crate.publish();
    }
  }

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
  publish: boolean;
  release: boolean;
}

function getCliArgs() {
  // very basic arg parsing... should improve later
  const args: CliArgs = {
    publish: false,
    release: true,
    crate: undefined,
  };
  for (const arg of Deno.args) {
    if (arg === "--publish") {
      args.publish = true;
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
