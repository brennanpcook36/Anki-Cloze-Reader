import test from "node:test";
import assert from "node:assert/strict";
import { escapeHtml, makeCloze, resolveClozeFields, sentenceAround, storageKey } from "../src/renderer/card-utils.mjs";

test("creates a cloze around the selected text", () => {
  assert.equal(makeCloze("The middle cerebral artery supplies the lateral cortex.", "middle cerebral artery"), "The {{c1::middle cerebral artery}} supplies the lateral cortex.");
});

test("matches selection without case sensitivity", () => {
  assert.equal(makeCloze("MRI is useful.", "mri"), "{{c1::MRI}} is useful.");
});

test("extracts the sentence containing the highlight", () => {
  assert.equal(sentenceAround("Prior sentence. The lesion is T1 hypointense. Next sentence.", "T1 hypointense"), "The lesion is T1 hypointense.");
});

test("escapes Anki source HTML", () => {
  assert.equal(escapeHtml("A&B <book>"), "A&amp;B &lt;book&gt;");
});

test("creates document-specific storage keys", () => {
  assert.equal(storageKey("abc"), "cloze-reader:abc");
});

test("uses the modern Anki Back Extra field", () => {
  assert.deepEqual(resolveClozeFields(["Text", "Back Extra"]), { textField: "Text", backField: "Back Extra" });
});

test("supports older Anki Extra fields and custom secondary fields", () => {
  assert.equal(resolveClozeFields(["Text", "Extra"]).backField, "Extra");
  assert.equal(resolveClozeFields(["Prompt", "Notes"]).backField, "Notes");
});
