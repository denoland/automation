/// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.

import { CargoPackageMetadata, getCargoMetadata } from "./cargo.ts";
import { Crate } from "./crate.ts";
import { path } from "./deps.ts";
import {
  existsSync,
  GitLogOutput,
  GitTags,
  runCommand,
  runCommandWithOutput,
} from "./helpers.ts";

export class Repo {
  #crates: Crate[] = [];

  private constructor(
    public readonly name: string,
    public readonly folderPath: string,
  ) {
  }

  static async load(name: string, folderPath: string) {
    folderPath = path.resolve(folderPath);
    const repo = new Repo(name, folderPath);

    if (existsSync(path.join(folderPath, "Cargo.toml"))) {
      const metadata = await getCargoMetadata(folderPath);
      for (const memberId of metadata.workspace_members) {
        const pkg = metadata.packages.find((pkg) => pkg.id === memberId);
        if (!pkg) {
          throw new Error(`Could not find package with id ${memberId}`);
        }
        repo.addCrate(pkg);
      }
    }

    return repo;
  }

  get crates(): ReadonlyArray<Crate> {
    return [...this.#crates];
  }

  getCrate(name: string) {
    const crate = this.#crates.find((c) => c.name === name);
    if (crate == null) {
      throw new Error(
        `Could not find crate with name: ${name}\n${this.crateNamesText()}`,
      );
    }
    return crate;
  }

  /** Gets the names of all the crates for showing in error messages
   * or for debugging purpopses. */
  crateNamesText() {
    return this.#crates.length === 0
      ? "<NO CRATES>"
      : this.#crates.map((c) => `- ${c.name}`).join("\n");
  }

  addCrate(crateMetadata: CargoPackageMetadata) {
    if (this.#crates.some((c) => c.name === crateMetadata.name)) {
      throw new Error(`Cannot add ${crateMetadata.name} twice to a repo.`);
    }
    this.#crates.push(
      new Crate(this, crateMetadata),
    );
  }

  async loadCrateInSubDir(name: string, subDir: string) {
    subDir = path.join(this.folderPath, subDir);
    const metadata = await getCargoMetadata(subDir);
    const pkg = metadata.packages.find((pkg) => pkg.name === name);
    if (!pkg) {
      throw new Error(`Could not find package with name ${name}`);
    }
    this.addCrate(pkg);
  }

  getCratesPublishOrder() {
    return getCratesPublishOrder(this.crates);
  }

  async hasLocalChanges() {
    const output = await this.runCommand([
      "git",
      "status",
      "--porcelain",
      "--untracked-files=no",
    ]);
    return output.trim().length > 0;
  }

  async assertCurrentBranch(expectedName: string) {
    const actualName = await this.gitCurrentBranch();
    if (actualName !== expectedName) {
      throw new Error(
        `Expected branch ${expectedName}, but current branch was ${actualName}.`,
      );
    }
  }

  async gitCurrentBranch() {
    return (await this.runCommand(["git", "rev-parse", "--abbrev-ref", "HEAD"]))
      .trim();
  }

  gitSwitchMain() {
    return this.runCommand(["git", "switch", "main"]);
  }

  gitPullMain(remote: "upstream" | "origin") {
    return this.runCommand(["git", "pull", remote, "main"]);
  }

  gitResetHard() {
    return this.runCommand(["git", "reset", "--hard"]);
  }

  gitBranch(name: string) {
    return this.runCommandWithOutput(["git", "checkout", "-b", name]);
  }

  gitAdd() {
    return this.runCommandWithOutput(["git", "add", "."]);
  }

  gitTag(name: string) {
    return this.runCommandWithOutput(["git", "tag", name]);
  }

  gitCommit(message: string) {
    return this.runCommandWithOutput(["git", "commit", "-m", message]);
  }

  gitPush(...additionalArgs: string[]) {
    return this.runCommandWithOutput(["git", "push", ...additionalArgs]);
  }

  /** Converts the commit history to be a full clone. */
  gitFetchUnshallow(remote: "origin" | "upstream") {
    return this.runCommandWithOutput(["git", "fetch", remote, "--unshallow"]);
  }

  /** Fetches the commit history up until a specified revision. */
  gitFetchUntil(remote: "origin" | "upstream", revision: string) {
    return this.runCommandWithOutput([
      "git",
      "fetch",
      remote,
      `--shallow-exclude=${revision}`,
    ]);
  }

  async gitIsShallow() {
    const output = await this.runCommand([
      "git",
      "rev-parse",
      `--is-shallow-repository`,
    ]);
    return output.trim() === "true";
  }

  /** Fetches the history for shallow repos. */
  async gitFetchHistoryIfNecessary(
    remote: "origin" | "upstream",
    revision?: string,
  ) {
    if (!(await this.gitIsShallow())) {
      return;
    }

    if (revision != null) {
      return await this.gitFetchUntil(remote, revision);
    } else {
      return await this.gitFetchUnshallow(remote);
    }
  }

  gitFetchTags(remote: "origin" | "upstream") {
    return this.runCommandWithOutput(["git", "fetch", remote, `--tags`]);
  }

  async getGitLogFromTags(
    remote: "origin" | "upstream",
    tagNameFrom: string | undefined,
    tagNameTo: string | undefined,
  ) {
    if (tagNameFrom == null && tagNameTo == null) {
      throw new Error(
        "You must at least supply a tag name from or tag name to.",
      );
    }

    // Ensure we have the git history up to this tag
    // For example, GitHub actions will do a shallow clone.
    try {
      await this.gitFetchHistoryIfNecessary(remote, tagNameFrom);
    } catch (err) {
      console.log(`Error fetching commit history: ${err}`);
    }

    return new GitLogOutput(
      await this.runCommand([
        "git",
        "log",
        "--oneline",
        `${tagNameFrom ?? ""}..${tagNameTo ?? ""}`,
      ]),
    );
  }

  /** Gets the commit message for the current commit. */
  async gitCurrentCommitMessage() {
    return (await this.runCommand([
      "git",
      "log",
      "-1",
      `--pretty=%B`,
    ])).trim();
  }

  async getGitTags() {
    return new GitTags((await this.runCommand(["git", "tag"])).split(/\r?\n/));
  }

  runCommand(cmd: string[]) {
    return runCommand({
      cwd: this.folderPath,
      cmd,
    });
  }

  runCommandWithOutput(cmd: string[]) {
    return runCommandWithOutput({
      cwd: this.folderPath,
      cmd,
    });
  }
}

export function getCratesPublishOrder(crates: readonly Crate[]) {
  const pendingCrates = [...crates];
  const sortedCrates = [];

  while (pendingCrates.length > 0) {
    for (let i = pendingCrates.length - 1; i >= 0; i--) {
      const crate = pendingCrates[i];
      const hasPendingDependency = crate.dependenciesInRepo()
        .some((c) => pendingCrates.includes(c));
      if (!hasPendingDependency) {
        sortedCrates.push(crate);
        pendingCrates.splice(i, 1);
      }
    }
  }

  return sortedCrates;
}
