// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
import { $ } from "./deps.ts";

export interface CratesIoMetadata {
  crate: {
    id: string;
    name: string;
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
