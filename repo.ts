/// Copyright 2018-2025 the Deno authors. All rights reserved. MIT license.

import { type CargoPackageMetadata, getCargoMetadata } from "./cargo.ts";
import { Crate, type CrateDep } from "./crate.ts";
import { $, Path } from "@david/dax";
import * as dax from "@david/dax";
import { GitLogOutput, GitTags } from "./helpers.ts";

export interface RepoLoadOptions {
  /** Name of the repo. */
  name: string;
  /** Path to the directory of the repo on the local file system. */
  path: string | Path;
  /** Whether crates should not be loaded if a Cargo.toml exists
   * in the root of the repo. If no Cargo.toml exists, then it won't
   * load the crates anyway. */
  skipLoadingCrates?: boolean;
}

export class Repo {
  #crates: Crate[] = [];

  private constructor(
    public readonly name: string,
    public readonly folderPath: Path,
  ) {
  }

  static async load(options: RepoLoadOptions): Promise<Repo> {
    const folderPath = options.path instanceof Path
      ? options.path
      : $.path(options.path);
    const repo = new Repo(options.name, folderPath);

    if (
      !options.skipLoadingCrates &&
      folderPath.join("Cargo.toml").existsSync()
    ) {
      await repo.loadCrates();
    }

    return repo;
  }

  async loadCrates() {
    const metadata = await getCargoMetadata(this.folderPath);
    for (const memberId of metadata.workspace_members) {
      const pkg = metadata.packages.find((pkg) => pkg.id === memberId);
      if (!pkg) {
        throw new Error(`Could not find package with id ${memberId}`);
      }
      this.addCrate(pkg);
    }
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
    const subDirPath = this.folderPath.join(subDir);
    const metadata = await getCargoMetadata(subDirPath);
    const pkg = metadata.packages.find((pkg) => pkg.name === name);
    if (!pkg) {
      throw new Error(`Could not find package with name ${name}`);
    }
    this.addCrate(pkg);
  }

