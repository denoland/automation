/// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.

import { CargoPackageMetadata, getCargoMetadata } from "./cargo.ts";
import { Crate } from "./crate.ts";
import { path, semver } from "./deps.ts";
import {
  existsSync,
  GitLogOutput,
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

  gitPullUpstreamMain() {
    return this.runCommand(["git", "pull", "upstream", "main"]);
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

  async getGitLogFromTag(tagName: string) {
    await this.runCommandWithOutput(["git", "fetch", "upstream", `--tags`]);
    return new GitLogOutput(
      await this.runCommand(["git", "log", "--oneline", `${tagName}..`]),
    );
  }

  async getGitTags() {
    return (await this.runCommand(["git", "tag"])).split(/\r?\n/);
  }

  /** Gets the tags that are for a version. */
  async getGitVersionTags() {
    const tagNames = await this.getGitTags();
    const result = [];
    for (const name of tagNames) {
      const version = semver.parse(name.replace(/^v/, ""));
      if (version != null) {
        result.push({
          name,
          version,
        });
      }
    }
    return result;
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
