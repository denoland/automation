/// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.

import { CargoPackageMetadata, getCargoMetadata } from "./cargo.ts";
import { Crate } from "./crate.ts";
import { path } from "./deps.ts";
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
      throw new Error(`Could not find crate with name: ${name}`);
    }
    return crate;
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

  switchMain() {
    return this.runCommand(["git", "switch", "main"]);
  }

  pullUpstreamMain() {
    return this.runCommand(["git", "pull", "upstream", "main"]);
  }

  resetHard() {
    return this.runCommand(["git", "reset", "--hard"]);
  }

  branch(name: string) {
    return this.runCommandWithOutput(["git", "checkout", "-b", name]);
  }

  gitAdd() {
    return this.runCommandWithOutput(["git", "add", "."]);
  }

  commit(message: string) {
    return this.runCommandWithOutput(["git", "commit", "-m", message]);
  }

  push() {
    return this.runCommandWithOutput(["git", "push"]);
  }

  async getGitLogFromTag(tagName: string) {
    await this.runCommandWithOutput(["git", "fetch", "upstream", `--tags`]);
    return new GitLogOutput(
      await this.runCommand(["git", "log", "--oneline", `${tagName}..`]),
    );
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
