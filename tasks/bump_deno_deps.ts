// Copyright 2018-2023 the Deno authors. All rights reserved. MIT license.

// # Overview
//
// Bumps the version of denoland crates, then opens a PR.
//
// # Example Use
//
// Create a workflow with the following steps:
// ```yml
// - name: Clone repository
//   uses: actions/checkout@v3
//   with:
//     token: ${{ secrets.DENOBOT_PAT }}
// - uses: denoland/setup-deno@v1
// - uses: dtolnay/rust-toolchain@stable
// - name: Bump dependencies
//   env:
//     GITHUB_TOKEN: ${{ secrets.DENOBOT_PAT }}
//     GH_WORKFLOW_ACTOR: ${{ github.actor }}
//   run: |
//     git config user.email "${{ github.actor }}@users.noreply.github.com"
//     git config user.name "${{ github.actor }}"
//     deno run -A <url-to-this-module>
// ```

import { $, Repo } from "../mod.ts";
import { createOctoKit, getGitHubRepository } from "../github_actions.ts";
import { CratesIoCache } from "../crates_io.ts";

const cwd = $.path.resolve(".");
const repoName = $.path.basename(cwd);
const repo = await Repo.load({
  name: repoName,
  path: cwd,
});

// update all the denoland dependency versions
const updates = new Set();
const cratesIo = new CratesIoCache();
$.logStep(`Bumping dependencies...`);
$.logGroup();
for (const crate of repo.crates) {
  for (const dep of crate.dependencies) {
    if (dep.req === "*") {
      continue; // skip, nothing to bump
    }

    if (await cratesIo.hasDenoLandOwner(dep.name)) {
      const latestVersion =
        (await cratesIo.getMetadata(dep.name))?.crate.max_stable_version;
      if (latestVersion == null) {
        throw new Error(`Could not find crate version for ${dep.name}`);
      }

      $.logStep(`Updating ${dep.name} from ${dep.req} to ${latestVersion}...`);
      await crate.setDependencyVersion(dep.name, latestVersion);
      updates.add(`${dep.name} ${latestVersion}`);
    }
  }
  await crate.cargoUpdate("--workspace");
}
$.logGroupEnd();

// todo(dsherret): ideally this would detect if the tasks exists and error on failure
$.logStep(`Attempting to run "deno task build" if exists...`);
try {
  await $`deno task build`;
} catch (err) {
  $.logWarn("Warning", "Either build task failed or it did not exist.", err);
}

$.logStep(`Committing...`);
const originalBranch = await repo.gitCurrentBranch();
const newBranchName = `chore_update_deps_${new Date().getTime()}`;
await repo.gitBranch(newBranchName);
await repo.gitAdd();
// do nothing if there is no changes
if (!await repo.hasLocalChanges()) {
  $.logWarn("Exiting", "Found no changes");
  Deno.exit(0);
}
const commitMessage = `chore: update ${Array.from(updates).sort().join(", ")}`;
await repo.gitCommit(commitMessage);

$.logStep("Pushing branch...");
await repo.gitPush("-u", "origin", "HEAD");

$.logStep("Opening PR...");
const octoKit = createOctoKit();
const openedPr = await octoKit.request("POST /repos/{owner}/{repo}/pulls", {
  ...getGitHubRepository(),
  base: originalBranch,
  head: newBranchName,
  draft: true,
  title: commitMessage,
  body: `Updated versions.`,
});
$.log(`Opened PR at ${openedPr.data.url}`);
