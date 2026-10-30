import assert from "node:assert/strict";
import { test } from "node:test";

import {
  LIMIT,
  moderationDialog,
  moderationState,
  moderationToast,
  muteDialog,
  muteLine,
  mutedUntil,
} from "../src/moderation.js";

const UNTIL = 1_761_800_000_000;

test("no moderation in the answer: no dialog, no state", () => {
  assert.equal(moderationDialog({ id: 1, text: "hola" }), null);
  assert.equal(moderationDialog(null), null);
  assert.deepEqual(moderationState({ id: 1 }), {});
});

test("a strike shows «Llevas N de 3 avisos» with an OK button", () => {
  const d = moderationDialog({ id: 1, text: "xxxx", moderation: { strikes: 2, limit: 3 } });
  assert.equal(d.body, "Tu texto tenía palabras ofensivas y se ocultaron. Llevas 2 de 3 avisos: al tercero no podrás publicar ni comentar durante 12 horas.");
  assert.equal(d.bodyEn, "Your text had offensive words and they were hidden. You have 2 of 3 warnings: on the third you won't be able to post or comment for 12 hours.");
  assert.equal(d.buttons.length, 1);
  assert.equal(d.buttons[0].event, undefined); // a button without an event closes the dialog
  assert.deepEqual(moderationState({ moderation: { strikes: 2, limit: 3 } }), {});
  // A missing or odd count still reads sensibly.
  assert.match(moderationDialog({ moderation: {} }).body, /Llevas 1 de 3 avisos/);
  assert.equal(LIMIT, 3);
});

test("the strike that starts the mute shows the mute dialog with the clock time", () => {
  const response = { moderation: { strikes: 3, limit: 3, mutedUntil: UNTIL } };
  const d = moderationDialog(response);
  assert.deepEqual(d, muteDialog(UNTIL));
  assert.equal(d.body[0].text, "Usaste palabras ofensivas tres veces.");
  assert.equal(d.body[0].textEn, "You used offensive words three times.");
  assert.deepEqual(
    { text: d.body[1].text, textEn: d.body[1].textEn, time: d.body[1].time, timeFormat: d.body[1].timeFormat },
    { text: "No podrás publicar ni comentar hasta las ", textEn: "You won't be able to post or comment until ", time: UNTIL, timeFormat: "clock" },
  );
  assert.deepEqual(moderationState(response, UNTIL - 1), { mutedUntil: UNTIL });
});

test("mutedUntil is the mute's end only while it is ahead", () => {
  assert.equal(mutedUntil(UNTIL, UNTIL - 1), UNTIL);
  assert.equal(mutedUntil(UNTIL, UNTIL), 0);
  assert.equal(mutedUntil(undefined, 0), 0);
  assert.equal(mutedUntil("soon", 0), 0);
  assert.equal(mutedUntil(0, 0), 0);
});

test("the mute line under the locked composer: a prefix Kino completes with the clock", () => {
  const line = muteLine(UNTIL, { flex: 1 });
  assert.equal(line.type, "Text");
  assert.equal(line.text, "No puedes publicar ni comentar hasta las ");
  assert.equal(line.textEn, "You can't post or comment until ");
  assert.equal(line.time, UNTIL);
  assert.equal(line.timeFormat, "clock");
  assert.equal(line.flex, 1);
});

test("moderationToast: one short line, no strike count, even when it starts a mute", () => {
  assert.equal(moderationToast({}), null);
  assert.equal(moderationToast(null), null);
  assert.ok(moderationToast({ moderation: { strikes: 1, limit: 3 } })[0].length < 80);
  assert.ok(!/1/.test(moderationToast({ moderation: { strikes: 1, limit: 3 } })[0])); // no strike number
  assert.ok(moderationToast({ moderation: { mutedUntil: Date.now() + 1000 } })); // still something, not null
  assert.ok(moderationToast({ moderation: { mutedUntil: Date.now() + 1000 } })[0].length < 80);
});
