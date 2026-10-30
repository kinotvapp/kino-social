import assert from "node:assert/strict";
import { test } from "node:test";

import { tidyLines } from "../src/lines.js";

test("at most one blank line in a row, none at the ends (as the server's tidy_lines)", () => {
  assert.equal(tidyLines("a\nb\n\nc"), "a\nb\n\nc");
  assert.equal(tidyLines("a\n\n\nb"), "a\n\nb");
  assert.equal(tidyLines("a\n \n\t\n  \n\nb"), "a\n\nb");
  assert.equal(tidyLines("a\r\n\r\n\r\nb\r\nc"), "a\n\nb\nc");
  assert.equal(tidyLines("a\n\n\n\n"), "a");
  assert.equal(tidyLines("\n\n  hola  \n\n\n"), "hola");
  assert.equal(tidyLines(undefined), "");
  assert.equal(tidyLines("uno\n\n\ndos\n\n\n\ntres"), "uno\n\ndos\n\ntres");
});
