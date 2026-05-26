# Text Viewers

A REDCap External Module that adds live JSON and Markdown viewers for text-ish
fields on data entry forms and survey pages.

## Action tags

- `@JSON-VIEWER` renders the field value as pretty-printed JSON in a read-only
  Ace viewer and reports invalid JSON.
- `@MARKDOWN-VIEWER` renders the field value as Markdown using the bundled
  `marked` asset.
