/* js/rc-viewers.js */
(function (global, $) {
	'use strict';

	const NS = 'DE_RUB_SEG_TextViewersEM';
	const EM_NAME = 'Text Viewers';
	const VIEW_RAW = 'raw';
	const VIEW_MARKDOWN = 'markdown';
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
		$row.removeClass('@READONLY @READONLY-FORM @READONLY-SURVEY');
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
		const $row = $(`tr[sq_id="${escapeSelector(fieldName)}"]`).first();
		const canExpandToRowWidth = $control.closest('td.data').length > 0;
		const $expandLink = $('#' + escapeSelector(fieldName) + '-expand');
		const $toolbar = $('<div/>', {
			class: 'rc-text-viewer-md-toolbar d-print-none',
			'data-rc-text-viewer-field': fieldName,
		});
		const $tabs = $('<span/>', { class: 'rc-text-viewer-md-tabs' });
		const rawLabel = markdownConfig.readonly ? 'Raw' : 'Raw (Edit)';
		const $rawTab = $('<a/>', {
			href: 'javascript:;',
			class: 'rc-text-viewer-md-tab',
			'data-rc-md-mode': VIEW_RAW,
			text: rawLabel,
		});
		const $markdownTab = $('<a/>', {
			href: 'javascript:;',
			class: 'rc-text-viewer-md-tab',
			'data-rc-md-mode': VIEW_MARKDOWN,
			text: 'Markdown',
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
		const $resizeHandle = $('<div/>', {
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
			$resizeHandle: $resizeHandle,
			$actions: $actions,
			$expandButton: $expandButton,
			$fullscreenButton: $fullscreenButton,
			$collapseButton: $collapseButton,
			canExpandToRowWidth: canExpandToRowWidth,
			mdOnly: mdOnly,
			mode: markdownConfig.initialMode === VIEW_MARKDOWN ? VIEW_MARKDOWN : VIEW_RAW,
			layout: LAYOUT_NORMAL,
			normalHeight: $control.outerHeight(),
			normalWidth: $control.outerWidth(),
			expandedHeight: null,
			fullscreenHeight: null,
			userHeight: null,
			restoreParent: null,
			restoreNext: null,
			$dataCell: null,
			$expandedRow: null,
			bodyOverflow: null,
		};

		if (markdownConfig.readonly) {
			applyMarkdownReadonly($control, $row);
		}

		if (mdOnly) {
			controller.mode = VIEW_MARKDOWN;
			$tabs.append($markdownTab);
		}
		else {
			$tabs.append($rawTab, $('<span/>', { class: 'rc-text-viewer-md-tab-separator', text: '|' }), $markdownTab);
		}
		$actions.append($expandButton, $fullscreenButton, $collapseButton);
		$toolbar.append($tabs, $actions);
		$viewerScroll.append($viewerContent);
		$viewer.append($viewerScroll, $resizeHandle);
		$control.before($toolbar);
		$control.after($viewer);

		$toolbar.on('click', '[data-rc-md-mode]', function (ev) {
			ev.preventDefault();
			setMarkdownMode(controller, $(this).attr('data-rc-md-mode'));
		});
		$toolbar.on('click', '[data-rc-md-action]', function (ev) {
			ev.preventDefault();
			handleMarkdownAction(controller, $(this).attr('data-rc-md-action'));
		});
		$control.on('input change keyup', debounce(function () {
			renderMarkdown(controller);
		}, 100));
		initMarkdownResizeHandle(controller);
		$(global).on('resize', debounce(function () {
			if (controller.mode === VIEW_MARKDOWN && controller.layout === LAYOUT_NORMAL) {
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
		if (controller.mdOnly || mode === VIEW_MARKDOWN) {
			mode = VIEW_MARKDOWN;
		}
		else {
			mode = VIEW_RAW;
		}

		controller.mode = mode;
		if (mode === VIEW_RAW) {
			restoreMarkdownLayout(controller);
			showRawMode(controller);
		}
		else {
			syncMarkdownNormalSize(controller, true);
			showMarkdownMode(controller);
			renderMarkdown(controller);
		}

		updateMarkdownToolbar(controller);
	}

	/**
	 * Shows the original REDCap raw textarea state.
	 *
	 * @param {object} controller Markdown controller.
	 * @returns {void}
	 */
	function showRawMode(controller) {
		restoreDataCellContents(controller);
		controller.$control.show();
		controller.$expandLink.show();
		controller.$viewer.css('display', 'none');
	}

	/**
	 * Shows the normal Markdown preview state.
	 *
	 * @param {object} controller Markdown controller.
	 * @returns {void}
	 */
	function showMarkdownMode(controller) {
		restoreDataCellContents(controller);
		controller.$control.hide();
		controller.$expandLink.hide();
		controller.$viewer.css('display', 'flex');
	}

	/**
	 * Updates toolbar active states and visible action buttons.
	 *
	 * @param {object} controller Markdown controller.
	 * @returns {void}
	 */
	function updateMarkdownToolbar(controller) {
		const isMarkdown = controller.mode === VIEW_MARKDOWN;
		controller.$toolbar.find('[data-rc-md-mode]').each(function () {
			const $tab = $(this);
			const active = $tab.attr('data-rc-md-mode') === controller.mode;
			$tab.toggleClass('active', active);
			$tab.attr('aria-current', active ? 'true' : 'false');
		});
		controller.$actions.attr('style', '');
		controller.$expandButton.attr('style', '');
		controller.$fullscreenButton.attr('style', '');
		controller.$collapseButton.attr('style', '');
		controller.$toolbar
			.attr('data-rc-md-layout', controller.layout)
			.toggleClass('rc-text-viewer-md-toolbar--markdown', isMarkdown);
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
	 * Initializes the full-width Markdown resize handle.
	 *
	 * @param {object} controller Markdown controller.
	 * @returns {void}
	 */
	function initMarkdownResizeHandle(controller) {
		controller.$resizeHandle.on('mousedown', function (ev) {
			if (controller.layout === LAYOUT_FULLSCREEN) {
				return;
			}
			ev.preventDefault();
			const startY = ev.pageY;
			const startHeight = controller.$viewer.outerHeight();

			$(document).on('mousemove.rcTextViewerResize', function (moveEv) {
				const nextHeight = Math.max(MIN_MARKDOWN_HEIGHT, startHeight + (moveEv.pageY - startY));
				setMarkdownViewerHeight(controller, nextHeight);
			});
			$(document).on('mouseup.rcTextViewerResize', function () {
				$(document).off('.rcTextViewerResize');
			});
		});
	}

	/**
	 * Stores the current viewer height for its active layout.
	 *
	 * @param {object} controller Markdown controller.
	 * @returns {void}
	 */
	function rememberMarkdownHeight(controller) {
		const height = controller.$viewer.outerHeight();
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
		controller.$viewer.css({
			height: height + 'px',
			'min-height': MIN_MARKDOWN_HEIGHT + 'px',
		});
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
		controller.$toolbar.css({
			width: cssWidth,
			'margin-left': '',
		});
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
		if (controller.mode !== VIEW_MARKDOWN) {
			setMarkdownMode(controller, VIEW_MARKDOWN);
		}
		if (controller.layout !== LAYOUT_NORMAL) {
			rememberMarkdownHeight(controller);
			restoreMarkdownLayout(controller);
		}

		const $target = getMarkdownExpandTarget(controller);
		const $expandedCell = createExpandedRow(controller);
		const rowWidth = Math.max((controller.$row.length ? controller.$row.outerWidth() : $target.outerWidth()), controller.$viewer.outerWidth());
		const currentHeight = controller.$viewer.outerHeight();
		const expandedHeight = controller.userHeight || controller.expandedHeight || Math.max(currentHeight, Math.floor(rowWidth / 2));
		captureMarkdownPlacement(controller);
		$expandedCell.append(controller.$toolbar);
		$expandedCell.append(controller.$viewer);
		hideDataCellContents(controller, $target);
		controller.$toolbar.css({
			width: '100%',
			'margin-left': '',
		});
		controller.$viewer.css({
			width: '100%',
			height: expandedHeight + 'px',
			'min-height': MIN_MARKDOWN_HEIGHT + 'px',
			'margin-left': '',
		});
		controller.layout = LAYOUT_EXPANDED;
		controller.$toolbar.addClass('rc-text-viewer-md-toolbar--expanded');
		controller.$viewer.addClass('rc-text-viewer-md-preview--expanded');
		updateMarkdownToolbar(controller);
	}

	/**
	 * Opens the Markdown preview in a fullscreen overlay.
	 *
	 * @param {object} controller Markdown controller.
	 * @returns {void}
	 */
	function fullscreenMarkdown(controller) {
		if (controller.mode !== VIEW_MARKDOWN) {
			setMarkdownMode(controller, VIEW_MARKDOWN);
		}
		if (controller.layout !== LAYOUT_FULLSCREEN) {
			rememberMarkdownHeight(controller);
		}
		if (controller.layout !== LAYOUT_FULLSCREEN) {
			captureMarkdownPlacement(controller);
		}
		controller.bodyOverflow = $('body').css('overflow');
		$('body').css('overflow', 'hidden');
		$('body').append(controller.$toolbar);
		$('body').append(controller.$viewer);
		const fullscreenHeight = controller.fullscreenHeight || Math.max(controller.$viewer.outerHeight(), $(global).height() - 64);
		controller.$toolbar.css({
			width: '',
			'margin-left': '',
		});
		controller.$viewer.css({
			width: '',
			height: fullscreenHeight + 'px',
			'min-height': '',
			'margin-left': '',
		});
		controller.layout = LAYOUT_FULLSCREEN;
		controller.$toolbar.removeClass('rc-text-viewer-md-toolbar--expanded');
		controller.$toolbar.addClass('rc-text-viewer-md-toolbar--fullscreen');
		controller.$viewer.removeClass('rc-text-viewer-md-preview--expanded');
		controller.$viewer.addClass('rc-text-viewer-md-preview--fullscreen');
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
		showMarkdownMode(controller);
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
			|| $.contains(controller.$toolbar[0], $target[0])
			|| $.contains(controller.$viewer[0], $target[0])
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
		controller.$viewer.removeClass('rc-text-viewer-md-preview--expanded rc-text-viewer-md-preview--fullscreen');
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
			if ($child[0] === controller.$toolbar[0] || $child[0] === controller.$viewer[0]) {
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
		controller.restoreParent = controller.$viewer.parent()[0];
		controller.restoreNext = controller.$viewer[0].nextSibling;
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
		controller.$control.before(controller.$toolbar);
		if (controller.restoreNext) {
			controller.restoreParent.insertBefore(controller.$viewer[0], controller.restoreNext);
		}
		else {
			controller.restoreParent.appendChild(controller.$viewer[0]);
		}
		controller.restoreParent = null;
		controller.restoreNext = null;
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
	 * @returns {object}
	 */
	function formatJson(raw) {
		const text = String(raw || '').trim();
		if (text === '') {
			return { ok: true, empty: true, text: '' };
		}
		try {
			const parsed = JSON.parse(text);
			return { ok: true, empty: false, text: JSON.stringify(parsed, null, 2) };
		}
		catch (e) {
			return { ok: false, empty: false, text: raw, error: e.message || String(e) };
		}
	}

	/**
	 * Renders a JSON viewer and wires it to field changes.
	 *
	 * @param {jQuery} $control Field input or textarea.
	 * @param {string} fieldName REDCap field name.
	 * @returns {void}
	 */
	function attachJsonViewer($control, fieldName) {
		const $shell = createViewerShell($control, fieldName, 'json');
		const $body = $shell.find('.rc-text-viewer__body');
		const $status = $shell.find('.rc-text-viewer__status');
		const editorId = `rc-text-viewer-ace-${fieldName}`;
		const $editor = $('<div/>', { id: editorId, class: 'rc-text-viewer__ace' });

		$body.empty().append($editor);

		ensureScript(state.config.urls.ace, function () {
			return !!global.ace;
		}).then(function () {
			const editor = global.ace.edit(editorId);
			state.editors[fieldName] = editor;
			editor.setTheme('ace/theme/textmate');
			editor.setReadOnly(true);
			editor.setShowPrintMargin(false);
			editor.setHighlightActiveLine(false);
			editor.session.setUseWorker(false);
			editor.renderer.setShowGutter(true);
			editor.renderer.setScrollMargin(6, 6, 0, 0);

			const render = debounce(function () {
				const formatted = formatJson($control.val() || '');
				editor.setValue(formatted.text, -1);
				$shell.toggleClass('rc-text-viewer--invalid', !formatted.ok);
				if (formatted.empty) {
					$status.text('empty');
				}
				else if (formatted.ok) {
					$status.text('valid');
				}
				else {
					$status.text('invalid JSON: ' + formatted.error);
				}
				editor.resize();
			}, 100);

			$control.on('input change keyup', render);
			render();
		}).catch(function (e) {
			const formatted = formatJson($control.val() || '');
			$body.html($('<pre/>', { class: 'rc-text-viewer__fallback' }).text(formatted.text));
			$status.text('Ace unavailable');
			LOGGER.warn('Ace failed to load', e);
		});
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
					attachJsonViewer($control, field.name);
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
		};
	}

	global[NS] = {
		init: init,
		refresh: attachConfiguredViewers,
	};
})(window, jQuery);
