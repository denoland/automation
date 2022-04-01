/// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.

import { GitLogOutput } from "./helpers.ts";

/** Helpers for dealing with a Releases.md file. */
export class ReleasesMdFile {
  #filePath: string;
  #fileText: string;

  constructor(filePath: string) {
    this.#filePath = filePath;
    this.#fileText = Deno.readTextFileSync(filePath);
  }

  get filePath() {
    return this.#filePath;
  }

  get fileText() {
    return this.#fileText;
  }

  updateWithGitLog(
    { gitLog, version, date }: {
      gitLog: GitLogOutput;
      version: string;
      date?: Date;
    },
  ) {
    const insertText = getInsertText();
    this.#updateText(this.#fileText.replace(/^### /m, insertText + "\n\n### "));

    function getInsertText() {
      const formattedGitLog = gitLog.formatForReleaseMarkdown();
      const formattedDate = getFormattedDate(date ?? new Date());

      return `### ${version} / ${formattedDate}\n\n` +
        `${formattedGitLog}`;

      function getFormattedDate(date: Date) {
        const formattedMonth = padTwoDigit(date.getMonth() + 1);
        const formattedDay = padTwoDigit(date.getDate());
        return `${date.getFullYear()}.${formattedMonth}.${formattedDay}`;

        function padTwoDigit(val: number) {
          return val.toString().padStart(2, "0");
        }
      }
    }
  }

  #updateText(newText: string) {
    this.#fileText = newText;
    Deno.writeTextFileSync(this.#filePath, this.#fileText);
  }
}