  get crates(): ReadonlyArray<Crate> {
    return [...this.#crates];
  }

  getCrate(name: string): Crate {
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
  crateNamesText(): string {
    return this.#crates.length === 0
      ? "<NO CRATES>"
      : this.#crates.map((c) => `- ${c.name}`).join("\n");
  }

  getCratesPublishOrder(): Crate[] {
    return getCratesPublishOrder(this.crates);
  }

  async hasLocalChanges(): Promise<boolean> {
    const output = await this.command(
      "git status --porcelain --untracked-files=no",
    ).text();
    return output.length > 0;
  }

  async assertCurrentBranch(expectedName: string) {
    const actualName = await this.gitCurrentBranch();
    if (actualName !== expectedName) {
      throw new Error(
        `Expected branch ${expectedName}, but current branch was ${actualName}.`,
      );
    }
  }

  gitCurrentBranch(): Promise<string> {
    return this.command("git rev-parse --abbrev-ref HEAD")
      .text();
  }

  async gitSwitch(...args: string[]) {
    await this.command(["git", "switch", ...args]);
  }

  async gitPull(...args: string[]) {
    await this.command(["git", "pull", ...args]);
  }

  async gitResetHard() {
    await this.command(["git", "reset", "--hard"]);
  }

  async gitBranch(name: string) {
    await this.command(["git", "checkout", "-b", name]);
  }

  async gitAdd() {
    await this.command(["git", "add", "."]);
  }

  async gitTag(name: string) {
    await this.command(["git", "tag", name]);
  }

  async gitCommit(message: string) {
    await this.command(["git", "commit", "-m", message]);
  }

  async gitPush(...additionalArgs: string[]) {
    await this.command(["git", "push", ...additionalArgs]);
  }

  /** Converts the commit history to be a full clone. */
  async gitFetchUnshallow(remote: string) {
    await this.command(["git", "fetch", remote, "--unshallow"]);
  }

  /** Fetches the commit history up until a specified revision. */
  async gitFetchUntil(remote: string, revision: string) {
    await this.command([
      "git",
      "fetch",
      remote,
      `--shallow-exclude=${revision}`,
    ]);
  }

  async gitIsShallow(): Promise<boolean> {
    const output = await this.command("git rev-parse --is-shallow-repository")
      .text();
    return output === "true";
  }

  /** Fetches from the provided remote. */
  async gitFetchHistory(
    remote: string,
    revision?: string,
  ): Promise<void> {
    if (await this.gitIsShallow()) {
      // only fetch what is necessary
      if (revision != null) {
        await this.gitFetchUntil(remote, revision);
      } else {
        await this.gitFetchUnshallow(remote);
      }
    } else {
      const args = ["git", "fetch", remote, "--recurse-submodules=no"];
      if (revision != null) {
        args.push(revision);
      }
      await this.command(args);
    }
  }

  async gitFetchTags(remote: string) {
    await this.command([
      "git",
      "fetch",
      remote,
      "--tags",
      "--recurse-submodules=no",
    ]);
  }

  async getGitLogFromTags(
    remote: string,
    tagNameFrom: string | undefined,
    tagNameTo: string | undefined,
  ): Promise<GitLogOutput> {
    if (tagNameFrom == null && tagNameTo == null) {
      throw new Error(
        "You must at least supply a tag name from or tag name to.",
      );
    }

    // Ensure we have the git history up to this tag
    // For example, GitHub actions will do a shallow clone.
    try {
      await this.gitFetchHistory(remote, tagNameFrom);
    } catch (err) {
      console.log(`Error fetching commit history: ${err}`);
    }

    // the output of git log is not stable, so use rev-list
    const revs = await this.command([
      "git",
      "rev-list",
      tagNameFrom == null ? tagNameTo! : `${tagNameFrom}..${tagNameTo ?? ""}`,
    ]).lines();

    const lines = await Promise.all(revs.map((rev) => {
      return this.command([
        "git",
        "log",
        "--format=%s",
        "-n",
        "1",
        rev,
      ])
        .text()
        .then((message) => ({
          rev,
          message: message,
        }));
    }));

    return new GitLogOutput(lines);
  }

  /** Gets the git remotes where the key is the remote name and the value is the url. */
  async getGitRemotes(): Promise<{ [name: string]: string }> {
    const remoteNames = await this.command("git remote").lines();
    const remotes: { [name: string]: string } = {};
    for (const name of remoteNames) {
      remotes[name] = await this.command(["git", "remote", "get-url", name])
        .text();
    }
    return remotes;
  }

  /** Gets the commit message for the current commit. */
  gitCurrentCommitMessage(): Promise<string> {
    return this.command("git log -1 --pretty=%B").text();
  }

  /** Gets the latest tag on the current branch. */
  gitLatestTag(): Promise<string> {
    return this.command("git describe --tags --abbrev=0").text();
  }

  async getGitTags(): Promise<GitTags> {
    return new GitTags(await this.command("git tag").lines());
  }

  command(command: string | string[]): dax.CommandBuilder {
    return new dax.CommandBuilder()
      .command(command)
      .cwd(this.folderPath);
  }
}

export function getCratesPublishOrder(crates: Iterable<Crate>): Crate[] {
  const sortedCrates: ({ crate: Crate; deps: CrateDep[] })[] = [];

  for (const crate of crates) {
    const deps = crate.immediateDependenciesInRepo();
    const insertPos = getInsertPosition(crate, deps);
    sortedCrates.splice(insertPos, 0, { crate, deps });
  }

  return sortedCrates.map((i) => i.crate);

  function getInsertPosition(crate: Crate, crateDeps: CrateDep[]) {
    for (let i = 0; i < sortedCrates.length; i++) {
      const item = sortedCrates[i];
      const crateItemDep = item.deps.find((d) => d.crate.name === crate.name);
      if (crateItemDep != null) {
        const depB = crateDeps.find((d) => d.crate.name === item.crate.name);
        if (crateItemDep.isDev === depB?.isDev) {
          throw new Error(
            `Circular dependency found between ${crate.name} and ${item.crate.name}`,
          );
        }
        if (depB == null || !crateItemDep.isDev) {
          return i;
        }
      }
    }
    return sortedCrates.length;
  }
}
