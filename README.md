# Enhanced Text Fields

A REDCap External Module that enhances REDCap text fields with editing,
validation, formatting, and preview tools for text-based content types.

## Action Tags

- `@ENHANCED-TEXT-PLAIN` adds a plain text Ace editor. It supports Notes fields.
- `@ENHANCED-TEXT-JSON` adds a JSON editor with validation and layout
  normalization. It supports text and Notes fields.
- `@ENHANCED-TEXT-MARKDOWN` adds Raw, Markdown editor, and rendered HTML preview
  modes. It supports Notes fields.
- `@ENHANCED-TEXT-CSS` adds a CSS editor with layout normalization. It supports
  text and Notes fields.
- `@ENHANCED-TEXT-INI` adds an INI editor. It supports Notes fields.
- `@ENHANCED-TEXT-R` adds an R editor. It supports Notes fields.
- `@ENHANCED-TEXT-XML` adds an XML editor with validation and layout
  normalization. It supports text and Notes fields.
- `@ENHANCED-TEXT-YAML` adds a YAML editor. It supports Notes fields.

Examples:

- `@ENHANCED-TEXT-JSON="initial:json, indent:4"`
- `@ENHANCED-TEXT-MARKDOWN="initial:html, height:240"`
- `@ENHANCED-TEXT-CSS="initial:css, format:pretty"`
- `@ENHANCED-TEXT-XML="xml-only, indent:tab, scope:all"`
- `@ENHANCED-TEXT-YAML="initial:yaml"`

## Parameters

Action-tag parameters are optional. When provided, use a quoted,
comma-separated list such as `@ENHANCED-TEXT-JSON="initial:json, height:240"`.

- `initial:*` sets the first visible mode. Use `initial:raw` for the REDCap raw
  field. Use `initial:json`, `initial:css`, `initial:xml`, `initial:ini`,
  `initial:r`, `initial:yaml`, or `initial:text` for the corresponding editor.
  Markdown also supports `initial:md` and `initial:html`.
- `height:200` sets the initial editor or preview height in pixels.
- `format:pretty` stores normalized JSON, CSS, or XML with line breaks and
  indentation when the underlying field supports newlines.
- `format:compact` stores normalized JSON, CSS, or XML without layout
  whitespace.
- `indent:2`, `indent:4`, or `indent:tab` controls pretty indentation for JSON,
  CSS, and XML. The default is two spaces.
- `scope:form`, `scope:survey`, or `scope:all` controls where the enhanced
  control is injected. `scope:form` is the default, so action tags do not affect
  surveys unless `scope:survey` or `scope:all` is specified.
- `json-only`, `md-only`, `css-only`, `xml-only`, `text-only`, `ini-only`,
  `r-only`, or `yaml-only` opens the enhanced mode and hides the Raw tab.
  `editor-only` is accepted as a generic alias for the non-Markdown Ace editor
  modes.

## Normalization

JSON, CSS, and XML editors normalize content when the enhanced editor syncs back
to the REDCap field. REDCap text fields cannot store newlines, so these modes
always store compact one-line values in text fields even when `format:pretty` is
configured.

The JSON editor always normalizes valid JSON layout in the editor itself. The
stored value uses the configured `format` for Notes fields and compact storage
for text fields.

YAML is currently edited as YAML but is not normalized by this module. YAML
indentation is therefore left exactly as entered.

There is intentionally no `raw-only` option; omit the action tag when enhanced
editing or preview should not be available.

## Future File Fields

File upload fields may later support an `@ENHANCED-TEXT-AUTO` action tag that
selects an enhancement mode from the uploaded file extension or detected text
type. This is intentionally not implemented yet.

## TODO

- Before release, rename the module folder/prefix to `enhanced_text_fields`!
