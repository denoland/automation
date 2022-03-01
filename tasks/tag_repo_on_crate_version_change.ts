// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.

// # Overview
//
// Automatically tags the repo with a "version tag" when the version of the repo's
// crate or specified crate changes when merged to main. For example, say you have
// version 1.1.0 tagged and you merge in a commit to main that changes the version in
// Cargo.toml to 1.1.1... this would detect that and tag the repo with 1.1.1.
//
// Note: this will detect whether to add a `v` prefix or not based on what the
// repo mostly does.
//
// # Example Use
//
// ```yml
// - name: Tag Version on Change
//   if: |
//     github.repository == 'denoland/<REPO_NAME_GOES_HERE>' &&
//     github.ref == 'refs/heads/main'
//    run: deno run --allow-read --allow-run=cargo,git <url-to-this-module>
// ```
//
// If you have multiple crates, then you will need to provide the crate name
// to use to determine the tag name as an argument to the script.
//
// ```bash
// deno run --allow-read --allow-run=cargo,git <url-to-this-module> <crate-name-goes-here>
// ```

import { path, Repo } from "../mod.ts";

const cwd = path.resolve(".");
const repoName = path.basename(cwd);
const repo = await Repo.load(repoName, cwd);

// safeguard for in case if someone doesn't run this on the main branch
await repo.assertCurrentBranch("main");

// now ensure this tag exists
const tagInfo = await getMainCrate().getVersionTagInfo();
if (tagInfo.exists) {
  console.log(`Tag ${tagInfo.name} already exists.`);
} else {
  console.log(`Tagging ${tagInfo.name}...`);
  await repo.gitTag(tagInfo.name);
  await repo.gitPush(tagInfo.name);
}

/** Gets the crate to pull the version from. */
function getMainCrate() {
  if (repo.crates.length === 1) {
    return repo.crates[0];
  } else if (Deno.args.length >= 1) {
    return repo.getCrate(Deno.args[0]);
  } else {
    throw new Error(
      `You must supply a crate name CLI argument.\n${repo.crateNamesText()}`,
    );
  }
}
