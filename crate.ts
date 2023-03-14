// Copyright 2018-2023 the Deno authors. All rights reserved. MIT license.

import { $, dax, PathRef, semver } from "./deps.ts";
import type { Repo } from "./repo.ts";
import { CargoDependencyMetadata, CargoPackageMetadata } from "./cargo.ts";
import { getCratesIoMetadata } from "./crates_io.ts";

export interface CrateDep {
  isDev: boolean;
  crate: Crate;
}

export class Crate {
  #pkg: CargoPackageMetadata;
  #isUpdatingManifest = false;
  #isUpdatingRootManifest = false;

  constructor(
    public readonly repo: Repo,
    crateMetadata: CargoPackageMetadata,
  ) {
    const manifestPath = $.path(crateMetadata.manifest_path);
    if (!manifestPath.existsSync()) {
      throw new Error(`Could not find crate at ${crateMetadata.manifest_path}`);
    }
    this.#pkg = crateMetadata;
  }

  get manifestPath() {
    return $.path(this.#pkg.manifest_path);
  }

  get folderPath() {
    return this.manifestPath.parentOrThrow();
  }

  get name() {
    return this.#pkg.name;
  }

  get version() {
    return this.#pkg.version;
  }

  get dependencies() {
    return this.#pkg.dependencies as readonly CargoDependencyMetadata[];
  }

  /** Prompts the user how they would like to patch and increments the version accordingly. */
  async promptAndIncrement() {
    const result = await this.promptAndTryIncrement();
    if (result == null) {
      throw new Error("No decision.");
    }
    return result;
  }

  /** Prompts the user how they would like to patch and increments the version accordingly. */
  async promptAndTryIncrement() {
    $.log(`${this.name} is on ${this.version}`);
    const versionIncrement = getVersionIncrement();
    if (versionIncrement != null) {
      await this.increment(versionIncrement);
      $.log(`  Set version to ${this.version}`);
    }
    return versionIncrement;

    function getVersionIncrement() {
      if (confirm("Increment patch?")) {
        return "patch";
      } else if (confirm("Increment minor?")) {
        return "minor";
      } else if (confirm("Increment major?")) {
        return "major";
      } else {
        return undefined;
      }
    }
  }

  increment(part: "major" | "minor" | "patch") {
    const newVersion = semver.parse(this.version)!.increment(part).toString();
    return this.setVersion(newVersion);
  }

  async setVersion(version: string) {
    $.logStep(`Setting ${this.name} to ${version}...`);

    // sets the version of any usages of this crate in the root Cargo.toml
    if (!this.repo.folderPath.equals(this.folderPath)) {
      const rootpath = this.repo.folderPath.join("Cargo.toml");
      const originalText = await rootpath.readText();
      const findRegex = new RegExp(
        `^(\\b${this.name}\\b\\s.*)"([=\\^])?[0-9]+[^"]+"`,
        "gm",
      );

      const newText = originalText.replace(findRegex, `$1"${version}"`);
      if (originalText !== newText) {
        await rootpath.writeText(newText);
      } else {
        // in this case, the repo does not keep the version
        // inside the root cargo.toml file
        for (const crate of this.repo.crates) {
          await crate.setDependencyVersion(this.name, version);
        }
      }
    }

    await this.#updateManifestVersion(version);
  }

  /** Gets the latest version from crates.io or returns undefined if not exists. */
  async getLatestVersion() {
    return (await getCratesIoMetadata(this.name))?.crate.max_stable_version;
  }

  async setDependencyVersion(dependencyName: string, version: string) {
    const dependency = this.#pkg.dependencies.find((d) =>
      d.name === dependencyName
    );
    if (dependency != null && dependency.req !== "*") {
      await this.#updateManifestFile((_filePath, fileText) => {
        // simple for now...
        const findRegex = new RegExp(
          `^(\\b${dependencyName}\\b\\s.*)"([=\\^])?[0-9]+[^"]+"`,
          "gm",
        );
        return fileText.replace(findRegex, `$1"${version}"`);
      });

