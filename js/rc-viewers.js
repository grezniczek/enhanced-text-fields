/* js/rc-viewers.js */
(function (global, $) {
	'use strict';

	const NS = 'DE_RUB_SEG_TextViewersEM';
	const EM_NAME = 'Text Viewers';
	const VIEW_RAW = 'raw';
	const VIEW_MARKDOWN = 'markdown';
	const VIEW_HTML = 'html';
	const VIEW_JSON = 'json';
	const LAYOUT_NORMAL = 'normal';
	const LAYOUT_EXPANDED = 'expanded';
	const LAYOUT_FULLSCREEN = 'fullscreen';
	const MIN_MARKDOWN_HEIGHT = 100;

	if (global[NS]) {
		return;
	}

	const LOGGER = global.ConsoleDebugLogger
		? global.ConsoleDebugLogger.create({ name: EM_NAME })
		: makeFallbackLogger();

	const state = {
		config: null,
		acePromise: null,
		editors: {},
		markdownControllers: {},
		jsonControllers: {},
	};

	/**
	 * Creates a no-op logger when the debug helper is unavailable.
	 *
	 * @returns {object}
	 */
	function makeFallbackLogger() {
		return {
			configure: function () { return this; },
			log: function () { },
			info: function () { },
			warn: function () { },
			error: function () { },
		};
	}

	/**
	 * Escapes text for use in jQuery selectors.
	 *
	 * @param {string} value The unescaped selector value.
	 * @returns {string}
	 */
	function escapeSelector(value) {
		if ($.escapeSelector) {
			return $.escapeSelector(value);
		}
		return String(value).replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
	}

	/**
	 * Debounces a high-frequency event handler.
	 *
	 * @param {Function} fn Callback to debounce.
	 * @param {number} waitMs Delay in milliseconds.
	 * @returns {Function}
	 */
	function debounce(fn, waitMs) {
		let timer = null;
		return function () {
			const args = arguments;
			const ctx = this;
			clearTimeout(timer);
			timer = setTimeout(function () {
				fn.apply(ctx, args);
			}, waitMs);
		};
	}

	/**
	 * Finds a text-ish REDCap control by field name.
	 *
	 * @param {string} fieldName REDCap field name.
	 * @returns {jQuery}
	 */
	function findFieldControl(fieldName) {
		const controls = Array.prototype.slice.call(document.getElementsByName(fieldName));
		if (controls.length) {
			return $(controls).filter('textarea,input[type="text"],input:not([type])').first();
		}

		const idMatch = document.getElementById(fieldName);
		if (idMatch) {
			return $(idMatch).filter('textarea,input[type="text"],input:not([type])').first();
		}

		return $('#' + escapeSelector(fieldName)).filter('textarea,input[type="text"],input:not([type])').first();
	}

	/**
	 * Creates a small icon button.
	 *
	 * @param {string} action Action identifier.
	 * @param {string} iconClass Font Awesome icon class.
	 * @param {string} title Accessible title.
	 * @returns {jQuery}
	 */
	function createIconButton(action, iconClass, title) {
		return $('<button/>', {
			type: 'button',
			class: 'rc-text-viewer__icon-button',
			title: title,
			'aria-label': title,
			'data-rc-md-action': action,
		}).append($('<i/>', { class: iconClass, 'aria-hidden': 'true' }));
	}

	/**
	 * Creates the shared editable/readonly state indicator.
	 *
	 * @param {boolean} readonly Whether the field is readonly.
	 * @returns {jQuery}
	 */
	function createEditStateIndicator(readonly) {
		return $('<span/>', {
			class: 'rc-text-viewer-edit-state' + (readonly ? ' rc-text-viewer-edit-state--readonly' : ''),
			title: readonly ? 'Readonly' : 'Editable',
			'aria-label': readonly ? 'Readonly' : 'Editable',
		}).append(
			$('<i/>', { class: 'fa-solid fa-pencil rc-text-viewer-edit-state__pencil', 'aria-hidden': 'true' }),
			$('<i/>', { class: 'fa-solid fa-slash rc-text-viewer-edit-state__slash', 'aria-hidden': 'true' })
		);
	}

	/**
	 * Creates the viewer shell next to a REDCap field control.
	 *
	 * @param {jQuery} $control Field input or textarea.
	 * @param {string} fieldName REDCap field name.
	 * @param {string} viewerType Viewer type.
	 * @returns {jQuery}
	 */
	function createViewerShell($control, fieldName, viewerType) {
		const shellId = `rc-text-viewer-${viewerType}-${fieldName}`;
		const existing = document.getElementById(shellId);
		if (existing) {
			return $(existing);
		}

		const label = viewerType === 'json' ? 'JSON viewer' : 'Markdown preview';
		const $shell = $('<div/>', {
			id: shellId,
			class: `rc-text-viewer rc-text-viewer--${viewerType}`,
			'data-rc-text-viewer-field': fieldName,
			'data-rc-text-viewer-type': viewerType,
		});
		const $toolbar = $('<div/>', { class: 'rc-text-viewer__toolbar' });
		const $title = $('<span/>', { class: 'rc-text-viewer__title', text: label });
		const $status = $('<span/>', { class: 'rc-text-viewer__status', 'aria-live': 'polite' });
		const $body = $('<div/>', { class: 'rc-text-viewer__body' });

		$toolbar.append($title, $status);
		$shell.append($toolbar, $body);
		$control.after($shell);

		return $shell;
	}

	/**
	 * Sanitizes rendered Markdown HTML before insertion.
	 *
	 * @param {string} html Raw rendered HTML.
	 * @returns {string}
	 */
	function sanitizeHtml(html) {
		const allowedTags = {
			A: true, ABBR: true, B: true, BLOCKQUOTE: true, BR: true, CODE: true, DD: true,
			DEL: true, DETAILS: true, DIV: true, DL: true, DT: true, EM: true, H1: true,
			H2: true, H3: true, H4: true, H5: true, H6: true, HR: true, I: true, IMG: true,
			INS: true, KBD: true, LI: true, OL: true, P: true, PRE: true, S: true, SPAN: true,
			STRONG: true, SUB: true, SUMMARY: true, SUP: true, TABLE: true, TBODY: true,
			TD: true, TH: true, THEAD: true, TR: true, UL: true,
		};
		const allowedAttrs = {
			A: { href: true, title: true, target: true, rel: true },
			IMG: { src: true, alt: true, title: true, width: true, height: true },
			CODE: { class: true },
			PRE: { class: true },
			SPAN: { class: true },
			DIV: { class: true },
			TABLE: { class: true },
			TH: { align: true },
			TD: { align: true },
		};
		const urlAttrs = { href: true, src: true };
		const template = document.createElement('template');
		template.innerHTML = html;

		walk(template.content);
		return template.innerHTML;

		/**
		 * Walks and cleans a DOM node.
		 *
		 * @param {Node} node Node to sanitize.
		 * @returns {void}
		 */
		function walk(node) {
			Array.prototype.slice.call(node.childNodes).forEach(function (child) {
				if (child.nodeType === Node.ELEMENT_NODE) {
					cleanElement(child);
					walk(child);
					return;
				}
				if (child.nodeType !== Node.TEXT_NODE) {
					child.remove();
				}
			});
		}

		/**
		 * Cleans a single element in-place.
		 *
		 * @param {Element} element Element to sanitize.
		 * @returns {void}
		 */
		function cleanElement(element) {
			if (!allowedTags[element.tagName]) {
				element.replaceWith(document.createTextNode(element.textContent || ''));
				return;
			}

			const tagAttrs = allowedAttrs[element.tagName] || {};
			Array.prototype.slice.call(element.attributes).forEach(function (attr) {
				const name = attr.name.toLowerCase();
				const value = attr.value || '';
				if (name.indexOf('on') === 0 || name === 'style' || !tagAttrs[name]) {
					element.removeAttribute(attr.name);
					return;
				}
				if (urlAttrs[name] && !isSafeUrl(value)) {
					element.removeAttribute(attr.name);
				}
			});

			if (element.tagName === 'A' && element.getAttribute('target') === '_blank') {
				element.setAttribute('rel', 'noopener noreferrer');
			}
		}
	}

	/**
	 * Checks whether a URL-valued attribute is safe to render.
	 *
	 * @param {string} value URL value.
	 * @returns {boolean}
	 */
	function isSafeUrl(value) {
		const trimmed = String(value || '').trim().toLowerCase();
		return trimmed === ''
			|| trimmed.indexOf('#') === 0
			|| trimmed.indexOf('/') === 0
			|| trimmed.indexOf('http://') === 0
			|| trimmed.indexOf('https://') === 0
			|| trimmed.indexOf('mailto:') === 0;
	}

	/**
	 * Applies custom readonly handling for Markdown fields.
	 *
	 * @param {jQuery} $control Textarea control.
	 * @param {jQuery} $row REDCap field row.
	 * @returns {void}
	 */
	function applyMarkdownReadonly($control, $row) {
		$row.addClass('rc-text-viewer-readonly-row');
		$control.prop('disabled', false);
		$control.prop('readonly', true);
		$control.attr('aria-readonly', 'true');
		$control.addClass('rc-text-viewer-readonly-control');
	}

	/**
	 * Builds a Markdown controller for one textarea.
	 *
	 * @param {jQuery} $control Textarea control.
	 * @param {object} field Field configuration.
	 * @returns {object}
	 */
	function createMarkdownController($control, field) {
		const fieldName = field.name;
		const markdownConfig = field.markdown || {};
		const mdOnly = !!markdownConfig.mdOnly;
		const initialHeight = Number.isInteger(markdownConfig.height) && markdownConfig.height > 0
			? Math.max(markdownConfig.height, MIN_MARKDOWN_HEIGHT)
			: null;
		const $row = $(`tr[sq_id="${escapeSelector(fieldName)}"]`).first();
		const canExpandToRowWidth = field.rowConfig === 'split';
		const $expandLink = $('#' + escapeSelector(fieldName) + '-expand');
		const $toolbar = $('<div/>', {
			class: 'rc-text-viewer-md-toolbar d-print-none',
			'data-rc-text-viewer-field': fieldName,
		});
		const $tabs = $('<span/>', { class: 'rc-text-viewer-md-tabs' });
		const $editability = createEditStateIndicator(!!field.readonly);
		const $rawTab = $('<a/>', {
			href: 'javascript:;',
			class: 'rc-text-viewer-md-tab',
			'data-rc-md-mode': VIEW_RAW,
			text: 'Raw',
		});
		const $markdownTab = $('<a/>', {
			href: 'javascript:;',
			class: 'rc-text-viewer-md-tab',
			'data-rc-md-mode': VIEW_MARKDOWN,
			text: 'Markdown',
		});
		const $htmlTab = $('<a/>', {
			href: 'javascript:;',
			class: 'rc-text-viewer-md-tab',
			'data-rc-md-mode': VIEW_HTML,
			text: 'HTML',
		});
		const $actions = $('<span/>', { class: 'rc-text-viewer-md-actions' });
		const $expandButton = createIconButton('expand', 'fa-solid fa-arrows-left-right', 'Expand to row width');
		const $fullscreenButton = createIconButton('fullscreen', 'fa-solid fa-maximize', 'Fullscreen');
		const $collapseButton = createIconButton('collapse', 'fa-solid fa-down-left-and-up-right-to-center', 'Collapse');
		if (!canExpandToRowWidth) {
			$expandButton.addClass('rc-text-viewer-md-action--unavailable');
		}
		const $viewer = $('<div/>', {
			class: 'rc-text-viewer-md-preview',
			'data-rc-text-viewer-field': fieldName,
			tabindex: '0',
		});
		const $viewerScroll = $('<div/>', { class: 'rc-text-viewer-md-preview-scroll' });
		const $viewerContent = $('<div/>', { class: 'markdown-body rc-text-viewer-md-preview-content' });
		const editorId = `rc-text-viewer-md-ace-${fieldName}`;
		const $editorViewer = $('<div/>', {
			class: 'rc-text-viewer-md-editor',
			'data-rc-text-viewer-field': fieldName,
		});
		const $editor = $('<div/>', { id: editorId, class: 'rc-text-viewer__ace' });
		const $resizeHandle = $('<div/>', {
			class: 'rc-text-viewer-md-resize-handle',
			role: 'separator',
			'aria-orientation': 'horizontal',
			title: 'Drag to resize',
		});
		const $editorResizeHandle = $('<div/>', {
			class: 'rc-text-viewer-md-resize-handle',
			role: 'separator',
			'aria-orientation': 'horizontal',
			title: 'Drag to resize',
		});
		const $rawPanel = $('<div/>', {
			class: 'rc-text-viewer-raw-panel',
			'data-rc-text-viewer-field': fieldName,
		});
		const $rawResizeHandle = $('<div/>', {
			class: 'rc-text-viewer-md-resize-handle',
			role: 'separator',
			'aria-orientation': 'horizontal',
			title: 'Drag to resize',
		});
		const controller = {
			fieldName: fieldName,
			$control: $control,
			$row: $row,
			$expandLink: $expandLink,
			$toolbar: $toolbar,
			$viewer: $viewer,
			$viewerScroll: $viewerScroll,
			$viewerContent: $viewerContent,
			$editorViewer: $editorViewer,
			$editor: $editor,
			$rawPanel: $rawPanel,
			$resizeHandle: $resizeHandle,
			$editorResizeHandle: $editorResizeHandle,
			$rawResizeHandle: $rawResizeHandle,
			$actions: $actions,
			$expandButton: $expandButton,
			$fullscreenButton: $fullscreenButton,
			$collapseButton: $collapseButton,
			canExpandToRowWidth: canExpandToRowWidth,
			canExpandRaw: $control.is('textarea'),
			mdOnly: mdOnly,
			editor: null,
			mode: markdownConfig.initialMode === VIEW_HTML ? VIEW_HTML : (markdownConfig.initialMode === VIEW_MARKDOWN ? VIEW_MARKDOWN : VIEW_RAW),
			layout: LAYOUT_NORMAL,
			normalHeight: initialHeight || $control.outerHeight(),
			normalWidth: $control.outerWidth(),
			expandedHeight: null,
			fullscreenHeight: null,
			userHeight: initialHeight,
			restoreParent: null,
			restoreNext: null,
			$movedPanel: null,
			$dataCell: null,
			$expandedRow: null,
			bodyOverflow: null,
		};

		if (field.readonly) {
			applyMarkdownReadonly($control, $row);
		}

		if (mdOnly) {
			controller.mode = VIEW_MARKDOWN;
			$tabs.append($editability, $markdownTab, $('<span/>', { class: 'rc-text-viewer-md-tab-separator', text: '|' }), $htmlTab);
		}
		else {
			$tabs.append(
				$editability,
				$rawTab,
				$('<span/>', { class: 'rc-text-viewer-md-tab-separator', text: '|' }),
				$markdownTab,
				$('<span/>', { class: 'rc-text-viewer-md-tab-separator', text: '|' }),
				$htmlTab
			);
		}
		$actions.append($expandButton, $fullscreenButton, $collapseButton);
		$toolbar.append($tabs, $actions);
		$viewerScroll.append($viewerContent);
		$viewer.append($viewerScroll, $resizeHandle);
		$editorViewer.append($editor, $editorResizeHandle);
		$control.before($rawPanel);
		$rawPanel.append($control, $rawResizeHandle);
		$rawPanel.before($toolbar);
		$rawPanel.after($viewer);
		$viewer.after($editorViewer);

		$toolbar.on('click', '[data-rc-md-mode]', function (ev) {
			ev.preventDefault();
			const mode = $(this).attr('data-rc-md-mode');
			if (mode !== controller.mode) {
				setMarkdownMode(controller, mode);
			}
		});
		$toolbar.on('click', '[data-rc-md-action]', function (ev) {
			ev.preventDefault();
			handleMarkdownAction(controller, $(this).attr('data-rc-md-action'));
		});
		$control.on('input change keyup', debounce(function () {
			renderMarkdown(controller);
		}, 100));
		initMarkdownResizeHandle(controller);
		initMarkdownEditor(controller, editorId, field);
		$(global).on('resize', debounce(function () {
			if ((controller.mode === VIEW_MARKDOWN || controller.mode === VIEW_HTML) && controller.layout === LAYOUT_NORMAL) {
				syncMarkdownNormalSize(controller, false);
			}
		}, 100));

		setMarkdownMode(controller, controller.mode);
		return controller;
	}

	/**
	 * Handles Markdown action buttons.
	 *
	 * @param {object} controller Markdown controller.
	 * @param {string} action Action identifier.
	 * @returns {void}
	 */
	function handleMarkdownAction(controller, action) {
		if (action === 'expand') {
			expandMarkdown(controller);
		}
		if (action === 'fullscreen') {
			fullscreenMarkdown(controller);
		}
		if (action === 'collapse') {
			collapseMarkdown(controller);
		}
	}

	/**
	 * Sets the visible Markdown field mode.
	 *
	 * @param {object} controller Markdown controller.
	 * @param {string} mode Desired mode.
	 * @returns {void}
	 */
	function setMarkdownMode(controller, mode) {
		if (mode === VIEW_HTML) {
			mode = VIEW_HTML;
		}
		else if (controller.mdOnly || mode === VIEW_MARKDOWN) {
			mode = VIEW_MARKDOWN;
		}
		else {
			mode = VIEW_RAW;
		}

		const previousMode = controller.mode;
		const previousLayout = controller.layout;
		if (previousMode !== mode && previousLayout !== LAYOUT_NORMAL) {
			rememberMarkdownHeight(controller);
			restoreMarkdownLayout(controller);
		}

		controller.mode = mode;
		if (mode === VIEW_RAW) {
			syncMarkdownNormalSize(controller, true);
			showRawMode(controller);
		}
		else if (mode === VIEW_MARKDOWN) {
			syncMarkdownNormalSize(controller, true);
			showMarkdownEditorMode(controller);
		}
		else {
			syncMarkdownNormalSize(controller, true);
			showHtmlMode(controller);
			renderMarkdown(controller);
		}

		updateMarkdownToolbar(controller);
		if (previousMode !== mode && previousLayout === LAYOUT_EXPANDED) {
			expandMarkdown(controller);
		}
		if (previousMode !== mode && previousLayout === LAYOUT_FULLSCREEN) {
			fullscreenMarkdown(controller);
		}
	}

	/**
	 * Shows the original REDCap raw textarea state.
	 *
	 * @param {object} controller Markdown controller.
	 * @returns {void}
	 */
	function showRawMode(controller) {
		if (controller.layout === LAYOUT_NORMAL) {
			restoreDataCellContents(controller);
		}
		controller.$control.show();
		controller.$rawPanel.css('display', 'flex');
		controller.$expandLink.hide();
		controller.$viewer.css('display', 'none');
		controller.$editorViewer.css('display', 'none');
	}

	/**
	 * Shows the normal Markdown editor state.
	 *
	 * @param {object} controller Markdown controller.
	 * @returns {void}
	 */
	function showMarkdownEditorMode(controller) {
		if (controller.layout === LAYOUT_NORMAL) {
			restoreDataCellContents(controller);
		}
		controller.$control.hide();
		controller.$rawPanel.css('display', 'none');
		controller.$expandLink.hide();
		controller.$viewer.css('display', 'none');
		controller.$editorViewer.css('display', 'flex');
		if (controller.editor) {
			controller.editor.resize();
		}
	}

	/**
	 * Shows the rendered Markdown HTML preview state.
	 *
	 * @param {object} controller Markdown controller.
	 * @returns {void}
	 */
	function showHtmlMode(controller) {
		if (controller.layout === LAYOUT_NORMAL) {
			restoreDataCellContents(controller);
		}
		controller.$control.hide();
		controller.$rawPanel.css('display', 'none');
		controller.$expandLink.hide();
		controller.$editorViewer.css('display', 'none');
		controller.$viewer.css('display', 'flex');
	}

	/**
	 * Updates toolbar active states and visible action buttons.
	 *
	 * @param {object} controller Markdown controller.
	 * @returns {void}
	 */
	function updateMarkdownToolbar(controller) {
		LOGGER.log(`Updating Markdown toolbar for '${controller.fieldName}' in mode '${controller.mode}' and layout '${controller.layout}'`, controller);
		controller.$toolbar.find('[data-rc-md-mode]').each(function () {
			const $tab = $(this);
			const active = $tab.attr('data-rc-md-mode') === controller.mode;
			$tab.toggleClass('active', active);
			$tab.attr('aria-current', active ? 'true' : 'false');
		});
		const isPanelMode = controller.mode === VIEW_MARKDOWN || controller.mode === VIEW_HTML || (controller.mode === VIEW_RAW && controller.canExpandRaw);
		controller.$actions[isPanelMode ? 'show' : 'hide']();
		controller.$expandButton[isPanelMode && controller.canExpandToRowWidth && controller.layout !== LAYOUT_EXPANDED ? 'show' : 'hide']();
		controller.$fullscreenButton[isPanelMode && controller.layout !== LAYOUT_FULLSCREEN ? 'show' : 'hide']();
		controller.$collapseButton[isPanelMode && (controller.layout === LAYOUT_FULLSCREEN || controller.layout === LAYOUT_EXPANDED) ? 'show' : 'hide']();
		controller.$toolbar
			.attr('data-rc-md-layout', controller.layout)
			.toggleClass('rc-text-viewer-md-toolbar--markdown', isPanelMode);
	}

	/**
	 * Renders current textarea Markdown into the preview.
	 *
	 * @param {object} controller Markdown controller.
	 * @returns {void}
	 */
	function renderMarkdown(controller) {
		const markdown = controller.$control.val() || '';
		if (!global.marked || typeof global.marked.parse !== 'function') {
			controller.$viewerContent.html($('<pre/>').text(markdown));
			return;
		}

		try {
			const html = global.marked.parse(markdown, { breaks: true, gfm: true });
			controller.$viewerContent.html(sanitizeHtml(html));
			if (global.hljs) {
				controller.$viewerContent.find('pre code').each(function () {
					global.hljs.highlightElement(this);
				});
			}
		}
		catch (e) {
			controller.$viewerContent.html($('<pre/>').text(markdown));
			LOGGER.warn('Markdown render failed', controller.fieldName, e);
		}
	}

	/**
	 * Initializes the Ace-backed Markdown source editor.
	 *
	 * @param {object} controller Markdown controller.
	 * @param {string} editorId Ace editor element id.
	 * @param {object} field Field configuration.
	 * @returns {void}
	 */
	function initMarkdownEditor(controller, editorId, field) {
		ensureScript(state.config.urls.ace, function () {
			return !!global.ace;
		}).then(function () {
			const editor = global.ace.edit(editorId);
			controller.editor = editor;
			state.editors[`${controller.fieldName}-markdown`] = editor;
			editor.setTheme('ace/theme/textmate');
			editor.setReadOnly(!!field.readonly);
			editor.setShowPrintMargin(false);
			editor.setHighlightActiveLine(false);
			editor.session.setUseWorker(false);
			editor.renderer.setShowGutter(true);
			editor.renderer.setScrollMargin(6, 6, 0, 0);
			editor.setValue(controller.$control.val() || '', -1);
			editor.session.on('change', debounce(function () {
				if (editor.getReadOnly()) {
					return;
				}
				controller.$control.val(editor.getValue()).trigger('change');
				renderMarkdown(controller);
			}, 100));
			controller.$control.on('input change keyup', debounce(function () {
				if (editor.getValue() !== (controller.$control.val() || '')) {
					editor.setValue(controller.$control.val() || '', -1);
				}
			}, 100));
			editor.resize();
		}).catch(function (e) {
			LOGGER.warn('Ace failed to load for Markdown editor', e);
		});
	}

	/**
	 * Initializes the full-width Markdown resize handle.
	 *
	 * @param {object} controller Markdown controller.
	 * @returns {void}
	 */
	function initMarkdownResizeHandle(controller) {
		controller.$resizeHandle.add(controller.$editorResizeHandle).add(controller.$rawResizeHandle).on('mousedown', function (ev) {
			if (controller.layout === LAYOUT_FULLSCREEN) {
				return;
			}
			ev.preventDefault();
			const startY = ev.pageY;
			const startHeight = getMarkdownActivePanel(controller).outerHeight();

			$(document).on('mousemove.rcTextViewerResize', function (moveEv) {
				const nextHeight = Math.max(MIN_MARKDOWN_HEIGHT, startHeight + (moveEv.pageY - startY));
				setMarkdownViewerHeight(controller, nextHeight);
			});
			$(document).on('mouseup.rcTextViewerResize', function () {
				$(document).off('.rcTextViewerResize');
			});
		}).on('dblclick', function (ev) {
			ev.preventDefault();
			expandMarkdownToContent(controller);
		});
	}

	/**
	 * Stores the current viewer height for its active layout.
	 *
	 * @param {object} controller Markdown controller.
	 * @returns {void}
	 */
	function rememberMarkdownHeight(controller) {
		const height = getMarkdownActivePanel(controller).outerHeight();
		if (!height) {
			return;
		}
		if (controller.layout === LAYOUT_NORMAL) {
			controller.normalHeight = height;
		}
		if (controller.layout === LAYOUT_EXPANDED) {
			controller.expandedHeight = height;
		}
		if (controller.layout === LAYOUT_FULLSCREEN) {
			controller.fullscreenHeight = height;
		}
	}

	/**
	 * Sets and remembers the viewer height for its active layout.
	 *
	 * @param {object} controller Markdown controller.
	 * @param {number} height Viewer height in pixels.
	 * @returns {void}
	 */
	function setMarkdownViewerHeight(controller, height) {
		height = Math.max(MIN_MARKDOWN_HEIGHT, Math.floor(height));
		controller.$viewer.add(controller.$editorViewer).add(controller.$rawPanel).css({
			height: height + 'px',
			'min-height': MIN_MARKDOWN_HEIGHT + 'px',
		});
		controller.$control.css('min-height', '');
		controller.$editor.css('min-height', '');
		if (controller.layout === LAYOUT_NORMAL) {
			controller.normalHeight = height;
			controller.expandedHeight = height;
			controller.userHeight = height;
		}
		if (controller.layout === LAYOUT_EXPANDED) {
			controller.normalHeight = height;
			controller.expandedHeight = height;
			controller.userHeight = height;
		}
		if (controller.layout === LAYOUT_FULLSCREEN) {
			controller.fullscreenHeight = height;
		}
		if (controller.editor) {
			controller.editor.resize();
		}
	}

	/**
	 * Mirrors the textarea footprint for normal Markdown mode.
	 *
	 * @param {object} controller Markdown controller.
	 * @param {boolean} captureHeight Whether to update the remembered normal height.
	 * @returns {void}
	 */
	function syncMarkdownNormalSize(controller, captureHeight) {
		if (controller.layout !== LAYOUT_NORMAL) {
			return;
		}

		const measuredWidth = controller.$control.is(':visible') ? controller.$control.outerWidth() : 0;
		const measuredHeight = controller.$control.is(':visible') ? controller.$control.outerHeight() : 0;
		const width = measuredWidth || controller.normalWidth || controller.$control.parent().width() || 200;
		const cssWidth = controller.canExpandToRowWidth ? width + 'px' : '100%';
		const height = Math.max(controller.userHeight || measuredHeight || controller.normalHeight || MIN_MARKDOWN_HEIGHT, MIN_MARKDOWN_HEIGHT);
		if (measuredWidth) {
			controller.normalWidth = measuredWidth;
		}
		if (captureHeight && measuredHeight && !controller.normalHeight && !controller.userHeight) {
			controller.normalHeight = measuredHeight;
		}
		else if (!controller.normalHeight) {
			controller.normalHeight = height;
		}
		controller.$toolbar.css('width', cssWidth);
		controller.$viewer.css({
			width: cssWidth,
			height: height + 'px',
			'min-height': MIN_MARKDOWN_HEIGHT + 'px',
			'margin-left': '',
		});
		controller.$editorViewer.css({
			width: cssWidth,
			height: height + 'px',
			'min-height': MIN_MARKDOWN_HEIGHT + 'px',
			'margin-left': '',
		});
		controller.$rawPanel.css({
			width: cssWidth,
			height: height + 'px',
			'min-height': MIN_MARKDOWN_HEIGHT + 'px',
			'margin-left': '',
		});
		controller.$control.css('min-height', '');
		controller.$editor.css('min-height', '');
		controller.$toolbar.css({
			width: cssWidth,
			'margin-left': '',
		});
		if (controller.editor) {
			controller.editor.resize();
		}
	}

	/**
	 * Expands the Markdown preview to the full REDCap field row width.
	 *
	 * @param {object} controller Markdown controller.
	 * @returns {void}
	 */
	function expandMarkdown(controller) {
		if (!controller.canExpandToRowWidth) {
			return;
		}
		if (controller.mode !== VIEW_RAW && controller.mode !== VIEW_MARKDOWN && controller.mode !== VIEW_HTML) {
			setMarkdownMode(controller, VIEW_HTML);
		}
		if (controller.layout !== LAYOUT_NORMAL) {
			rememberMarkdownHeight(controller);
			restoreMarkdownLayout(controller);
		}

		const $panel = getMarkdownActivePanel(controller);
		const $target = getMarkdownExpandTarget(controller);
		const $expandedCell = createExpandedRow(controller);
		const rowWidth = Math.max((controller.$row.length ? controller.$row.outerWidth() : $target.outerWidth()), $panel.outerWidth());
		const currentHeight = $panel.outerHeight();
		const expandedHeight = controller.userHeight || controller.expandedHeight || Math.max(currentHeight, Math.floor(rowWidth / 2));
		captureMarkdownPlacement(controller);
		$expandedCell.append(controller.$toolbar);
		$expandedCell.append($panel);
		hideDataCellContents(controller, $target);
		controller.$toolbar.css({
			width: '100%',
			'margin-left': '',
		});
		$panel.css({
			width: '100%',
			height: expandedHeight + 'px',
			'min-height': MIN_MARKDOWN_HEIGHT + 'px',
			'margin-left': '',
		});
		controller.layout = LAYOUT_EXPANDED;
		controller.$toolbar.addClass('rc-text-viewer-md-toolbar--expanded');
		$panel.addClass('rc-text-viewer-md-preview--expanded');
		updateMarkdownToolbar(controller);
	}

	/**
	 * Opens the Markdown preview in a fullscreen overlay.
	 *
	 * @param {object} controller Markdown controller.
	 * @returns {void}
	 */
	function fullscreenMarkdown(controller) {
		if (controller.mode !== VIEW_RAW && controller.mode !== VIEW_MARKDOWN && controller.mode !== VIEW_HTML) {
			setMarkdownMode(controller, VIEW_HTML);
		}
		if (controller.layout !== LAYOUT_FULLSCREEN) {
			rememberMarkdownHeight(controller);
		}
		if (controller.layout !== LAYOUT_FULLSCREEN) {
			captureMarkdownPlacement(controller);
		}
		const $panel = getMarkdownActivePanel(controller);
		controller.bodyOverflow = $('body').css('overflow');
		$('body').css('overflow', 'hidden');
		$('body').append(controller.$toolbar);
		$('body').append($panel);
		const fullscreenHeight = controller.fullscreenHeight || Math.max($panel.outerHeight(), $(global).height() - 64);
		controller.$toolbar.css({
			width: '',
			'margin-left': '',
		});
		$panel.css({
			width: '',
			height: fullscreenHeight + 'px',
			'min-height': '',
			'margin-left': '',
		});
		controller.layout = LAYOUT_FULLSCREEN;
		controller.$toolbar.removeClass('rc-text-viewer-md-toolbar--expanded');
		controller.$toolbar.addClass('rc-text-viewer-md-toolbar--fullscreen');
		$panel.removeClass('rc-text-viewer-md-preview--expanded');
		$panel.addClass('rc-text-viewer-md-preview--fullscreen');
		if (controller.editor) {
			controller.editor.resize();
		}
		updateMarkdownToolbar(controller);
	}

	/**
	 * Collapses an expanded/fullscreen Markdown preview.
	 *
	 * @param {object} controller Markdown controller.
	 * @returns {void}
	 */
	function collapseMarkdown(controller) {
		if (controller.layout === LAYOUT_NORMAL) {
			updateMarkdownToolbar(controller);
			return;
		}
		rememberMarkdownHeight(controller);
		restoreMarkdownLayout(controller);
		syncMarkdownNormalSize(controller, false);
		if (controller.mode === VIEW_RAW) {
			showRawMode(controller);
		}
		else if (controller.mode === VIEW_MARKDOWN) {
			showMarkdownEditorMode(controller);
		}
		else {
			showHtmlMode(controller);
		}
		updateMarkdownToolbar(controller);
	}

	/**
	 * Creates or returns the dedicated expanded Markdown table row.
	 *
	 * @param {object} controller Markdown controller.
	 * @returns {jQuery}
	 */
	function createExpandedRow(controller) {
		if (controller.$expandedRow && controller.$expandedRow.length) {
			return controller.$expandedRow.find('td').first();
		}

		const colSpan = Math.max(controller.$row.children('td,th').length, 1);
		const $cell = $('<td/>', {
			class: 'rc-text-viewer-md-expanded-cell',
			colspan: colSpan,
		});
		controller.$expandedRow = $('<tr/>', {
			class: 'rc-text-viewer-md-expanded-row',
			'data-rc-text-viewer-expanded-for': controller.fieldName,
		}).append($cell);
		controller.$row.after(controller.$expandedRow);
		return $cell;
	}

	/**
	 * Returns the container used for row-expanded Markdown mode.
	 *
	 * @param {object} controller Markdown controller.
	 * @returns {jQuery}
	 */
	function getMarkdownExpandTarget(controller) {
		let $target = controller.$row.length ? controller.$row.find('td.data').last() : controller.$control.closest('td');
		if (!$target.length && controller.$row.length) {
			$target = controller.$row.find('td').last();
		}
		if (!$target.length) {
			$target = controller.$control.parent();
		}
		if (
			$target[0] === controller.$toolbar[0]
			|| $target[0] === controller.$viewer[0]
			|| (controller.$editorViewer && $target[0] === controller.$editorViewer[0])
			|| (controller.$rawPanel && $target[0] === controller.$rawPanel[0])
			|| $.contains(controller.$toolbar[0], $target[0])
			|| $.contains(controller.$viewer[0], $target[0])
			|| (controller.$editorViewer && $.contains(controller.$editorViewer[0], $target[0]))
			|| (controller.$rawPanel && $.contains(controller.$rawPanel[0], $target[0]))
		) {
			$target = controller.$control.parent();
		}
		return $target;
	}

	/**
	 * Restores moved Markdown toolbar and preview from expanded/fullscreen layouts.
	 *
	 * @param {object} controller Markdown controller.
	 * @returns {void}
	 */
	function restoreMarkdownLayout(controller) {
		restoreMarkdownPlacement(controller);
		restoreDataCellContents(controller);
		if (controller.$expandedRow && controller.$expandedRow.length) {
			controller.$expandedRow.remove();
			controller.$expandedRow = null;
		}
		controller.layout = LAYOUT_NORMAL;
		controller.$toolbar.removeClass('rc-text-viewer-md-toolbar--expanded rc-text-viewer-md-toolbar--fullscreen');
		controller.$viewer.add(controller.$editorViewer).removeClass('rc-text-viewer-md-preview--expanded rc-text-viewer-md-preview--fullscreen');
		controller.$rawPanel.removeClass('rc-text-viewer-md-preview--expanded rc-text-viewer-md-preview--fullscreen');
		if (controller.bodyOverflow !== null) {
			$('body').css('overflow', controller.bodyOverflow);
			controller.bodyOverflow = null;
		}
	}

	/**
	 * Temporarily hides original data-cell contents while row-expanded.
	 *
	 * @param {object} controller Markdown controller.
	 * @param {jQuery} $dataCell Original REDCap data cell.
	 * @returns {void}
	 */
	function hideDataCellContents(controller, $dataCell) {
		controller.$dataCell = $dataCell;
		$dataCell.children().each(function () {
			const $child = $(this);
			if (
				$child[0] === controller.$toolbar[0]
				|| $child[0] === controller.$viewer[0]
				|| (controller.$editorViewer && $child[0] === controller.$editorViewer[0])
				|| (controller.$rawPanel && $child[0] === controller.$rawPanel[0])
			) {
				return;
			}
			if (typeof $child.data('rcTextViewerOriginalDisplay') === 'undefined') {
				$child.data('rcTextViewerOriginalDisplay', this.style.display || '');
			}
			$child.hide();
		});
	}

	/**
	 * Restores original data-cell contents after row-expanded mode.
	 *
	 * @param {object} controller Markdown controller.
	 * @returns {void}
	 */
	function restoreDataCellContents(controller) {
		if (!controller.$dataCell || !controller.$dataCell.length) {
			return;
		}
		controller.$dataCell.children().each(function () {
			const $child = $(this);
			const originalDisplay = $child.data('rcTextViewerOriginalDisplay');
			if (typeof originalDisplay === 'undefined') {
				return;
			}
			this.style.display = originalDisplay;
			$child.removeData('rcTextViewerOriginalDisplay');
		});
		controller.$dataCell = null;
	}

	/**
	 * Captures the current preview DOM position.
	 *
	 * @param {object} controller Markdown controller.
	 * @returns {void}
	 */
	function captureMarkdownPlacement(controller) {
		if (controller.restoreParent) {
			return;
		}
		const $panel = getMarkdownActivePanel(controller);
		controller.$movedPanel = $panel;
		controller.restoreParent = $panel.parent()[0];
		controller.restoreNext = $panel[0].nextSibling;
	}

	/**
	 * Restores the preview to its original DOM position.
	 *
	 * @param {object} controller Markdown controller.
	 * @returns {void}
	 */
	function restoreMarkdownPlacement(controller) {
		if (!controller.restoreParent) {
			return;
		}
		const $panel = controller.$movedPanel || getMarkdownActivePanel(controller);
		if (controller.restoreNext) {
			controller.restoreParent.insertBefore($panel[0], controller.restoreNext);
		}
		else {
			controller.restoreParent.appendChild($panel[0]);
		}
		const $toolbarAnchor = controller.$rawPanel && controller.$rawPanel.parent().length ? controller.$rawPanel : controller.$control;
		$toolbarAnchor.before(controller.$toolbar);
		controller.restoreParent = null;
		controller.restoreNext = null;
		controller.$movedPanel = null;
	}

	/**
	 * Returns the active enhanced Markdown panel.
	 *
	 * @param {object} controller Markdown controller.
	 * @returns {jQuery}
	 */
	function getMarkdownActivePanel(controller) {
		if (controller.mode === VIEW_RAW) {
			return controller.$rawPanel;
		}
		return controller.mode === VIEW_MARKDOWN ? controller.$editorViewer : controller.$viewer;
	}

	/**
	 * Expands the active Markdown panel to fit its content vertically.
	 *
	 * @param {object} controller Markdown controller.
	 * @returns {void}
	 */
	function expandMarkdownToContent(controller) {
		let contentHeight = MIN_MARKDOWN_HEIGHT;
		if (controller.mode === VIEW_RAW) {
			const control = controller.$control[0];
			contentHeight = control ? control.scrollHeight + controller.$rawResizeHandle.outerHeight() : contentHeight;
		}
		else if (controller.mode === VIEW_MARKDOWN && controller.editor) {
			const lineHeight = controller.editor.renderer.lineHeight || 16;
			contentHeight = (controller.editor.session.getScreenLength() * lineHeight) + 24;
		}
		else if (controller.mode === VIEW_HTML) {
			contentHeight = controller.$viewerContent.outerHeight(true) + controller.$resizeHandle.outerHeight() + 24;
		}
		setMarkdownViewerHeight(controller, contentHeight);
	}

	/**
	 * Renders a Markdown viewer and wires it to field changes.
	 *
	 * @param {jQuery} $control Field textarea.
	 * @param {object} field Field configuration.
	 * @returns {void}
	 */
	function attachMarkdownViewer($control, field) {
		if (!$control.is('textarea')) {
			LOGGER.warn('Markdown viewer skipped for non-textarea field', field.name);
			return;
		}
		state.markdownControllers[field.name] = createMarkdownController($control, field);
	}

	/**
	 * Ensures a script URL is available.
	 *
	 * @param {string} url Script URL.
	 * @param {Function} isReady Ready check.
	 * @returns {Promise}
	 */
	function ensureScript(url, isReady) {
		if (isReady()) {
			return Promise.resolve();
		}
		if (state.acePromise) {
			return state.acePromise;
		}
		state.acePromise = new Promise(function (resolve, reject) {
			const script = document.createElement('script');
			script.src = url;
			script.type = 'text/javascript';
			script.onload = function () { resolve(); };
			script.onerror = function () { reject(new Error('Unable to load ' + url)); };
			document.head.appendChild(script);
		});
		return state.acePromise;
	}

	/**
	 * Returns formatted JSON text and validation state.
	 *
	 * @param {string} raw Raw field value.
	 * @param {string} format Storage/display format.
	 * @returns {object}
	 */
	function formatJson(raw, format) {
		const text = String(raw || '').trim();
		if (text === '') {
			return { ok: true, empty: true, text: '' };
		}
		try {
			const parsed = JSON.parse(text);
			return { ok: true, empty: false, text: stringifyJson(parsed, format) };
		}
		catch (e) {
			return { ok: false, empty: false, text: raw, error: e.message || String(e) };
		}
	}

	/**
	 * Serializes parsed JSON using the requested format.
	 *
	 * @param {any} parsed Parsed JSON value.
	 * @param {string} format Storage/display format.
	 * @returns {string}
	 */
	function stringifyJson(parsed, format) {
		return JSON.stringify(parsed, null, format === 'compact' ? 0 : 2);
	}

	/**
	 * Builds a JSON controller for one text field.
	 *
	 * @param {jQuery} $control Field input or textarea.
	 * @param {object} field Field configuration.
	 * @returns {object}
	 */
	function createJsonController($control, field) {
		const fieldName = field.name;
		const jsonConfig = field.json || {};
		const jsonOnly = !!jsonConfig.jsonOnly;
		const storageFormat = $control.is('textarea') && jsonConfig.format !== 'compact' ? 'pretty' : 'compact';
		const displayFormat = 'pretty';
		const initialHeight = Number.isInteger(jsonConfig.height) && jsonConfig.height > 0
			? Math.max(jsonConfig.height, MIN_MARKDOWN_HEIGHT)
			: null;
		const $expandLink = $('#' + escapeSelector(fieldName) + '-expand');
		const editorId = `rc-text-viewer-ace-${fieldName}`;
		const $toolbar = $('<div/>', {
			class: 'rc-text-viewer-md-toolbar rc-text-viewer-json-toolbar d-print-none',
			'data-rc-text-viewer-field': fieldName,
		});
		const $tabs = $('<span/>', { class: 'rc-text-viewer-md-tabs' });
		const $editability = createEditStateIndicator(!!field.readonly);
		const $rawTab = $('<a/>', {
			href: 'javascript:;',
			class: 'rc-text-viewer-md-tab',
			'data-rc-json-mode': VIEW_RAW,
			text: 'Raw',
		});
		const $jsonTab = $('<a/>', {
			href: 'javascript:;',
			class: 'rc-text-viewer-md-tab',
			'data-rc-json-mode': VIEW_JSON,
			text: 'JSON',
		});
		const $status = $('<span/>', {
			class: 'rc-text-viewer-json-status',
			'aria-live': 'polite',
		});
		const $actions = $('<span/>', { class: 'rc-text-viewer-md-actions' });
		const $expandButton = createIconButton('expand', 'fa-solid fa-arrows-left-right', 'Expand to row width');
		const $fullscreenButton = createIconButton('fullscreen', 'fa-solid fa-maximize', 'Fullscreen');
		const $collapseButton = createIconButton('collapse', 'fa-solid fa-down-left-and-up-right-to-center', 'Collapse');
		if (field.rowConfig !== 'split') {
			$expandButton.addClass('rc-text-viewer-md-action--unavailable');
		}
		const $viewer = $('<div/>', {
			class: 'rc-text-viewer-json-preview',
			'data-rc-text-viewer-field': fieldName,
		});
		const $editor = $('<div/>', { id: editorId, class: 'rc-text-viewer__ace' });
		const $resizeHandle = $('<div/>', {
			class: 'rc-text-viewer-md-resize-handle',
			role: 'separator',
			'aria-orientation': 'horizontal',
			title: 'Drag to resize',
		});
		const $rawPanel = $('<div/>', {
			class: 'rc-text-viewer-raw-panel',
			'data-rc-text-viewer-field': fieldName,
		});
		const $rawResizeHandle = $('<div/>', {
			class: 'rc-text-viewer-md-resize-handle',
			role: 'separator',
			'aria-orientation': 'horizontal',
			title: 'Drag to resize',
		});
		const canExpandRaw = $control.is('textarea');
		const controller = {
			fieldName: fieldName,
			$control: $control,
			$row: $(`tr[sq_id="${escapeSelector(fieldName)}"]`).first(),
			$expandLink: $expandLink,
			$toolbar: $toolbar,
			$viewer: $viewer,
			$editor: $editor,
			$rawPanel: $rawPanel,
			$resizeHandle: $resizeHandle,
			$rawResizeHandle: $rawResizeHandle,
			$status: $status,
			$actions: $actions,
			$expandButton: $expandButton,
			$fullscreenButton: $fullscreenButton,
			$collapseButton: $collapseButton,
			editor: null,
			jsonOnly: jsonOnly,
			displayFormat: displayFormat,
			storageFormat: storageFormat,
			rowConfig: field.rowConfig === 'full' ? 'full' : 'split',
			canExpandToRowWidth: field.rowConfig === 'split',
			canExpandRaw: canExpandRaw,
			mode: jsonConfig.initialMode === VIEW_JSON ? VIEW_JSON : VIEW_RAW,
			layout: LAYOUT_NORMAL,
			height: initialHeight || $control.outerHeight() || MIN_MARKDOWN_HEIGHT,
			width: $control.outerWidth(),
			expandedHeight: null,
			fullscreenHeight: null,
			userHeight: initialHeight,
			restoreParent: null,
			restoreNext: null,
			$dataCell: null,
			$expandedRow: null,
			bodyOverflow: null,
			updatingEditor: false,
			updatingControl: false,
			skipNextControlRender: false,
		};

		if (field.readonly) {
			applyMarkdownReadonly($control, $control.closest('tr'));
		}

		if (jsonOnly) {
			controller.mode = VIEW_JSON;
			$tabs.append($editability, $jsonTab, $status);
		}
		else {
			$tabs.append($editability, $rawTab, $('<span/>', { class: 'rc-text-viewer-md-tab-separator', text: '|' }), $jsonTab, $status);
		}
		$actions.append($expandButton, $fullscreenButton, $collapseButton);
		$toolbar.append($tabs, $actions);
		$viewer.append($editor, $resizeHandle);
		if (canExpandRaw) {
			$control.before($rawPanel);
			$rawPanel.append($control, $rawResizeHandle);
			$rawPanel.before($toolbar);
			$rawPanel.after($viewer);
		}
		else {
			$control.before($toolbar);
			$control.after($viewer);
		}

		$toolbar.on('click', '[data-rc-json-mode]', function (ev) {
			ev.preventDefault();
			const mode = $(this).attr('data-rc-json-mode');
			if (mode !== controller.mode) {
				setJsonMode(controller, mode);
			}
		});
		$toolbar.on('click', '[data-rc-md-action]', function (ev) {
			ev.preventDefault();
			handleJsonAction(controller, $(this).attr('data-rc-md-action'));
		});
		$control.on('input change keyup', debounce(function () {
			if (controller.skipNextControlRender) {
				controller.skipNextControlRender = false;
				return;
			}
			if (!controller.updatingControl) {
				renderJsonFromControl(controller);
			}
		}, 100));

		ensureScript(state.config.urls.ace, function () {
			return !!global.ace;
		}).then(function () {
			const editor = global.ace.edit(editorId);
			controller.editor = editor;
			state.editors[fieldName] = editor;
			editor.setTheme('ace/theme/textmate');
			editor.setReadOnly(!!field.readonly);
			editor.setShowPrintMargin(false);
			editor.setHighlightActiveLine(false);
			editor.session.setUseWorker(false);
			editor.renderer.setShowGutter(true);
			editor.renderer.setScrollMargin(6, 6, 0, 0);
			editor.session.on('change', debounce(function () {
				syncJsonFromEditor(controller);
			}, 100));
			editor.on('blur', function () {
				normalizeJsonEditor(controller);
			});
			renderJsonFromControl(controller);
			syncJsonSize(controller);
			editor.resize();
		}).catch(function (e) {
			const formatted = formatJson($control.val() || '', controller.displayFormat);
			$viewer.html($('<pre/>', { class: 'rc-text-viewer__fallback' }).text(formatted.text));
			setJsonStatus(controller, formatted);
			LOGGER.warn('Ace failed to load', e);
		});

		initJsonResizeHandle(controller);
		setJsonMode(controller, controller.mode);
		return controller;
	}

	/**
	 * Sets the visible JSON field mode.
	 *
	 * @param {object} controller JSON controller.
	 * @param {string} mode Desired mode.
	 * @returns {void}
	 */
	function setJsonMode(controller, mode) {
		if (controller.jsonOnly || mode === VIEW_JSON) {
			mode = VIEW_JSON;
		}
		else {
			mode = VIEW_RAW;
		}

		const previousMode = controller.mode;
		const previousLayout = controller.layout;
		if (previousMode !== mode && previousLayout !== LAYOUT_NORMAL) {
			rememberJsonHeight(controller);
			restoreJsonLayout(controller);
		}
		controller.mode = mode;
		if (mode === VIEW_RAW) {
			normalizeJsonEditor(controller);
			syncJsonSize(controller);
			controller.$control.show();
			controller.$rawPanel.css('display', controller.canExpandRaw ? 'flex' : 'none');
			controller.$expandLink.hide();
			controller.$viewer.css('display', 'none');
		}
		else {
			syncJsonSize(controller);
			controller.$control.hide();
			controller.$rawPanel.css('display', 'none');
			controller.$expandLink.hide();
			controller.$viewer.css('display', 'flex');
			if (controller.editor) {
				controller.editor.resize();
			}
		}
		updateJsonToolbar(controller);
		if (previousMode !== mode && previousLayout === LAYOUT_EXPANDED) {
			expandJson(controller);
		}
		if (previousMode !== mode && previousLayout === LAYOUT_FULLSCREEN) {
			fullscreenJson(controller);
		}
	}

	/**
	 * Handles JSON action buttons.
	 *
	 * @param {object} controller JSON controller.
	 * @param {string} action Action identifier.
	 * @returns {void}
	 */
	function handleJsonAction(controller, action) {
		if (action === 'expand') {
			expandJson(controller);
		}
		if (action === 'fullscreen') {
			fullscreenJson(controller);
		}
		if (action === 'collapse') {
			collapseJson(controller);
		}
	}

	/**
	 * Updates JSON toolbar active state.
	 *
	 * @param {object} controller JSON controller.
	 * @returns {void}
	 */
	function updateJsonToolbar(controller) {
		const isJson = controller.mode === VIEW_JSON;
		const isPanelMode = isJson || (controller.mode === VIEW_RAW && controller.canExpandRaw);
		controller.$toolbar.find('[data-rc-json-mode]').each(function () {
			const $tab = $(this);
			const active = $tab.attr('data-rc-json-mode') === controller.mode;
			$tab.toggleClass('active', active);
			$tab.attr('aria-current', active ? 'true' : 'false');
		});
		controller.$actions[isPanelMode ? 'show' : 'hide']();
		controller.$expandButton[isPanelMode && controller.canExpandToRowWidth && controller.layout !== LAYOUT_EXPANDED ? 'show' : 'hide']();
		controller.$fullscreenButton[isPanelMode && controller.layout !== LAYOUT_FULLSCREEN ? 'show' : 'hide']();
		controller.$collapseButton[isPanelMode && (controller.layout === LAYOUT_FULLSCREEN || controller.layout === LAYOUT_EXPANDED) ? 'show' : 'hide']();
		controller.$toolbar
			.attr('data-rc-json-layout', controller.layout)
			.toggleClass('rc-text-viewer-md-toolbar--markdown', isPanelMode);
	}

	/**
	 * Mirrors the raw control footprint for normal JSON mode.
	 *
	 * @param {object} controller JSON controller.
	 * @returns {void}
	 */
	function syncJsonSize(controller) {
		if (controller.layout !== LAYOUT_NORMAL) {
			return;
		}
		const measuredWidth = controller.$control.is(':visible') ? controller.$control.outerWidth() : 0;
		const width = measuredWidth || controller.width || controller.$control.parent().width() || 200;
		const cssWidth = controller.$control.is('textarea') && controller.rowConfig === 'full' ? '100%' : width + 'px';
		if (measuredWidth) {
			controller.width = measuredWidth;
		}
		controller.$toolbar.css('width', cssWidth);
		controller.$viewer.css({
			width: cssWidth,
			height: Math.max(controller.height, MIN_MARKDOWN_HEIGHT) + 'px',
			'min-height': MIN_MARKDOWN_HEIGHT + 'px',
			'margin-left': '',
		});
		controller.$rawPanel.css({
			width: cssWidth,
			height: Math.max(controller.height, MIN_MARKDOWN_HEIGHT) + 'px',
			'min-height': MIN_MARKDOWN_HEIGHT + 'px',
			'margin-left': '',
		});
		controller.$editor.css({
			'min-height': '',
		});
		if (controller.editor) {
			controller.editor.resize();
		}
	}

	/**
	 * Updates Ace height for the active JSON layout.
	 *
	 * @param {object} controller JSON controller.
	 * @param {number} height Viewer height in pixels.
	 * @returns {void}
	 */
	function setJsonViewerHeight(controller, height, userResize) {
		height = Math.max(MIN_MARKDOWN_HEIGHT, Math.floor(height));
		controller.$viewer.add(controller.$rawPanel).css({
			height: height + 'px',
			'min-height': MIN_MARKDOWN_HEIGHT + 'px',
		});
		controller.$control.css('min-height', '');
		controller.$editor.css({
			'min-height': '',
		});
		if (controller.layout === LAYOUT_NORMAL) {
			controller.height = height;
			controller.expandedHeight = height;
			if (userResize) {
				controller.userHeight = height;
			}
		}
		if (controller.layout === LAYOUT_EXPANDED) {
			controller.expandedHeight = height;
			if (userResize) {
				controller.height = height;
				controller.userHeight = height;
			}
		}
		if (controller.layout === LAYOUT_FULLSCREEN) {
			controller.fullscreenHeight = height;
		}
		if (controller.editor) {
			controller.editor.resize();
		}
	}

	/**
	 * Stores current JSON viewer height for the active layout.
	 *
	 * @param {object} controller JSON controller.
	 * @returns {void}
	 */
	function rememberJsonHeight(controller) {
		const height = getJsonActivePanel(controller).outerHeight();
		if (!height) {
			return;
		}
		if (controller.layout === LAYOUT_NORMAL) {
			controller.height = height;
		}
		if (controller.layout === LAYOUT_EXPANDED) {
			controller.expandedHeight = height;
		}
		if (controller.layout === LAYOUT_FULLSCREEN) {
			controller.fullscreenHeight = height;
		}
	}

	/**
	 * Initializes the full-width JSON resize handle.
	 *
	 * @param {object} controller JSON controller.
	 * @returns {void}
	 */
	function initJsonResizeHandle(controller) {
		controller.$resizeHandle.add(controller.$rawResizeHandle).on('mousedown', function (ev) {
			if (controller.layout === LAYOUT_FULLSCREEN) {
				return;
			}
			ev.preventDefault();
			const startY = ev.pageY;
			const startHeight = getJsonActivePanel(controller).outerHeight();

			$(document).on('mousemove.rcTextViewerJsonResize', function (moveEv) {
				const nextHeight = Math.max(MIN_MARKDOWN_HEIGHT, startHeight + (moveEv.pageY - startY));
				setJsonViewerHeight(controller, nextHeight, true);
			});
			$(document).on('mouseup.rcTextViewerJsonResize', function () {
				$(document).off('.rcTextViewerJsonResize');
			});
		}).on('dblclick', function (ev) {
			ev.preventDefault();
			expandJsonToContent(controller);
		});
	}

	/**
	 * Expands the JSON editor to the full REDCap field row width.
	 *
	 * @param {object} controller JSON controller.
	 * @returns {void}
	 */
	function expandJson(controller) {
		if (!controller.canExpandToRowWidth) {
			return;
		}
		if (controller.mode !== VIEW_RAW && controller.mode !== VIEW_JSON) {
			setJsonMode(controller, VIEW_JSON);
		}
		if (controller.layout !== LAYOUT_NORMAL) {
			rememberJsonHeight(controller);
			restoreJsonLayout(controller);
		}

		const $panel = getJsonActivePanel(controller);
		const $target = getMarkdownExpandTarget(controller);
		const $expandedCell = createExpandedRow(controller);
		const rowWidth = Math.max((controller.$row.length ? controller.$row.outerWidth() : $target.outerWidth()), $panel.outerWidth());
		const currentHeight = $panel.outerHeight() || controller.height;
		const expandedHeight = controller.userHeight || controller.expandedHeight || Math.max(currentHeight, Math.floor(rowWidth / 2));
		captureMarkdownPlacement(controller);
		$expandedCell.append(controller.$toolbar);
		$expandedCell.append($panel);
		hideDataCellContents(controller, $target);
		controller.$toolbar.css({
			width: '100%',
			'margin-left': '',
		});
		$panel.css({
			width: '100%',
			'margin-left': '',
		});
		controller.layout = LAYOUT_EXPANDED;
		controller.$toolbar.addClass('rc-text-viewer-md-toolbar--expanded');
		$panel.addClass('rc-text-viewer-md-preview--expanded');
		setJsonViewerHeight(controller, expandedHeight, false);
		updateJsonToolbar(controller);
	}

	/**
	 * Opens the JSON editor in a fullscreen overlay.
	 *
	 * @param {object} controller JSON controller.
	 * @returns {void}
	 */
	function fullscreenJson(controller) {
		if (controller.mode !== VIEW_RAW && controller.mode !== VIEW_JSON) {
			setJsonMode(controller, VIEW_JSON);
		}
		if (controller.layout !== LAYOUT_FULLSCREEN) {
			rememberJsonHeight(controller);
			captureMarkdownPlacement(controller);
		}
		const $panel = getJsonActivePanel(controller);
		controller.bodyOverflow = $('body').css('overflow');
		$('body').css('overflow', 'hidden');
		$('body').append(controller.$toolbar);
		$('body').append($panel);
		const fullscreenHeight = controller.fullscreenHeight || Math.max($panel.outerHeight() || controller.height, $(global).height() - 64);
		controller.$toolbar.css({
			width: '',
			'margin-left': '',
		});
		$panel.css({
			width: '',
			'margin-left': '',
		});
		controller.layout = LAYOUT_FULLSCREEN;
		controller.$toolbar.removeClass('rc-text-viewer-md-toolbar--expanded');
		controller.$toolbar.addClass('rc-text-viewer-md-toolbar--fullscreen');
		$panel.removeClass('rc-text-viewer-md-preview--expanded');
		$panel.addClass('rc-text-viewer-md-preview--fullscreen');
		setJsonViewerHeight(controller, fullscreenHeight, false);
		updateJsonToolbar(controller);
	}

	/**
	 * Collapses an expanded/fullscreen JSON editor.
	 *
	 * @param {object} controller JSON controller.
	 * @returns {void}
	 */
	function collapseJson(controller) {
		if (controller.layout === LAYOUT_NORMAL) {
			updateJsonToolbar(controller);
			return;
		}
		rememberJsonHeight(controller);
		restoreJsonLayout(controller);
		syncJsonSize(controller);
		if (controller.mode === VIEW_RAW) {
			controller.$control.show();
			controller.$rawPanel.css('display', controller.canExpandRaw ? 'flex' : 'none');
			controller.$viewer.css('display', 'none');
		}
		else {
			controller.$control.hide();
			controller.$rawPanel.css('display', 'none');
			controller.$viewer.css('display', 'flex');
		}
		if (controller.mode === VIEW_JSON && controller.editor) {
			controller.editor.resize();
		}
		updateJsonToolbar(controller);
	}

	/**
	 * Restores moved JSON toolbar and editor from expanded/fullscreen layouts.
	 *
	 * @param {object} controller JSON controller.
	 * @returns {void}
	 */
	function restoreJsonLayout(controller) {
		restoreMarkdownPlacement(controller);
		restoreDataCellContents(controller);
		if (controller.$expandedRow && controller.$expandedRow.length) {
			controller.$expandedRow.remove();
			controller.$expandedRow = null;
		}
		controller.layout = LAYOUT_NORMAL;
		controller.$toolbar.removeClass('rc-text-viewer-md-toolbar--expanded rc-text-viewer-md-toolbar--fullscreen');
		controller.$viewer.removeClass('rc-text-viewer-md-preview--expanded rc-text-viewer-md-preview--fullscreen');
		controller.$rawPanel.removeClass('rc-text-viewer-md-preview--expanded rc-text-viewer-md-preview--fullscreen');
		if (controller.bodyOverflow !== null) {
			$('body').css('overflow', controller.bodyOverflow);
			controller.bodyOverflow = null;
		}
	}

	/**
	 * Returns the active enhanced JSON panel.
	 *
	 * @param {object} controller JSON controller.
	 * @returns {jQuery}
	 */
	function getJsonActivePanel(controller) {
		return controller.mode === VIEW_RAW && controller.canExpandRaw ? controller.$rawPanel : controller.$viewer;
	}

	/**
	 * Expands the active JSON panel to fit its content vertically.
	 *
	 * @param {object} controller JSON controller.
	 * @returns {void}
	 */
	function expandJsonToContent(controller) {
		let contentHeight = MIN_MARKDOWN_HEIGHT;
		if (controller.mode === VIEW_RAW && controller.canExpandRaw) {
			const control = controller.$control[0];
			contentHeight = control ? control.scrollHeight + controller.$rawResizeHandle.outerHeight() : contentHeight;
		}
		else if (controller.editor) {
			const lineHeight = controller.editor.renderer.lineHeight || 16;
			contentHeight = (controller.editor.session.getScreenLength() * lineHeight) + 24;
		}
		setJsonViewerHeight(controller, contentHeight, true);
	}

	/**
	 * Renders the raw field value into Ace.
	 *
	 * @param {object} controller JSON controller.
	 * @returns {void}
	 */
	function renderJsonFromControl(controller) {
		const formatted = formatJson(controller.$control.val() || '', controller.displayFormat);
		setJsonStatus(controller, formatted);
		if (!controller.editor) {
			return;
		}
		controller.updatingEditor = true;
		controller.editor.setValue(formatted.text, -1);
		controller.updatingEditor = false;
		controller.editor.resize();
	}

	/**
	 * Syncs valid Ace JSON back into the raw REDCap field.
	 *
	 * @param {object} controller JSON controller.
	 * @returns {void}
	 */
	function syncJsonFromEditor(controller) {
		if (!controller.editor || controller.updatingEditor) {
			return;
		}
		const raw = controller.editor.getValue();
		const displayFormatted = formatJson(raw, controller.displayFormat);
		setJsonStatus(controller, displayFormatted);
		if (!displayFormatted.ok || controller.editor.getReadOnly()) {
			return;
		}
		const storageFormatted = formatJson(raw, controller.storageFormat);
		controller.skipNextControlRender = true;
		controller.updatingControl = true;
		controller.$control.val(storageFormatted.text).trigger('change');
		controller.updatingControl = false;
	}

	/**
	 * Pretty-normalizes valid JSON editor content without changing storage policy.
	 *
	 * @param {object} controller JSON controller.
	 * @returns {void}
	 */
	function normalizeJsonEditor(controller) {
		if (!controller.editor || controller.updatingEditor) {
			return;
		}
		const formatted = formatJson(controller.editor.getValue(), controller.displayFormat);
		setJsonStatus(controller, formatted);
		if (!formatted.ok) {
			return;
		}
		controller.updatingEditor = true;
		controller.editor.setValue(formatted.text, -1);
		controller.updatingEditor = false;
		syncJsonFromEditor(controller);
		controller.editor.resize();
	}

	/**
	 * Updates JSON validation status.
	 *
	 * @param {object} controller JSON controller.
	 * @param {object} formatted JSON format result.
	 * @returns {void}
	 */
	function setJsonStatus(controller, formatted) {
		controller.$viewer.toggleClass('rc-text-viewer--invalid', !formatted.ok);
		controller.$toolbar.toggleClass('rc-text-viewer--invalid', !formatted.ok);
		if (formatted.empty) {
			controller.$status
				.attr('title', 'JSON is empty')
				.attr('aria-label', 'JSON is empty')
				.html('');
		}
		else if (formatted.ok) {
			controller.$status
				.attr('title', 'Valid JSON')
				.attr('aria-label', 'Valid JSON')
				.html($('<i/>', { class: 'fa-solid fa-check text-muted rc-text-viewer-json-status__valid', 'aria-hidden': 'true' }));
		}
		else {
			controller.$status
				.attr('title', 'Invalid JSON: ' + formatted.error)
				.attr('aria-label', 'Invalid JSON: ' + formatted.error)
				.html($('<i/>', { class: 'fa-solid fa-triangle-exclamation text-warning rc-text-viewer-json-status__invalid', 'aria-hidden': 'true' }));
		}
	}

	/**
	 * Renders a JSON viewer and wires it to field changes.
	 *
	 * @param {jQuery} $control Field input or textarea.
	 * @param {object} field Field configuration.
	 * @returns {void}
	 */
	function attachJsonViewer($control, field) {
		state.jsonControllers[field.name] = createJsonController($control, field);
	}

	/**
	 * Attaches all configured viewers after REDCap has rendered the form.
	 *
	 * @returns {void}
	 */
	function attachConfiguredViewers() {
		(state.config.fields || []).forEach(function (field) {
			const $control = findFieldControl(field.name);
			if (!$control.length) {
				LOGGER.warn('Field control not found', field.name);
				return;
			}

			(field.viewers || []).forEach(function (viewerType) {
				const key = `${NS}-${viewerType}`;
				if ($control.data(key)) {
					return;
				}
				$control.data(key, true);
				if (viewerType === VIEW_MARKDOWN) {
					attachMarkdownViewer($control, field);
				}
				if (viewerType === 'json') {
					attachJsonViewer($control, field);
				}
			});
		});
	}

	/**
	 * Initializes the module.
	 *
	 * @param {object} config Client configuration emitted by PHP.
	 * @returns {object}
	 */
	function init(config) {
		state.config = $.extend(true, {
			debug: false,
			fields: [],
			urls: {
				ace: null,
			},
		}, config || {});

		LOGGER.configure({ active: !!state.config.debug });
		LOGGER.log('Initialized', state.config);

		$(attachConfiguredViewers);
		return {
			config: state.config,
			refresh: attachConfiguredViewers,
			editors: state.editors,
			markdownControllers: state.markdownControllers,
			jsonControllers: state.jsonControllers,
		};
	}

	global[NS] = {
		init: init,
		refresh: attachConfiguredViewers,
	};
})(window, jQuery);
