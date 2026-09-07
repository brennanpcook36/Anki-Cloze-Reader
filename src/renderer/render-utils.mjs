export function pageSequence(count) {
  const total = Number(count);
  if (!Number.isInteger(total) || total < 0) return [];
  return Array.from({ length: total }, (_, index) => index + 1);
}

export function renderIsCurrent(expectedSession, currentSession, expectedPdf, currentPdf) {
  return expectedSession === currentSession && expectedPdf === currentPdf;
}
