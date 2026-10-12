// Generators for Exa /search response bodies: realistic results plus
// hostile shapes (missing/wrong-typed fields, unicode, whitespace).
import { fc } from './fc.mjs';

const text = fc.oneof(
  fc.string({ unit: 'grapheme', maxLength: 80 }),
  fc.constantFrom('', '   ', '\n\t', 'é́🙂', '"quoted"', '<b>html</b>'),
  fc.string({ unit: 'grapheme', minLength: 590, maxLength: 700 }),
);
const junk = fc.oneof(fc.constant(null), fc.integer(), fc.boolean(), fc.constant([]), fc.constant({}));
const maybe = (arb) => fc.oneof({ weight: 3, arbitrary: arb }, { weight: 1, arbitrary: junk }, { weight: 1, arbitrary: fc.constant(undefined) });
// HIGHLIGHT_ENTRY is widened by the exa-b9 regression; see SPEC.md P-03.
export const highlightEntry = text;

export const resultArb = fc.oneof(
  { weight: 8, arbitrary: fc.record({
    url: maybe(fc.oneof(fc.webUrl(), fc.constant(''))),
    title: maybe(text),
    highlights: maybe(fc.array(highlightEntry, { maxLength: 4 })),
    summary: maybe(text),
    text: maybe(text),
    publishedDate: maybe(fc.oneof(fc.date({ noInvalidDate: true }).map((d) => d.toISOString()), fc.constant(''))),
  }, { requiredKeys: [] }) },
  { weight: 1, arbitrary: junk },
);

export const resultsArb = fc.oneof(
  { weight: 8, arbitrary: fc.record({ results: fc.array(resultArb, { maxLength: 12 }) }) },
  { weight: 1, arbitrary: fc.oneof(fc.constant({}), fc.constant({ results: null }), fc.constant({ results: 'x' }), fc.constant([]), fc.constant(null)) },
);
