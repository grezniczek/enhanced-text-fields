# Enhanced Text Fields

Enhanced Text Fields is a REDCap External Module for working with structured or formatted text directly inside data entry forms and surveys. It enhances REDCap text boxes, Notes fields, and file upload fields with Ace-backed viewers/editors for JSON, Markdown, CSS, XML, YAML, INI, R, and plain text.

The original REDCap field remains the canonical storage location. For editable text and Notes fields, the module adds richer editing, preview, formatting, validation, resizing, row expansion, fullscreen mode, and per-user light/dark editor themes. For file upload fields, the module adds a read-only preview link when the uploaded filename matches one of the configured text formats.

## Use Cases

- Edit REDCap JSON, XML, or CSS values without leaving the data entry form.
- Render Markdown Notes fields as HTML while retaining the raw Markdown in REDCap.
- Give users fullscreen editing or preview space for long structured text.
- Preview uploaded `.json`, `.md`, `.xml`, `.yaml`, `.ini`, `.r`, `.css`, or plain-text files without downloading them first.
- Keep REDCap storage compact for text boxes while showing readable formatting in the enhanced editor.

## Installation

Install this module like any other REDCap External Module:

1. Place the module folder in REDCap's `modules` directory.  
   \- or -  
  Install the module from the REDCap External Module Repository
2. Enable the module in the REDCap Control Center.
3. Enable the module for the target project.
4. Configure the project settings described below.
5. Add the desired enhanced-text action tag(s) to REDCap fields in the Online Designer or Data Dictionary.

The module requires External Module Framework version 16 or newer.

## Project Configuration

Configure the module from the REDCap External Modules project settings dialog.

- **Output debug information to the browser console**  
  Enables module debug logging in the browser console. This is intended for development and troubleshooting.
- **Maximum file size that can be previewed**
  Limits the size of uploaded files that can be loaded into the previewer. Leave blank to use the default 10 MB limit. Use `0` for no limit. Values may be plain bytes (`1048576`) or use binary suffixes such as `512kb`, `2mb`, `512k`, or `2m`.

## Action Tags

Add one or more enhanced-text action tags to a REDCap field.

| Action tag | Text box | Notes field | File upload | Behavior |
| --- | --- | --- | --- | --- |
| `@ENHANCED-TEXT-PLAIN` | No | Yes | Yes | Plain text Ace editor or file preview. |
| `@ENHANCED-TEXT-JSON` | Yes | Yes | Yes | JSON editor/preview with validation and formatting. |
| `@ENHANCED-TEXT-MARKDOWN` | No | Yes | Yes | Markdown editor plus rendered HTML preview. |
| `@ENHANCED-TEXT-CSS` | Yes | Yes | Yes | CSS editor/preview with formatting. |
| `@ENHANCED-TEXT-INI` | No | Yes | Yes | INI editor or file preview. |
| `@ENHANCED-TEXT-R` | No | Yes | Yes | R editor or file preview. |
| `@ENHANCED-TEXT-XML` | Yes | Yes | Yes | XML editor/preview with validation and formatting. |
| `@ENHANCED-TEXT-YAML` | No | Yes | Yes | YAML editor or file preview. |

Validated REDCap text boxes are skipped. File upload fields are always view-only; signature-style file fields are skipped.

For text boxes and Notes fields, use one enhanced-text action tag per field. If multiple enhanced-text tags are present on an editable field, the module chooses the first supported enhancement in its internal mode order.

For file upload fields, multiple enhanced-text action tags are explicitly supported. The module checks the uploaded file extension and enables the matching viewer. Supported extensions are:

- CSS: `.css`
- INI: `.ini`, `.conf`
- JSON: `.json`
- Markdown: `.md`, `.markdown`
- Plain text: `.txt`, `.text`, `.log`
- R: `.r`
- XML: `.xml`
- YAML: `.yaml`, `.yml`

## Examples

- `@ENHANCED-TEXT-JSON="initial:json, indent:4"`
- `@ENHANCED-TEXT-MARKDOWN="initial:html, height:240"`
- `@ENHANCED-TEXT-CSS="initial:css, format:pretty"`
- `@ENHANCED-TEXT-XML="xml-only, indent:tab, scope:all"`
- `@ENHANCED-TEXT-YAML="initial:yaml"`
- On a file upload field: `@ENHANCED-TEXT-JSON @ENHANCED-TEXT-MARKDOWN @ENHANCED-TEXT-YAML`

