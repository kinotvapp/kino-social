// What the person wrote, before it is sent: line breaks as the server keeps them (app/social.py tidy_lines). CR LF and
// CR become LF, a run of 3 or more line breaks (blank lines in between) becomes 2, and the ends are trimmed.

const BLANK_RUN = /\n[ \t]*(?:\n[ \t]*)+\n/g;

export function tidyLines(text) {
  return String(text ?? "").replace(/\r\n?/g, "\n").replace(BLANK_RUN, "\n\n").trim();
}
