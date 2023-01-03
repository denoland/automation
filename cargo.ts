// Copyright 2018-2023 the Deno authors. All rights reserved. MIT license.

import { $ } from "./deps.ts";

export interface CargoMetadata {
  packages: CargoPackageMetadata[];
  /** Identifiers in the `packages` array of the workspace members. */
  "workspace_members": string[];
  /** The absolute workspace root directory path. */
  "workspace_root": string;
}

export interface CargoPackageMetadata {
  id: string;
  name: string;
  version: string;
  dependencies: CargoDependencyMetadata[];
  /** Path to Cargo.toml */
  "manifest_path": string;
}

export interface CargoDependencyMetadata {
  name: string;
  /** Version requrement (ex. ^0.1.0) */
  req: string;
  kind: "dev" | null;
}

export function getCargoMetadata(directory: string) {
  return $`cargo metadata --format-version 1`
    .cwd(directory)
    .json<CargoMetadata>();
}
