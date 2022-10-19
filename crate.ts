// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.

import { $, dax, semver } from "./deps.ts";
import type { Repo } from "./repo.ts";
import {
  CargoDependencyMetadata,
  CargoPackageMetadata,
  getCargoMetadata,
} from "./cargo.ts";
import { getCratesIoMetadata } from "./crates_io.ts";

export interface CrateDep {
  isDev: boolean;
  crate: Crate;
}

let i = 0;

export class Crate {
  #pkg: CargoPackageMetadata;
  #isUpdatingManifest = false;

  constructor(
    public readonly repo: Repo,
    crateMetadata: CargoPackageMetadata,
  ) {
    if (!$.existsSync(crateMetadata.manifest_path)) {
      throw new Error(`Could not find crate at ${crateMetadata.manifest_path}`);
    }
    this.#pkg = crateMetadata;
  }

  get manifestPath() {
    return this.#pkg.manifest_path;
  }

  get folderPath() {
    return $.path.dirname(this.#pkg.manifest_path);
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
    const newVersion = semver.parse(this.version)!.inc(part).toString();
    return this.setVersion(newVersion);
  }

  async setVersion(version: string) {
    $.logStep(`Setting ${this.name} to ${version}...`);

    const metadata = await getCargoMetadata(this.repo.folderPath);
    const rootpath = $.path.join(metadata.workspace_root, "Cargo.toml");
    const originalText = await Deno.readTextFile(rootpath);
    const findRegex = new RegExp(
      `^(\\b${this.name}\\b\\s.*)"([=\\^])?[0-9]+[^"]+"`,
      "gm",
    );

    if (findRegex.test(originalText)) {
      const newText = originalText.replace(findRegex, `$1"${version}"`);

      if (originalText === newText) {
        throw new Error(`The file didn't change: ${rootpath}`);
      }
      await Deno.writeTextFile(rootpath, newText);
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
      await this.#updateManifestFile((fileText) => {
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
    await this.#updateManifestFile((fileText) => {
      const findRegex = new RegExp(
        `^(version\\s*=\\s*)"${this.#pkg.version}"$`,
        "m",
      );
      return fileText.replace(findRegex, `$1"${version}"`);
    });
    this.#pkg.version = version;
  }

  toLocalSource(crate: Crate) {
    return this.#updateManifestFile((fileText) => {
      const relativePath = $.path.relative(this.folderPath, crate.folderPath)
        .replace(/\\/g, "/");
      // try to replace if it had a property in the object
      const versionPropRegex = new RegExp(
        `^(${crate.name}\\b\\s.*)version\\s*=\\s*"[^"]+"`,
        "m",
      );
      const newFileText = fileText.replace(
        versionPropRegex,
        `$1path = "${relativePath}"`,
      );
      if (newFileText !== fileText) {
        return newFileText;
      }

      // now try to find if it just had a version
      const versionStringRegex = new RegExp(
        `^(\\b${crate.name}\\b\\s.*)"([=\\^])?[0-9]+[^"]+"`,
        "m",
      );
      return fileText.replace(
        versionStringRegex,
        `$1{ path = "${relativePath}" }`,
      );
    });
  }

  revertLocalSource(crate: Crate) {
    return this.#updateManifestFile((fileText) => {
      const crateVersion = crate.version.toString();
      // try to replace if it had a property in the object
      const pathOnlyRegex = new RegExp(
        `^${crate.name} = { path = "[^"]+" }$`,
        "m",
      );
      const newFileText = fileText.replace(
        pathOnlyRegex,
        `${crate.name} = "${crateVersion}"`,
      );
      if (newFileText !== fileText) {
        return newFileText;
      }

      // now try to find if it had a path in an object
      const versionStringRegex = new RegExp(
        `^(${crate.name}\\b\\s.*)path\\s*=\\s*"[^"]+"`,
        "m",
      );
      return fileText.replace(
        versionStringRegex,
        `$1version = "${crateVersion}"`,
      );
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

  async #updateManifestFile(action: (fileText: string) => string) {
    if (this.#isUpdatingManifest) {
      throw new Error("Cannot update manifest while updating manifest.");
    }
    this.#isUpdatingManifest = true;
    try {
      const originalText = await Deno.readTextFile(this.manifestPath);
      const newText = action(originalText);
      if (originalText === newText) {
        throw new Error(`The file didn't change: ${this.manifestPath}`);
      }
      await Deno.writeTextFile(this.manifestPath, newText);
    } finally {
      this.#isUpdatingManifest = false;
    }
  }
}
