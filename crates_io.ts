// Copyright 2018-2025 the Deno authors. All rights reserved. MIT license.
import { $ } from "@david/dax";

export interface CratesIoMetadata {
  crate: {
    id: string;
    name: string;
    max_stable_version: string;
  };
  versions: {
    crate: string;
    num: string;
  }[];
}

export async function getCratesIoMetadata(crateName: string) {
  // rate limit
  await new Promise((resolve) => setTimeout(resolve, 100));

  return await $.request(`https://crates.io/api/v1/crates/${crateName}`)
    .noThrow(404)
    .json<CratesIoMetadata | undefined>();
}

export interface CratesIoOwner {
  id: number;
  avatar: string;
  kind: "user" | "team";
  name: string;
  login: string;
  url: string;
}

export async function getCratesIoOwners(crateName: string) {
  // rate limit
  await new Promise((resolve) => setTimeout(resolve, 100));

  const result = await $.request(
    `https://crates.io/api/v1/crates/${crateName}/owners`,
  )
    .noThrow(404)
    .json<{ users: CratesIoOwner[] } | undefined>();
  return result?.users;
}

export class CratesIoCache {
  #hasOwnerCache = new Map<string, boolean>();
  #metaDataCache = new Map<string, CratesIoMetadata | "not-found">();

  async getMetadata(crateName: string) {
    let metadata = this.#metaDataCache.get(crateName);
    if (metadata == null) {
      metadata = await getCratesIoMetadata(crateName);
      this.#metaDataCache.set(crateName, metadata ?? "not-found");
    }
    return metadata === "not-found" ? undefined : metadata;
  }

  async hasDenoLandOwner(crateName: string) {
    if (crateName.startsWith("deno_")) {
      return true;
    }
    let hasDenoLandOwner = this.#hasOwnerCache.get(crateName);
    if (hasDenoLandOwner == null) {
      const owners = await getCratesIoOwners(crateName);
      hasDenoLandOwner = owners
        ?.some((s) => s.login === "github:denoland:engineering") ?? false;
      this.#hasOwnerCache.set(crateName, hasDenoLandOwner);
    }
    return hasDenoLandOwner;
  }
}