      dependency.req = `^${version}`;
    }
  }

  async #updateManifestVersion(version: string) {
    await this.#updateManifestFile((_filePath, fileText) => {
      const findRegex = new RegExp(
        `^(version\\s*=\\s*)"${this.#pkg.version}"$`,
        "m",
      );
      return fileText.replace(findRegex, `$1"${version}"`);
    });
    this.#pkg.version = version;
  }

  toLocalSource(crate: Crate) {
    return this.#updateRootManifestFile((filePath, fileText) => {
      const relativePath = filePath.relative(crate.folderPath)
        .replace(/\\/g, "/");
      const newText =
        `[patch.crates-io.${crate.name}]\npath = "${relativePath}"\n`;
      return fileText + newText;
    });
  }

  revertLocalSource(crate: Crate) {
    return this.#updateRootManifestFile((filePath, fileText) => {
      const relativePath = filePath.relative(crate.folderPath)
        .replace(/\\/g, "/");
      const newText =
        `[patch.crates-io.${crate.name}]\npath = "${relativePath}"\n`;
      return fileText.replace(newText, "");
    });
  }

  /** Gets all the descendant dependencies in the repository. */
  descendantDependenciesInRepo() {
    // try to maintain publish order.
    const crates = new Map<string, Crate>();
    const stack = [...this.immediateDependenciesInRepo()];
    while (stack.length > 0) {
      const { crate } = stack.pop()!;
      if (!crates.has(crate.name)) {
        crates.set(crate.name, crate);
        stack.push(...crate.immediateDependenciesInRepo());
      }
    }
    return Array.from(crates.values());
  }

  /** Gets the immediate child dependencies found in the repo. */
  immediateDependenciesInRepo() {
    const dependencies: CrateDep[] = [];
    for (const dependency of this.#pkg.dependencies) {
      const crate = this.repo.crates.find((c) => c.name === dependency.name);
      if (crate != null) {
        dependencies.push({
          isDev: dependency.kind === "dev",
          crate,
        });
      }
    }
    return dependencies;
  }

  /** Gets if published or not, returning undefined if it was never published. */
  async isPublished() {
    const cratesIoMetadata = await getCratesIoMetadata(this.name);
    if (cratesIoMetadata == null) {
      return undefined;
    }
    return cratesIoMetadata.versions.some((v) =>
      v.num === this.version.toString()
    );
  }

  async publish(...additionalArgs: string[]) {
    const isPublished = await this.isPublished();
    if (isPublished == null) {
      $.log(`Never published, so skipping ${this.name} ${this.version}`);
      return false;
    }
    if (isPublished) {
      $.log(`Already published ${this.name} ${this.version}`);
      return false;
    }

    $.logStep(`Publishing ${this.name} ${this.version}...`);

    // Sometimes a publish may fail due to the crates.io index
    // not being updated yet. Usually it will be resolved after
    // retrying, so try a few times before failing hard.
    return await $.withRetries({
      action: async () => {
        await this.command([
          "cargo",
          "publish",
          ...additionalArgs,
        ]);
        return true;
      },
      count: 5,
      delay: "10s",
    });
  }

  async cargoCheck(...additionalArgs: string[]) {
    await this.command(["cargo", "check", ...additionalArgs]);
  }

  async cargoUpdate(...additionalArgs: string[]) {
    await this.command(["cargo", "update", ...additionalArgs]);
  }

  async build(args?: { allFeatures?: boolean; additionalArgs?: string[] }) {
    const cliArgs = ["cargo", "build"];
    if (args?.allFeatures) {
      cliArgs.push("--all-features");
    }
    if (args?.additionalArgs) {
      cliArgs.push(...args.additionalArgs);
    }
    await this.command(cliArgs);
  }

  async test(args?: { allFeatures?: boolean; additionalArgs?: string[] }) {
    const cliArgs = ["cargo", "test"];
    if (args?.allFeatures) {
      cliArgs.push("--all-features");
    }
    if (args?.additionalArgs) {
      cliArgs.push(...args.additionalArgs);
    }
    await this.command(cliArgs);
  }

  command(command: string | string[]) {
    return new dax.CommandBuilder()
      .command(command)
      .cwd(this.folderPath);
  }

  async #updateManifestFile(
    action: (filePath: PathRef, fileText: string) => string,
  ) {
    if (this.#isUpdatingManifest) {
      throw new Error("Cannot update manifest while updating manifest.");
    }
    this.#isUpdatingManifest = true;
    try {
      await updateFileEnsureChange(this.manifestPath, action);
    } finally {
      this.#isUpdatingManifest = false;
    }
  }

  async #updateRootManifestFile(
    action: (filePath: PathRef, fileText: string) => string,
  ) {
    const rootManifestFilePath = this.repo.folderPath.join("Cargo.toml");
    if (
      this.manifestPath.equals(rootManifestFilePath) ||
      !rootManifestFilePath.existsSync()
    ) {
      return this.#updateManifestFile(action);
    }
    if (this.#isUpdatingRootManifest) {
      throw new Error("Cannot update root manifest while updating it.");
    }
    this.#isUpdatingRootManifest = true;
    try {
      await updateFileEnsureChange(rootManifestFilePath, action);
    } finally {
      this.#isUpdatingRootManifest = false;
    }
  }
}

async function updateFileEnsureChange(
  filePath: PathRef,
  action: (filePath: PathRef, fileText: string) => string,
) {
  const originalText = await filePath.readText();
  const newText = action(filePath, originalText);
  if (originalText === newText) {
    throw new Error(`The file didn't change: ${filePath}`);
  }
  await filePath.writeText(newText);
}
