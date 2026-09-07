const normalizeFact = text => String(text).replace(/\{\{c\d+::(.*?)(?:::[^{}]*?)?\}\}/gs, '$1').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
function isSelfContainedCloze(cloze) {
  const plain = String(cloze || '').replace(/\{\{c\d+::(.*?)(?:::[^{}]*?)?\}\}/gs, '$1').replace(/\s+/g, ' ').trim();
  if (!plain) return false;
  const vagueOpening = /^(?:it|its|this|that|these|those|they|their|the (?:lesion|condition|disease|finding|structure|medication|drug|procedure|study|article|patient|image|diagram|above|below))\b/i;
  const externalReference = /\b(?:as (?:shown|described|noted) (?:above|below|previously)|the former|the latter|above-mentioned|previously mentioned)\b/i;
  return !vagueOpening.test(plain) && !externalReference.test(plain);
}
function validateBulk(payload) {
  const count = Number(payload.count);
  if (!Number.isInteger(count) || count < 1 || count > 50) throw new Error('Choose a card limit between 1 and 50.');
  const pages = payload.pages;
  if (!Array.isArray(pages) || pages.length < 1 || pages.length > 3) throw new Error('Each request must contain 1–3 pages.');
  const numbers = new Set();
  for (const page of pages) {
    if (!Number.isInteger(page.page) || page.page < 1 || numbers.has(page.page)) throw new Error('Invalid or repeated PDF page number.');
    numbers.add(page.page);
    if (typeof page.text !== 'string' || page.text.length > 24000) throw new Error(`PDF page ${page.page} contains too much text. Select a smaller source.`);
    if (page.imageDataUrl && (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(page.imageDataUrl) || page.imageDataUrl.length > 6000000)) throw new Error('Invalid page image.');
  }
  return {count,pages};
}
function filterBulkCards(cards, pages, count, existing=[], mode='interpretative') {
  if (!Array.isArray(cards) || cards.length > count) throw new Error('Invalid card batch.');
  const byPage = new Map(pages.map(p=>[p.page,p])); const seen = new Set(existing.map(normalizeFact)); const result=[];
  for (const card of cards) {
    if (!card || typeof card.cloze !== 'string' || card.cloze.length > 4000 || !byPage.has(card.page) || !/\{\{c1::[^{}]+\}\}/s.test(card.cloze)) continue;
    const source=byPage.get(card.page); const key=normalizeFact(card.cloze);
    if (!key || seen.has(key)) continue;
    if (mode==='interpretative' && !isSelfContainedCloze(card.cloze)) continue;
    // Text-only Verbatim cards must be exact excerpts with cloze markup inserted.
    if (mode==='verbatim' && !source.imageDataUrl) {
      const plain=card.cloze.replace(/\{\{c1::(.*?)(?:::[^{}]*?)?\}\}/gs,'$1').replace(/\s+/g,' ').trim();
      if (!source.text.replace(/\s+/g,' ').includes(plain)) continue;
    }
    seen.add(key); result.push({cloze:card.cloze.trim(),page:card.page});
  }
  return result;
}
module.exports={normalizeFact,isSelfContainedCloze,validateBulk,filterBulkCards};