## Parameters

Action-tag parameters are optional. When provided, use a double-quoted, comma-separated list such as `@ENHANCED-TEXT-JSON="initial:json, height:240"`.

Do not use unquoted or single-quoted parameter strings.

- `initial:*` sets the first visible mode. Use `initial:raw` for the REDCap raw field. Use `initial:markdown`, `initial:json`, `initial:css`, `initial:xml`, `initial:ini`, `initial:r`, `initial:yaml`, or `initial:text` for the corresponding editor. Markdown also supports `initial:html` for its rendered HTML preview. For empty Markdown fields, `initial:html` falls back to Raw.
- `height:200` sets the initial editor or preview height in pixels.
- `format:pretty` stores normalized JSON, CSS, or XML with line breaks and indentation when the underlying field supports newlines.
- `format:compact` stores normalized JSON, CSS, or XML without layout whitespace.
- `indent:2`, `indent:4`, or `indent:tab` controls pretty indentation for JSON, CSS, and XML. The default is two spaces.
- `scope:form`, `scope:survey`, or `scope:all` controls where the enhanced control is injected. `scope:form` is the default, so action tags do not affect surveys unless `scope:survey` or `scope:all` is specified.
- `json-only`, `markdown-only`, `css-only`, `xml-only`, `text-only`, `ini-only`, `r-only`, or `yaml-only` opens the enhanced mode and hides the Raw tab. `editor-only` is accepted as a generic alias for the respective editor modes.

For file upload fields, `scope` controls whether the preview link is injected on forms, surveys, or both. File previews are always read-only and do not show a Raw tab. Markdown files show Markdown and HTML tabs; other supported file types show a single read-only Ace view.

## Editing and Preview Behavior

For text boxes and Notes fields, the REDCap input or textarea remains the actual storage field. The enhanced editor syncs back only after the user edits enhanced content, which avoids false unsaved-change prompts.

The Raw tab shows REDCap's original control. Switching from Raw to an enhanced mode pulls the latest raw value into the editor or preview. Raw typing is not mirrored live into Ace until the user switches modes.

Expanded and fullscreen layouts temporarily move the toolbar and active panel, then restore them when collapsed. Light/dark theme preference is available in expanded and fullscreen toolbars and is persisted per user and per enhancement type on authenticated data entry pages.

## Normalization

JSON, CSS, and XML editors can normalize content when the enhanced editor syncs back to the REDCap field.

REDCap text boxes cannot store newlines, so JSON, CSS, and XML text boxes always store compact one-line values even when `format:pretty` is configured. Notes fields can store pretty formatting unless `format:compact` is configured.

The JSON editor always normalizes valid JSON layout in the editor itself. The stored value uses the configured `format` for Notes fields and compact storage for text boxes.

Plain text, Markdown, INI, R, and YAML are edited as text and are not normalized by this module.

There is intentionally no `raw-only` option; omit the action tag when enhanced editing or preview should not be available.

## File Upload Previews

When a file upload field has one or more matching action tags and an uploaded file is present, the module injects a **View** link beside REDCap's file controls. The link appears for files already present when the form renders and for files uploaded later through REDCap's file upload dialog. It is removed when the file is removed or when the filename extension no longer matches a configured viewer.

Clicking **View** opens a fullscreen read-only preview. The module loads the file content through its own External Module AJAX endpoint, using REDCap's document id and document hash from the generated download link for validation. If the file cannot be previewed, the viewer closes and REDCap displays an error dialog.

## Citation And Credits

If you use this module in research, regulated work, or published project infrastructure, please cite it using the metadata in `CITATION.cff`.

Enhanced Text Fields uses bundled third-party browser libraries:

- Ace Editor for code editing and syntax highlighting.
- Marked for Markdown parsing.
- highlight.js for Markdown code-block highlighting.

REDCap is developed and maintained by Vanderbilt University. This module is an independent REDCap External Module and is not part of REDCap core.

## TODO

Before public release, rename the module folder/prefix to `enhanced_text_fields`.
