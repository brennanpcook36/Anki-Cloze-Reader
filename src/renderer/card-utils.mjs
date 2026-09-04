export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function sentenceAround(fullText, selection) {
  const normalized = fullText.replace(/\s+/g, " ").trim();
  const selected = selection.replace(/\s+/g, " ").trim();
  const index = normalized.toLocaleLowerCase().indexOf(selected.toLocaleLowerCase());
  if (index < 0) return selected;

  const left = normalized.slice(0, index);
  const right = normalized.slice(index + selected.length);
  const leftBoundary = Math.max(left.lastIndexOf(". "), left.lastIndexOf("? "), left.lastIndexOf("! "));
  const candidates = [right.indexOf(". "), right.indexOf("? "), right.indexOf("! ")].filter(i => i >= 0);
  const rightBoundary = candidates.length ? Math.min(...candidates) + 1 : right.length;
  return normalized.slice(leftBoundary < 0 ? 0 : leftBoundary + 2, index + selected.length + rightBoundary).trim();
}

export function makeCloze(context, selection) {
  const selected = selection.replace(/\s+/g, " ").trim();
  if (!selected) return "";
  const index = context.toLocaleLowerCase().indexOf(selected.toLocaleLowerCase());
  if (index < 0) return `{{c1::${selected}}}`;
  return `${context.slice(0, index)}{{c1::${context.slice(index, index + selected.length)}}}${context.slice(index + selected.length)}`;
}

export function storageKey(fingerprint) {
  return `cloze-reader:${fingerprint}`;
}

export function resolveClozeFields(fieldNames) {
  const textField = fieldNames.find(name => name.toLowerCase() === "text") || fieldNames[0];
  const backField = fieldNames.find(name => name.toLowerCase() === "back extra")
    || fieldNames.find(name => name.toLowerCase() === "extra")
    || fieldNames.find(name => name !== textField);
  return { textField, backField };
}
