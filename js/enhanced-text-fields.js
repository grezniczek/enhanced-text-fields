/* js/enhanced-text-fields.js */
(function (global, $) {
	'use strict';

	const NS = 'DE_RUB_SEG_EnhancedTextFieldsEM';
	const EM_NAME = 'Enhanced Text Fields';
	const VIEW_RAW = 'raw';
	const VIEW_MARKDOWN = 'markdown';
	const VIEW_HTML = 'html';
	const VIEW_JSON = 'json';
	const THEME_LIGHT = 'light';
	const THEME_DARK = 'dark';
	const ACE_THEME_LIGHT = 'github_light_default';
	const ACE_THEME_DARK = 'github_dark';
	const ACE_TEXT_MODES = {
		text: { normalizes: false },
		ini: { normalizes: false },
		css: { normalizes: true },
		r: { normalizes: false },
		xml: { normalizes: true },
		yaml: { normalizes: false },
	};
	const LAYOUT_NORMAL = 'normal';
	const LAYOUT_EXPANDED = 'expanded';
	const LAYOUT_FULLSCREEN = 'fullscreen';
	const MIN_MARKDOWN_HEIGHT = 100;
	const CONTROLLED_FIELD_CLASS = 'rc-text-viewer-controlled-field';

	if (global[NS]) {
		return;
	}

	const LOGGER = global.ConsoleDebugLogger
		? global.ConsoleDebugLogger.create({ name: EM_NAME })
		: makeFallbackLogger();

	const state = {
		config: null,
		acePromise: null,
		aceConfigured: false,
		editors: {},
		controllers: {},
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
			'data-rc-text-viewer-action': action,
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
	 * Returns the JavaScript Module Object emitted by the External Module Framework.
	 *
	 * @returns {object|null}
	 */
	function getJavascriptModuleObject() {
		const jsmoName = state.config && state.config.jsmoName;
		let jsmo = global;
        for (const part of jsmoName.split('.')) {
            jsmo = jsmo?.[part];
            if (jsmo === undefined || jsmo === null) {
                break;
            }
        }
        return jsmo;
    }

	/**
	 * Returns the stored light/dark preference for an enhancement type.
	 *
	 * @param {string} type Enhancement type.
	 * @returns {string}
	 */
	function getThemePreference(type) {
		const preferences = state.config.themePreferences || {};
		return preferences[type] === THEME_DARK ? THEME_DARK : THEME_LIGHT;
	}

	/**
	 * Returns the Ace theme key for an enhancement type.
	 *
	 * @param {string} type Enhancement type.
	 * @returns {string}
	 */
	function getPreferredAceTheme(type) {
		return getThemePreference(type) === THEME_DARK ? ACE_THEME_DARK : ACE_THEME_LIGHT;
	}

	/**
	 * Persists a theme preference through the JavaScript Module Object.
	 *
	 * @param {string} type Enhancement type.
	 * @param {string} theme Light/dark preference.
	 * @returns {void}
	 */
	function persistThemePreference(type, theme) {
		const jsmo = getJavascriptModuleObject();
		if (!jsmo) {
			LOGGER.warn('Theme preference could not be saved because the JavaScript Module Object is unavailable.');
			return;
		}
		jsmo.ajax('save-theme-preference', { type: type, theme: theme }).catch(function (e) {
			LOGGER.warn('Theme preference save failed', type, theme, e);
		});
	}

	/**
	 * Applies an Ace theme preference to one controller.
	 *
	 * @param {object} controller Text viewer controller.
	 * @param {string} theme Light/dark preference.
	 * @returns {void}
	 */
	function applyThemeToController(controller, theme) {
		if (!controller) {
			return;
		}
		controller.currentTheme = theme === THEME_DARK ? THEME_DARK : THEME_LIGHT;
		updateThemeButton(controller);
		if (!controller.editor) {
			return;
		}
		const themeConfig = getAceThemeConfig(theme === THEME_DARK ? ACE_THEME_DARK : ACE_THEME_LIGHT);
		controller.editor.setTheme(themeConfig.module);
	}

	/**
	 * Applies a new theme preference to all controllers of the same enhancement type.
	 *
	 * @param {string} type Enhancement type.
	 * @param {string} theme Light/dark preference.
	 * @returns {void}
	 */
	function applyThemeToControllers(type, theme) {
		Object.keys(state.controllers).forEach(function (key) {
			const controller = state.controllers[key];
			if (controller.themeMode === type) {
				applyThemeToController(controller, theme);
			}
		});
	}

	/**
	 * Toggles the theme preference for a controller's enhancement type.
	 *
	 * @param {object} controller Text viewer controller.
	 * @returns {void}
	 */
	function toggleControllerTheme(controller) {
		if (!controller || !controller.themeMode) {
			return;
		}
		const currentTheme = getThemePreference(controller.themeMode);
		const nextTheme = currentTheme === THEME_DARK ? THEME_LIGHT : THEME_DARK;
		state.config.themePreferences[controller.themeMode] = nextTheme;
		applyThemeToControllers(controller.themeMode, nextTheme);
		if (!state.config.isSurvey) {
			persistThemePreference(controller.themeMode, nextTheme);
		}
	}

	/**
	 * Returns whether the theme toggle should be visible for a controller.
	 *
	 * @param {object} controller Text viewer controller.
	 * @returns {boolean}
	 */
	function isThemeToggleVisible(controller) {
		if (!controller || !controller.themeMode || !controller.isThemeableMode) {
			return false;
		}
		if (controller.layout !== LAYOUT_EXPANDED && controller.layout !== LAYOUT_FULLSCREEN) {
			return false;
		}
		return controller.isThemeableMode();
	}

	/**
	 * Updates a controller's theme toggle icon and label.
	 *
	 * @param {object} controller Text viewer controller.
	 * @returns {void}
	 */
	function updateThemeButton(controller) {
		if (!controller || !controller.$themeButton || !controller.$themeButton.length) {
			return;
		}
		const theme = getThemePreference(controller.themeMode);
		const title = theme === THEME_DARK ? 'Switch to light mode' : 'Switch to dark mode';
		const iconClass = theme === THEME_DARK ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
		controller.$themeButton.attr('title', title).attr('aria-label', title);
		controller.$themeButton.find('i').attr('class', iconClass).attr('aria-hidden', 'true');
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
	 * Marks a REDCap input as managed by this External Module.
	 *
	 * @param {jQuery} $control Field input or textarea.
	 * @returns {void}
	 */
	function markControlledField($control) {
		$control.addClass(CONTROLLED_FIELD_CLASS);
	}

	/**
	 * Applies custom readonly handling for controlled fields.
	 *
	 * @param {jQuery} $control Field input or textarea.
	 * @param {jQuery} $row REDCap field row.
	 * @returns {void}
	 */
	function applyReadonlyState($control, $row) {
		$row.addClass('rc-text-viewer-readonly-row');
		$control.prop('disabled', false);
		$control.prop('readonly', true);
		$control.attr('aria-readonly', 'true');
		$control.addClass('rc-text-viewer-readonly-control');
	}

	/**
	 * Creates shared controller state for a text viewer field.
	 *
	 * @param {object} options Controller options.
	 * @returns {object}
	 */
	function createTextViewerController(options) {
		const $control = options.$control;
		const field = options.field;
		const fieldName = field.name;
		const initialHeight = options.initialHeight || null;
		markControlledField($control);

		return {
			fieldName: fieldName,
			$control: $control,
			$row: $(`tr[sq_id="${escapeSelector(fieldName)}"]`).first(),
			$expandLink: $('#' + escapeSelector(fieldName) + '-expand'),
			$toolbar: options.$toolbar,
			$viewer: options.$viewer,
			$editorViewer: options.$editorViewer || $(),
			$editor: options.$editor || $(),
			$rawPanel: options.$rawPanel || $(),
			$resizeHandle: options.$resizeHandle || $(),
			$editorResizeHandle: options.$editorResizeHandle || $(),
			$rawResizeHandle: options.$rawResizeHandle || $(),
			$actions: options.$actions,
			$expandButton: options.$expandButton,
			$fullscreenButton: options.$fullscreenButton,
			$collapseButton: options.$collapseButton,
			$themeButton: options.$themeButton || $(),
			editor: null,
			enhancementMode: options.enhancementMode,
			themeMode: options.enhancementMode || null,
			currentTheme: options.enhancementMode ? getThemePreference(options.enhancementMode) : THEME_LIGHT,
			rowConfig: field.rowConfig === 'full' ? 'full' : 'split',
			canExpandToRowWidth: field.rowConfig === 'split',
			canExpandRaw: $control.is('textarea'),
			layout: LAYOUT_NORMAL,
			normalHeight: initialHeight || $control.outerHeight() || MIN_MARKDOWN_HEIGHT,
			normalWidth: $control.outerWidth(),
			expandedHeight: null,
			fullscreenHeight: null,
			userHeight: initialHeight,
			fitToContentActive: false,
			fitToContentRestoreHeight: null,
			restoreParent: null,
			restoreNext: null,
			$movedPanel: null,
			$dataCell: null,
			$expandedRow: null,
			bodyOverflow: null,
		};
	}

	/**
	 * Returns a configured display label for a viewer mode.
	 *
	 * @param {string} mode Viewer mode key.
	 * @returns {string}
	 */
	function getModeLabel(mode) {
		const labels = (state.config && state.config.labels) || {};
		return labels[mode] || String(mode || '').toUpperCase();
	}

	/**
	 * Returns an initial viewer height from a mode config.
	 *
	 * @param {object} modeConfig Field mode configuration.
	 * @returns {number|null}
	 */
	function getInitialViewerHeight(modeConfig) {
		return Number.isInteger(modeConfig.height) && modeConfig.height > 0
			? Math.max(modeConfig.height, MIN_MARKDOWN_HEIGHT)
			: null;
	}

	/**
	 * Builds a shared resize handle.
	 *
	 * @returns {jQuery}
	 */
	function createResizeHandle() {
		return $('<div/>', {
			class: 'rc-text-viewer-md-resize-handle',
			role: 'separator',
			'aria-orientation': 'horizontal',
			title: 'Drag to resize',
		});
	}

	/**
	 * Builds shared toolbar elements and action buttons.
	 *
	 * @param {string} fieldName REDCap field name.
	 * @param {string} extraClass Extra toolbar class.
	 * @param {boolean} canExpandToRowWidth Whether row expansion is available.
	 * @returns {object}
	 */
	function createToolbarParts(fieldName, extraClass, canExpandToRowWidth) {
		const $toolbar = $('<div/>', {
			class: ['rc-text-viewer-md-toolbar', extraClass, 'd-print-none'].filter(Boolean).join(' '),
			'data-rc-text-viewer-field': fieldName,
		});
		const $tabs = $('<span/>', { class: 'rc-text-viewer-md-tabs' });
		const $actions = $('<span/>', { class: 'rc-text-viewer-md-actions' });
		const $expandButton = createIconButton('expand', 'fa-solid fa-arrows-left-right', 'Expand to row width');
		const $fullscreenButton = createIconButton('fullscreen', 'fa-solid fa-maximize', 'Fullscreen');
		const $collapseButton = createIconButton('collapse', 'fa-solid fa-down-left-and-up-right-to-center', 'Collapse');
		const $themeButton = createIconButton('toggle-theme', 'fa-solid fa-moon', 'Switch to dark mode');
		if (!canExpandToRowWidth) {
			$expandButton.addClass('rc-text-viewer-md-action--unavailable');
		}
		$actions.append($themeButton, $expandButton, $fullscreenButton, $collapseButton);
		$toolbar.append($tabs, $actions);
		return {
			$toolbar: $toolbar,
			$tabs: $tabs,
			$actions: $actions,
			$expandButton: $expandButton,
			$fullscreenButton: $fullscreenButton,
			$collapseButton: $collapseButton,
			$themeButton: $themeButton,
		};
	}

	/**
	 * Builds a mode tab.
	 *
	 * @param {string} modeAttribute Data attribute used by the controller.
	 * @param {string} mode Mode value.
	 * @param {string} label Visible label.
	 * @returns {jQuery}
	 */
	function createModeTab(modeAttribute, mode, label) {
		return $('<a/>', {
			href: 'javascript:;',
			class: 'rc-text-viewer-md-tab',
			[modeAttribute]: mode,
			text: label,
		});
	}

	/**
	 * Appends mode tabs with separators.
	 *
	 * @param {jQuery} $tabs Toolbar tabs container.
	 * @param {jQuery[]} tabItems Tabs and non-tab inline controls.
	 * @returns {void}
	 */
	function appendSeparatedTabs($tabs, tabItems) {
		tabItems.forEach(function ($item, index) {
			if (index > 0) {
				$tabs.append($('<span/>', { class: 'rc-text-viewer-md-tab-separator', text: '|' }));
			}
			$tabs.append($item);
		});
	}

	/**
	 * Builds a raw field wrapper panel.
	 *
	 * @param {string} fieldName REDCap field name.
	 * @returns {jQuery}
	 */
	function createRawPanel(fieldName) {
		return $('<div/>', {
			class: 'rc-text-viewer-raw-panel',
			'data-rc-text-viewer-field': fieldName,
		});
	}

	/**
	 * Wires shared toolbar click behavior.
	 *
	 * @param {object} controller Text viewer controller.
	 * @param {string} modeSelector Selector for mode tabs.
	 * @param {Function} setMode Mode setter.
	 * @returns {void}
	 */
	function bindTextViewerToolbar(controller, modeSelector, setMode) {
		controller.$toolbar.on('click', modeSelector, function (ev) {
			ev.preventDefault();
			const mode = $(this).attr(controller.modeAttribute);
			if (mode !== controller.mode) {
				setMode(controller, mode);
			}
		});
		controller.$toolbar.on('click', '[data-rc-text-viewer-action]', function (ev) {
			ev.preventDefault();
			handleTextViewerAction(controller, $(this).attr('data-rc-text-viewer-action'));
		});
	}

	/**
	 * Mounts the shared toolbar, raw panel, and Ace-backed viewer panel.
	 *
	 * @param {object} controller Text viewer controller.
	 * @returns {void}
	 */
	function mountAceTextViewer(controller) {
		controller.$viewer.append(controller.$editor, controller.$resizeHandle);
		if (controller.canExpandRaw) {
			controller.$control.before(controller.$rawPanel);
			controller.$rawPanel.append(controller.$control, controller.$rawResizeHandle);
			controller.$rawPanel.before(controller.$toolbar);
			controller.$rawPanel.after(controller.$viewer);
			return;
		}
		controller.$control.before(controller.$toolbar);
		controller.$control.after(controller.$viewer);
	}

	/**
	 * Mounts the Markdown raw, editor, and preview panels.
	 *
	 * @param {object} controller Markdown controller.
	 * @returns {void}
	 */
	function mountMarkdownViewer(controller) {
		controller.$viewerScroll.append(controller.$viewerContent);
		controller.$viewer.append(controller.$viewerScroll, controller.$resizeHandle);
		controller.$editorViewer.append(controller.$editor, controller.$editorResizeHandle);
		controller.$control.before(controller.$rawPanel);
		controller.$rawPanel.append(controller.$control, controller.$rawResizeHandle);
		controller.$rawPanel.before(controller.$toolbar);
		controller.$rawPanel.after(controller.$viewer);
		controller.$viewer.after(controller.$editorViewer);
	}

	/**
	 * Initializes the shared Ace lifecycle for JSON and generic text controllers.
	 *
	 * @param {object} controller Text viewer controller.
	 * @param {string} editorId Ace editor element id.
	 * @param {object} field Field configuration.
	 * @param {object} options Lifecycle callbacks and storage keys.
	 * @returns {void}
	 */
	function initEnhancedEditor(controller, editorId, field, spec) {
		if (spec.mode === VIEW_MARKDOWN) {
			ensureAce().then(function () {
				const editor = createAceEditor(editorId, {
					mode: VIEW_MARKDOWN,
					theme: getPreferredAceTheme(controller.themeMode),
					readOnly: !!field.readonly,
					useWorker: false,
				});
				controller.editor = editor;
				controller.currentTheme = getThemePreference(controller.themeMode);
				state.editors[spec.editorKey] = editor;
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
			return;
		}

		ensureAce().then(function () {
			const editor = createAceEditor(editorId, {
				mode: spec.editorMode,
				theme: getPreferredAceTheme(controller.themeMode),
				readOnly: !!field.readonly,
				useWorker: false,
				indent: controller.indent,
			});
			controller.editor = editor;
			controller.currentTheme = getThemePreference(controller.themeMode);
			state.editors[spec.editorKey] = editor;
			const syncFromEditor = debounce(function () {
				spec.syncFromEditor(controller);
			}, 100);
			editor.session.on('change', function () {
				const changeGeneration = controller.editorChangeGeneration;
				if (changeGeneration === controller.suppressedEditorChangeGeneration) {
					controller.suppressedEditorChangeGeneration = null;
					return;
				}
				syncFromEditor();
			});
			editor.on('blur', function () {
				spec.normalizeEditor(controller);
			});
			spec.renderFromControl(controller);
			syncTextViewerNormalSize(controller);
			resizeTextViewerEditor(controller);
		}).catch(function (e) {
			spec.renderFallback(controller, e);
		});
	}

	/**
	 * Renders a JSON fallback when Ace cannot load.
	 *
	 * @param {object} controller JSON controller.
	 * @param {Error} error Load error.
	 * @returns {void}
	 */
	function renderJsonFallback(controller, error) {
		const formatted = formatJson(controller.$control.val() || '', controller.displayFormat, controller.indent);
		controller.$viewer.html($('<pre/>', { class: 'rc-text-viewer__fallback' }).text(formatted.text));
		setJsonStatus(controller, formatted);
		LOGGER.warn('Ace failed to load', error);
	}

	/**
	 * Renders a generic text fallback when Ace cannot load.
	 *
	 * @param {object} controller Ace text controller.
	 * @param {Error} error Load error.
	 * @returns {void}
	 */
	function renderAceTextFallback(controller, error) {
		const formatted = formatAceText(controller.$control.val() || '', controller.aceMode, controller.displayFormat, controller.indent);
		controller.$viewer.html($('<pre/>', { class: 'rc-text-viewer__fallback' }).text(formatted.text));
		setAceTextStatus(controller, formatted);
		LOGGER.warn('Ace failed to load for ' + controller.aceMode, error);
	}

	/**
	 * Sets the visible mode for an Ace-backed raw/editor controller.
	 *
	 * @param {object} controller Text viewer controller.
	 * @param {string} mode Desired mode.
	 * @param {object} options Mode callbacks and editor settings.
	 * @returns {void}
	 */
	function setAceBackedMode(controller, mode, options) {
		if (controller[options.editorOnlyProperty] || mode === options.editorMode) {
			mode = options.editorMode;
		}
		else {
			mode = VIEW_RAW;
		}

		const previousMode = controller.mode;
		const previousLayout = controller.layout;
		if (previousMode === VIEW_RAW && mode !== VIEW_RAW) {
			options.renderFromControl(controller);
		}
		if (previousMode !== mode && previousLayout !== LAYOUT_NORMAL) {
			rememberTextViewerHeight(controller);
			restoreTextViewerLayout(controller);
		}
		controller.mode = mode;
		if (mode === VIEW_RAW) {
			options.normalizeEditor(controller);
			syncTextViewerNormalSize(controller, true);
			showAceBackedRawMode(controller);
		}
		else {
			syncTextViewerNormalSize(controller, true);
			showAceBackedEditorMode(controller, options.resizeEditor);
		}
		options.updateToolbar(controller);
		if (previousMode !== mode && previousLayout === LAYOUT_EXPANDED) {
			expandTextViewer(controller);
		}
		if (previousMode !== mode && previousLayout === LAYOUT_FULLSCREEN) {
			fullscreenTextViewer(controller);
		}
	}

	/**
	 * Shows the raw control for an Ace-backed controller.
	 *
	 * @param {object} controller Text viewer controller.
	 * @returns {void}
	 */
	function showAceBackedRawMode(controller) {
		controller.$control.show();
		controller.$rawPanel.css('display', controller.canExpandRaw ? 'flex' : 'none');
		controller.$expandLink.hide();
		controller.$viewer.css('display', 'none');
	}

	/**
	 * Shows the Ace editor panel for an Ace-backed controller.
	 *
	 * @param {object} controller Text viewer controller.
	 * @param {Function} resizeEditor Editor resize callback.
	 * @returns {void}
	 */
	function showAceBackedEditorMode(controller, resizeEditor) {
		controller.$control.hide();
		controller.$rawPanel.css('display', 'none');
		controller.$expandLink.hide();
		controller.$viewer.css('display', 'flex');
		resizeEditor(controller);
	}

	/**
	 * Returns the active panel for an Ace-backed controller.
	 *
	 * @param {object} controller Text viewer controller.
	 * @returns {jQuery}
	 */
	function getAceBackedActivePanel(controller) {
		return controller.mode === VIEW_RAW && controller.canExpandRaw ? controller.$rawPanel : controller.$viewer;
	}

	/**
	 * Restores the visible panel for an Ace-backed controller.
	 *
	 * @param {object} controller Text viewer controller.
	 * @param {Function} resizeEditor Editor resize callback.
	 * @returns {void}
	 */
	function restoreAceBackedVisibleMode(controller, resizeEditor) {
		if (controller.mode === VIEW_RAW) {
			showAceBackedRawMode(controller);
			return;
		}
		showAceBackedEditorMode(controller, resizeEditor);
	}

	/**
	 * Calculates content height for an Ace-backed controller.
	 *
	 * @param {object} controller Text viewer controller.
	 * @returns {number}
	 */
	function getAceBackedContentHeight(controller) {
		if (controller.mode === VIEW_RAW && controller.canExpandRaw) {
			const control = controller.$control[0];
			return control ? control.scrollHeight + controller.$rawResizeHandle.outerHeight() : MIN_MARKDOWN_HEIGHT;
		}
		if (controller.editor) {
			const lineHeight = controller.editor.renderer.lineHeight || 16;
			return (controller.editor.session.getScreenLength() * lineHeight) + 24;
		}
		return MIN_MARKDOWN_HEIGHT;
	}

	/**
	 * Resizes an Ace editor with its native resize method.
	 *
	 * @param {object} controller Text viewer controller.
	 * @returns {void}
	 */
	function resizeAceEditor(controller) {
		if (controller.editor) {
			controller.editor.resize();
		}
	}

	/**
	 * Handles shared toolbar action buttons.
	 *
	 * @param {object} controller Text viewer controller.
	 * @param {string} action Action identifier.
	 * @returns {void}
	 */
	function handleTextViewerAction(controller, action) {
		if (action === 'toggle-theme') {
			toggleControllerTheme(controller);
		}
		if (action === 'expand') {
			expandTextViewer(controller);
		}
		if (action === 'fullscreen') {
			fullscreenTextViewer(controller);
		}
		if (action === 'collapse') {
			collapseTextViewer(controller);
		}
	}

	/**
	 * Updates shared toolbar active states and expansion buttons.
	 *
	 * @param {object} controller Text viewer controller.
	 * @returns {void}
	 */
	function updateTextViewerToolbar(controller) {
		const isPanelMode = controller.isPanelMode();
		controller.$toolbar.find('[' + controller.modeAttribute + ']').each(function () {
			const $tab = $(this);
			const active = $tab.attr(controller.modeAttribute) === controller.mode;
			$tab.toggleClass('active', active);
			$tab.attr('aria-current', active ? 'true' : 'false');
		});
		controller.$actions[isPanelMode ? 'show' : 'hide']();
		controller.$expandButton[isPanelMode && controller.canExpandToRowWidth && controller.layout !== LAYOUT_EXPANDED ? 'show' : 'hide']();
		controller.$fullscreenButton[isPanelMode && controller.layout !== LAYOUT_FULLSCREEN ? 'show' : 'hide']();
		controller.$collapseButton[isPanelMode && (controller.layout === LAYOUT_FULLSCREEN || controller.layout === LAYOUT_EXPANDED) ? 'show' : 'hide']();
		updateThemeButton(controller);
		controller.$themeButton[isThemeToggleVisible(controller) ? 'show' : 'hide']();
		controller.$toolbar
			.attr(controller.layoutAttribute, controller.layout)
			.toggleClass('rc-text-viewer-md-toolbar--markdown', isPanelMode);
	}

	/**
	 * Builds a controller specification for one enhancement mode.
	 *
	 * @param {jQuery} $control Field input or textarea.
	 * @param {object} field Field configuration.
	 * @param {string} mode Enhancement mode.
	 * @returns {object}
	 */
	function getEnhancedTextSpec($control, field, mode) {
		const fieldName = field.name;
		if (mode === VIEW_MARKDOWN) {
			const modeConfig = field.markdown || {};
			const editorOnly = !!modeConfig.editorOnly;
			return {
				mode: VIEW_MARKDOWN,
				modeConfig: modeConfig,
				editorOnly: editorOnly,
				initialMode: editorOnly ? VIEW_MARKDOWN : getMarkdownInitialMode($control, modeConfig),
				editorMode: VIEW_MARKDOWN,
				editorId: `rc-text-viewer-md-ace-${fieldName}`,
				toolbarClass: '',
				viewerClass: 'rc-text-viewer-md-preview',
				modeAttribute: 'data-rc-md-mode',
				modeSelector: '[data-rc-md-mode]',
				layoutAttribute: 'data-rc-md-layout',
				defaultMode: VIEW_HTML,
				tabs: editorOnly
					? [VIEW_MARKDOWN, VIEW_HTML]
					: [VIEW_RAW, VIEW_MARKDOWN, VIEW_HTML],
				stateKey: fieldName,
				editorKey: `${fieldName}-markdown`,
				buildController: extendMarkdownController,
				mount: mountMarkdownViewer,
				setMode: setMarkdownMode,
				afterCreate: initMarkdownWindowResize,
			};
		}
		if (mode === VIEW_JSON) {
			const modeConfig = field.json || {};
			const editorOnly = !!modeConfig.editorOnly;
			return {
				mode: VIEW_JSON,
				modeConfig: modeConfig,
				editorOnly: editorOnly,
				initialMode: editorOnly || modeConfig.initialMode === VIEW_JSON ? VIEW_JSON : VIEW_RAW,
				editorMode: VIEW_JSON,
				editorId: `rc-text-viewer-ace-${fieldName}`,
				toolbarClass: 'rc-text-viewer-json-toolbar',
				viewerClass: 'rc-text-viewer-json-preview',
				modeAttribute: 'data-rc-json-mode',
				modeSelector: '[data-rc-json-mode]',
				layoutAttribute: 'data-rc-json-layout',
				defaultMode: VIEW_JSON,
				tabs: editorOnly ? [VIEW_JSON] : [VIEW_RAW, VIEW_JSON],
				stateKey: fieldName,
				editorKey: fieldName,
				status: true,
				buildController: extendJsonController,
				mount: mountAceTextViewer,
				setMode: setJsonMode,
				syncFromEditor: syncJsonFromEditor,
				normalizeEditor: normalizeJsonEditor,
				renderFromControl: renderJsonFromControl,
				renderFallback: renderJsonFallback,
			};
		}
		const modeConfig = field[mode] || {};
		const editorOnly = !!modeConfig.editorOnly;
		return {
			mode: mode,
			modeConfig: modeConfig,
			editorOnly: editorOnly,
			initialMode: editorOnly || modeConfig.initialMode === mode ? mode : VIEW_RAW,
			editorMode: mode,
			editorId: `rc-text-viewer-${mode}-ace-${fieldName}`,
			toolbarClass: 'rc-text-viewer-code-toolbar',
			viewerClass: 'rc-text-viewer-json-preview rc-text-viewer-code-preview',
			modeAttribute: 'data-rc-code-mode',
			modeSelector: '[data-rc-code-mode]',
			layoutAttribute: 'data-rc-code-layout',
			defaultMode: mode,
			tabs: editorOnly ? [mode] : [VIEW_RAW, mode],
			stateKey: `${fieldName}-${mode}`,
			editorKey: `${fieldName}-${mode}`,
			status: true,
			buildController: extendAceTextController,
			mount: mountAceTextViewer,
			setMode: setAceTextMode,
			syncFromEditor: syncAceTextFromEditor,
			normalizeEditor: normalizeAceTextEditor,
			renderFromControl: renderAceTextFromControl,
			renderFallback: renderAceTextFallback,
		};
	}

	/**
	 * Builds one enhanced text controller from a mode specification.
	 *
	 * @param {jQuery} $control Field input or textarea.
	 * @param {object} field Field configuration.
	 * @param {string} mode Enhancement mode.
	 * @returns {object}
	 */
	function createEnhancedTextController($control, field, mode) {
		const fieldName = field.name;
		const spec = getEnhancedTextSpec($control, field, mode);
		const toolbarParts = createToolbarParts(fieldName, spec.toolbarClass, field.rowConfig === 'split');
		const $editability = createEditStateIndicator(!!field.readonly);
		const $status = spec.status ? $('<span/>', { class: 'rc-text-viewer-json-status', 'aria-live': 'polite' }) : $();
		const $viewer = $('<div/>', {
			class: spec.viewerClass,
			'data-rc-text-viewer-field': fieldName,
			tabindex: mode === VIEW_MARKDOWN ? '0' : null,
		});
		const $editor = $('<div/>', { id: spec.editorId, class: 'rc-text-viewer__ace' });
		const $rawPanel = createRawPanel(fieldName);
		const controller = createTextViewerController({
			enhancementMode: mode,
			field: field,
			$control: $control,
			$toolbar: toolbarParts.$toolbar,
			$viewer: $viewer,
			$editorViewer: mode === VIEW_MARKDOWN ? $('<div/>', {
				class: 'rc-text-viewer-md-editor',
				'data-rc-text-viewer-field': fieldName,
			}) : $(),
			$editor: $editor,
			$rawPanel: $rawPanel,
			$resizeHandle: createResizeHandle(),
			$editorResizeHandle: mode === VIEW_MARKDOWN ? createResizeHandle() : $(),
			$rawResizeHandle: createResizeHandle(),
			$actions: toolbarParts.$actions,
			$expandButton: toolbarParts.$expandButton,
			$fullscreenButton: toolbarParts.$fullscreenButton,
			$collapseButton: toolbarParts.$collapseButton,
			$themeButton: toolbarParts.$themeButton,
			initialHeight: getInitialViewerHeight(spec.modeConfig),
		});

		spec.buildController(controller, spec, $status);
		if (field.readonly) {
			applyReadonlyState($control, controller.$row);
		}

		appendControllerTabs(toolbarParts.$tabs, $editability, spec, $status);
		spec.mount(controller);
		bindTextViewerToolbar(controller, spec.modeSelector, spec.setMode);
		initTextViewerResizeHandles(controller);
		initEnhancedEditor(controller, spec.editorId, field, spec);
		if (spec.afterCreate) {
			spec.afterCreate(controller);
		}

		spec.setMode(controller, controller.mode);
		state.controllers[spec.stateKey] = controller;
		LOGGER.log('Controller created', controller);
		return controller;
	}

	/**
	 * Returns whether a configured enhancement mode is supported.
	 *
	 * @param {string} mode Enhancement mode.
	 * @returns {boolean}
	 */
	function isSupportedEnhancementMode(mode) {
		return mode === VIEW_MARKDOWN || mode === VIEW_JSON || !!ACE_TEXT_MODES[mode];
	}

	/**
	 * Attaches one configured enhancement to a field control.
	 *
	 * @param {jQuery} $control Field input or textarea.
	 * @param {object} field Field configuration.
	 * @param {string} mode Enhancement mode.
	 * @returns {void}
	 */
	function attachEnhancedTextViewer($control, field, mode) {
		if (!isSupportedEnhancementMode(mode)) {
			LOGGER.warn('Unsupported enhancement skipped', mode, field.name);
			return;
		}
		if (mode === VIEW_MARKDOWN && !$control.is('textarea')) {
			LOGGER.warn('Markdown viewer skipped for non-textarea field', field.name);
			return;
		}
		createEnhancedTextController($control, field, mode);
	}

	/**
	 * Appends mode tabs for a controller.
	 *
	 * @param {jQuery} $tabs Toolbar tabs container.
	 * @param {jQuery} $editability Editable/readonly indicator.
	 * @param {object} spec Controller specification.
	 * @param {jQuery} $status Optional status indicator.
	 * @returns {void}
	 */
	function appendControllerTabs($tabs, $editability, spec, $status) {
		const tabItems = spec.tabs.map(function (tabMode) {
			return createModeTab(spec.modeAttribute, tabMode, getModeLabel(tabMode));
		});
		$tabs.append($editability);
		if (spec.editorOnly && tabItems.length === 1) {
			$tabs.append(tabItems[0]);
		}
		else {
			appendSeparatedTabs($tabs, tabItems);
		}
		if ($status && $status.length) {
			$tabs.append($status);
		}
	}

	/**
	 * Extends a base controller with Markdown behavior.
	 *
	 * @param {object} controller Text viewer controller.
	 * @param {object} spec Controller specification.
	 * @returns {void}
	 */
	function extendMarkdownController(controller, spec) {
		const $viewerScroll = $('<div/>', { class: 'rc-text-viewer-md-preview-scroll' });
		const $viewerContent = $('<div/>', { class: 'markdown-body rc-text-viewer-md-preview-content' });
		$.extend(controller, {
			$viewerScroll: $viewerScroll,
			$viewerContent: $viewerContent,
			mdOnly: spec.editorOnly,
			mode: spec.initialMode,
			getActivePanel: function () { return getMarkdownActivePanel(controller); },
			getPanelSet: function () { return controller.$viewer.add(controller.$editorViewer).add(controller.$rawPanel); },
			getContentHeight: function () { return getMarkdownContentHeight(controller); },
			setHeight: function (height, userResize) { setTextViewerHeight(controller, height, userResize !== false); },
			syncSize: function (captureHeight) { syncTextViewerNormalSize(controller, captureHeight); },
			restoreVisibleMode: function () { restoreMarkdownVisibleMode(controller); },
			setMode: function (nextMode) { setMarkdownMode(controller, nextMode); },
			updateToolbar: function () { updateMarkdownToolbar(controller); },
			isPanelMode: function () { return controller.mode === VIEW_MARKDOWN || controller.mode === VIEW_HTML || (controller.mode === VIEW_RAW && controller.canExpandRaw); },
			isThemeableMode: function () { return controller.mode === VIEW_MARKDOWN; },
			modeAttribute: spec.modeAttribute,
			layoutAttribute: spec.layoutAttribute,
			defaultMode: spec.defaultMode,
		});
	}

	/**
	 * Extends a base controller with JSON behavior.
	 *
	 * @param {object} controller Text viewer controller.
	 * @param {object} spec Controller specification.
	 * @param {jQuery} $status Validation status indicator.
	 * @returns {void}
	 */
	function extendJsonController(controller, spec, $status) {
		const storageFormat = controller.$control.is('textarea') && spec.modeConfig.format !== 'compact' ? 'pretty' : 'compact';
		$.extend(controller, {
			$status: $status,
			jsonOnly: spec.editorOnly,
			displayFormat: 'pretty',
			storageFormat: storageFormat,
			indent: spec.modeConfig.indent || 2,
			mode: spec.initialMode,
			getActivePanel: function () { return getJsonActivePanel(controller); },
			getPanelSet: function () { return controller.$viewer.add(controller.$rawPanel); },
			getContentHeight: function () { return getJsonContentHeight(controller); },
			setHeight: function (height, userResize) { setTextViewerHeight(controller, height, userResize !== false); },
			syncSize: function (captureHeight) { syncTextViewerNormalSize(controller, captureHeight); },
			restoreVisibleMode: function () { restoreJsonVisibleMode(controller); },
			setMode: function (nextMode) { setJsonMode(controller, nextMode); },
			updateToolbar: function () { updateJsonToolbar(controller); },
			isPanelMode: function () { return controller.mode === VIEW_JSON || (controller.mode === VIEW_RAW && controller.canExpandRaw); },
			isThemeableMode: function () { return controller.mode === VIEW_JSON; },
			modeAttribute: spec.modeAttribute,
			layoutAttribute: spec.layoutAttribute,
			defaultMode: spec.defaultMode,
			updatingEditor: false,
			updatingControl: false,
			skipNextControlRender: false,
			editorChangeGeneration: 0,
			suppressedEditorChangeGeneration: null,
		});
	}

	/**
	 * Extends a base controller with generic Ace text behavior.
	 *
	 * @param {object} controller Text viewer controller.
	 * @param {object} spec Controller specification.
	 * @param {jQuery} $status Validation status indicator.
	 * @returns {void}
	 */
	function extendAceTextController(controller, spec, $status) {
		const modeMeta = ACE_TEXT_MODES[spec.mode] || { normalizes: false };
		const storageFormat = controller.$control.is('textarea') && spec.modeConfig.format !== 'compact' ? 'pretty' : 'compact';
		$.extend(controller, {
			$status: $status,
			aceMode: spec.mode,
			modeLabel: spec.modeConfig.label || getModeLabel(spec.mode),
			editorOnly: spec.editorOnly,
			normalizes: !!modeMeta.normalizes,
			displayFormat: 'pretty',
			storageFormat: storageFormat,
			indent: spec.modeConfig.indent || 2,
			mode: spec.initialMode,
			getActivePanel: function () { return getAceTextActivePanel(controller); },
			getPanelSet: function () { return controller.$viewer.add(controller.$rawPanel); },
			getContentHeight: function () { return getAceTextContentHeight(controller); },
			setHeight: function (height, userResize) { setTextViewerHeight(controller, height, userResize !== false); },
			syncSize: function (captureHeight) { syncTextViewerNormalSize(controller, captureHeight); },
			restoreVisibleMode: function () { restoreAceTextVisibleMode(controller); },
			setMode: function (nextMode) { setAceTextMode(controller, nextMode); },
			updateToolbar: function () { updateAceTextToolbar(controller); },
			isPanelMode: function () { return controller.mode === controller.aceMode || (controller.mode === VIEW_RAW && controller.canExpandRaw); },
			isThemeableMode: function () { return controller.mode === controller.aceMode; },
			modeAttribute: spec.modeAttribute,
			layoutAttribute: spec.layoutAttribute,
			defaultMode: spec.defaultMode,
			updatingEditor: false,
			updatingControl: false,
			skipNextControlRender: false,
			editorChangeGeneration: 0,
			suppressedEditorChangeGeneration: null,
		});
	}

	/**
	 * Returns the initial Markdown mode for a field.
	 *
	 * @param {jQuery} $control Textarea control.
	 * @param {object} markdownConfig Markdown enhancement configuration.
	 * @returns {string}
	 */
	function getMarkdownInitialMode($control, markdownConfig) {
		if (markdownConfig.initialMode === VIEW_HTML) {
			return String($control.val() || '').trim() === '' ? VIEW_RAW : VIEW_HTML;
		}
		if (markdownConfig.initialMode === VIEW_MARKDOWN) {
			return VIEW_MARKDOWN;
		}
		return VIEW_RAW;
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
		if (previousMode === VIEW_RAW && mode !== VIEW_RAW) {
			syncMarkdownFromRaw(controller);
		}
		if (previousMode !== mode && previousLayout !== LAYOUT_NORMAL) {
			rememberTextViewerHeight(controller);
			restoreTextViewerLayout(controller);
		}

		controller.mode = mode;
		if (mode === VIEW_RAW) {
			syncTextViewerNormalSize(controller, true);
			showRawMode(controller);
		}
		else if (mode === VIEW_MARKDOWN) {
			syncTextViewerNormalSize(controller, true);
			showMarkdownEditorMode(controller);
		}
		else {
			syncTextViewerNormalSize(controller, true);
			showHtmlMode(controller);
			renderMarkdown(controller);
		}

		updateMarkdownToolbar(controller);
		if (previousMode !== mode && previousLayout === LAYOUT_EXPANDED) {
			expandTextViewer(controller);
		}
		if (previousMode !== mode && previousLayout === LAYOUT_FULLSCREEN) {
			fullscreenTextViewer(controller);
		}
	}

	/**
	 * Updates Markdown editor/preview from the raw field when leaving Raw mode.
	 *
	 * @param {object} controller Markdown controller.
	 * @returns {void}
	 */
	function syncMarkdownFromRaw(controller) {
		if (controller.editor && controller.editor.getValue() !== (controller.$control.val() || '')) {
			controller.editor.setValue(controller.$control.val() || '', -1);
		}
		renderMarkdown(controller);
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
	 * Restores the visible panel for the current Markdown mode.
	 *
	 * @param {object} controller Markdown controller.
	 * @returns {void}
	 */
	function restoreMarkdownVisibleMode(controller) {
		if (controller.mode === VIEW_RAW) {
			showRawMode(controller);
			return;
		}
		if (controller.mode === VIEW_MARKDOWN) {
			showMarkdownEditorMode(controller);
			return;
		}
		showHtmlMode(controller);
	}

	/**
	 * Updates toolbar active states and visible action buttons.
	 *
	 * @param {object} controller Markdown controller.
	 * @returns {void}
	 */
	function updateMarkdownToolbar(controller) {
		LOGGER.log(`Updating Markdown toolbar for '${controller.fieldName}' in mode '${controller.mode}' and layout '${controller.layout}'`, controller);
		updateTextViewerToolbar(controller);
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
	 * Keeps Markdown panels sized to their REDCap row while in normal layout.
	 *
	 * @param {object} controller Markdown controller.
	 * @returns {void}
	 */
	function initMarkdownWindowResize(controller) {
		$(global).on('resize', debounce(function () {
			if ((controller.mode === VIEW_MARKDOWN || controller.mode === VIEW_HTML) && controller.layout === LAYOUT_NORMAL) {
				syncTextViewerNormalSize(controller, false);
			}
		}, 100));
	}

	/**
	 * Initializes the full-width resize handles.
	 *
	 * @param {object} controller Text viewer controller.
	 * @returns {void}
	 */
	function initTextViewerResizeHandles(controller) {
		controller.$resizeHandle.add(controller.$editorResizeHandle).add(controller.$rawResizeHandle).on('mousedown', function (ev) {
			if (controller.layout === LAYOUT_FULLSCREEN) {
				return;
			}
			ev.preventDefault();
			const startY = ev.pageY;
			const startHeight = controller.getActivePanel().outerHeight();
			let resized = false;

			const resizeNamespace = '.rcTextViewerResize' + String(controller.fieldName).replace(/\W/g, '');
			$(document).on('mousemove' + resizeNamespace, function (moveEv) {
				if (!resized) {
					controller.fitToContentActive = false;
					controller.fitToContentRestoreHeight = null;
					resized = true;
				}
				const nextHeight = Math.max(MIN_MARKDOWN_HEIGHT, startHeight + (moveEv.pageY - startY));
				controller.setHeight(nextHeight, true);
			});
			$(document).on('mouseup' + resizeNamespace, function () {
				$(document).off(resizeNamespace);
			});
		}).on('dblclick', function (ev) {
			ev.preventDefault();
			toggleTextViewerContentHeight(controller);
		});
	}

	/**
	 * Stores the current viewer height for its active layout.
	 *
	 * @param {object} controller Text viewer controller.
	 * @returns {void}
	 */
	function rememberTextViewerHeight(controller) {
		const height = controller.getActivePanel().outerHeight();
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
	 * @param {object} controller Text viewer controller.
	 * @param {number} height Viewer height in pixels.
	 * @returns {void}
	 */
	function setTextViewerHeight(controller, height, userResize) {
		height = Math.max(MIN_MARKDOWN_HEIGHT, Math.floor(height));
		controller.getPanelSet().css({
			height: height + 'px',
			'min-height': MIN_MARKDOWN_HEIGHT + 'px',
		});
		controller.$control.css('min-height', '');
		controller.$editor.css('min-height', '');
		if (controller.layout === LAYOUT_NORMAL) {
			controller.normalHeight = height;
			controller.expandedHeight = height;
			if (userResize !== false) {
				controller.userHeight = height;
			}
		}
		if (controller.layout === LAYOUT_EXPANDED) {
			controller.normalHeight = height;
			controller.expandedHeight = height;
			if (userResize !== false) {
				controller.userHeight = height;
			}
		}
		if (controller.layout === LAYOUT_FULLSCREEN) {
			controller.fullscreenHeight = height;
		}
		resizeTextViewerEditor(controller);
	}

	/**
	 * Refreshes an Ace editor after its container size or position changes.
	 *
	 * @param {object} controller Text viewer controller.
	 * @returns {void}
	 */
	function resizeTextViewerEditor(controller) {
		if (!controller.editor) {
			return;
		}

		controller.editor.resize(true);
		if (global.requestAnimationFrame) {
			global.requestAnimationFrame(function () {
				controller.editor.resize(true);
				global.requestAnimationFrame(function () {
					controller.editor.resize(true);
				});
			});
			return;
		}
		global.setTimeout(function () {
			controller.editor.resize(true);
		}, 0);
	}

	/**
	 * Mirrors the raw field footprint for normal viewer mode.
	 *
	 * @param {object} controller Text viewer controller.
	 * @param {boolean} captureHeight Whether to update the remembered normal height.
	 * @returns {void}
	 */
	function syncTextViewerNormalSize(controller, captureHeight) {
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
		if (controller.$editorViewer && controller.$editorViewer.length) {
			controller.$editorViewer.css({
				width: cssWidth,
				height: height + 'px',
				'min-height': MIN_MARKDOWN_HEIGHT + 'px',
				'margin-left': '',
			});
		}
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
		resizeTextViewerEditor(controller);
	}

	/**
	 * Expands the active viewer panel to the full REDCap field row width.
	 *
	 * @param {object} controller Text viewer controller.
	 * @returns {void}
	 */
	function expandTextViewer(controller) {
		if (!controller.canExpandToRowWidth) {
			return;
		}
		if (!controller.isPanelMode()) {
			controller.setMode(controller.defaultMode);
		}
		if (controller.layout !== LAYOUT_NORMAL) {
			rememberTextViewerHeight(controller);
			restoreTextViewerLayout(controller);
		}

		const $panel = controller.getActivePanel();
		const $target = getTextViewerExpandTarget(controller);
		const $expandedCell = createExpandedRow(controller);
		const rowWidth = Math.max((controller.$row.length ? controller.$row.outerWidth() : $target.outerWidth()), $panel.outerWidth());
		const currentHeight = $panel.outerHeight();
		const expandedHeight = controller.userHeight || controller.expandedHeight || Math.max(currentHeight, Math.floor(rowWidth / 2));
		captureTextViewerPlacement(controller);
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
		resizeTextViewerEditor(controller);
		controller.updateToolbar();
	}

	/**
	 * Opens the active viewer panel in a fullscreen overlay.
	 *
	 * @param {object} controller Text viewer controller.
	 * @returns {void}
	 */
	function fullscreenTextViewer(controller) {
		if (!controller.isPanelMode()) {
			controller.setMode(controller.defaultMode);
		}
		if (controller.layout !== LAYOUT_FULLSCREEN) {
			rememberTextViewerHeight(controller);
		}
		if (controller.layout !== LAYOUT_FULLSCREEN) {
			captureTextViewerPlacement(controller);
		}
		const $panel = controller.getActivePanel();
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
		resizeTextViewerEditor(controller);
		controller.updateToolbar();
	}

	/**
	 * Collapses an expanded/fullscreen viewer panel.
	 *
	 * @param {object} controller Text viewer controller.
	 * @returns {void}
	 */
	function collapseTextViewer(controller) {
		if (controller.layout === LAYOUT_NORMAL) {
			controller.updateToolbar();
			return;
		}
		rememberTextViewerHeight(controller);
		restoreTextViewerLayout(controller);
		controller.syncSize(false);
		controller.restoreVisibleMode();
		resizeTextViewerEditor(controller);
		controller.updateToolbar();
	}

	/**
	 * Creates or returns the dedicated expanded table row.
	 *
	 * @param {object} controller Text viewer controller.
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
	 * Returns the container used for row-expanded mode.
	 *
	 * @param {object} controller Text viewer controller.
	 * @returns {jQuery}
	 */
	function getTextViewerExpandTarget(controller) {
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
			|| (controller.$editorViewer && controller.$editorViewer[0] && $.contains(controller.$editorViewer[0], $target[0]))
			|| (controller.$rawPanel && controller.$rawPanel[0] && $.contains(controller.$rawPanel[0], $target[0]))
		) {
			$target = controller.$control.parent();
		}
		return $target;
	}

	/**
	 * Restores moved toolbar and active panel from expanded/fullscreen layouts.
	 *
	 * @param {object} controller Text viewer controller.
	 * @returns {void}
	 */
	function restoreTextViewerLayout(controller) {
		restoreTextViewerPlacement(controller);
		restoreDataCellContents(controller);
		if (controller.$expandedRow && controller.$expandedRow.length) {
			controller.$expandedRow.remove();
			controller.$expandedRow = null;
		}
		controller.layout = LAYOUT_NORMAL;
		controller.$toolbar.removeClass('rc-text-viewer-md-toolbar--expanded rc-text-viewer-md-toolbar--fullscreen');
		controller.getPanelSet().removeClass('rc-text-viewer-md-preview--expanded rc-text-viewer-md-preview--fullscreen');
		controller.$rawPanel.removeClass('rc-text-viewer-md-preview--expanded rc-text-viewer-md-preview--fullscreen');
		if (controller.bodyOverflow !== null) {
			$('body').css('overflow', controller.bodyOverflow);
			controller.bodyOverflow = null;
		}
	}

	/**
	 * Temporarily hides original data-cell contents while row-expanded.
	 *
	 * @param {object} controller Text viewer controller.
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
	 * @param {object} controller Text viewer controller.
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
	 * @param {object} controller Text viewer controller.
	 * @returns {void}
	 */
	function captureTextViewerPlacement(controller) {
		if (controller.restoreParent) {
			return;
		}
		const $panel = controller.getActivePanel();
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
	function restoreTextViewerPlacement(controller) {
		if (!controller.restoreParent) {
			return;
		}
		const $panel = controller.$movedPanel || controller.getActivePanel();
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
	 * Calculates the content height for the active Markdown panel.
	 *
	 * @param {object} controller Markdown controller.
	 * @returns {number}
	 */
	function getMarkdownContentHeight(controller) {
		if (controller.mode === VIEW_RAW) {
			const control = controller.$control[0];
			return control ? control.scrollHeight + controller.$rawResizeHandle.outerHeight() : MIN_MARKDOWN_HEIGHT;
		}
		if (controller.mode === VIEW_MARKDOWN && controller.editor) {
			const lineHeight = controller.editor.renderer.lineHeight || 16;
			return (controller.editor.session.getScreenLength() * lineHeight) + 24;
		}
		if (controller.mode === VIEW_HTML) {
			return controller.$viewerContent.outerHeight(true) + controller.$resizeHandle.outerHeight() + 24;
		}
		return MIN_MARKDOWN_HEIGHT;
	}

	/**
	 * Expands the active panel to fit its content vertically.
	 *
	 * @param {object} controller Text viewer controller.
	 * @returns {void}
	 */
	function expandTextViewerToContent(controller) {
		controller.setHeight(controller.getContentHeight(), true);
	}

	/**
	 * Toggles the active panel between fit-content and its previous height.
	 *
	 * @param {object} controller Text viewer controller.
	 * @returns {void}
	 */
	function toggleTextViewerContentHeight(controller) {
		if (controller.fitToContentActive) {
			controller.setHeight(controller.fitToContentRestoreHeight || MIN_MARKDOWN_HEIGHT, true);
			controller.fitToContentActive = false;
			controller.fitToContentRestoreHeight = null;
			return;
		}
		controller.fitToContentRestoreHeight = Math.max(controller.getActivePanel().outerHeight() || MIN_MARKDOWN_HEIGHT, MIN_MARKDOWN_HEIGHT);
		expandTextViewerToContent(controller);
		controller.fitToContentActive = true;
	}

	/**
	 * Ensures the bundled Ace editor is loaded and configured.
	 *
	 * @returns {Promise}
	 */
	function ensureAce() {
		const aceConfig = getAceConfig();
		const scriptUrl = aceConfig.script || (state.config.urls && state.config.urls.ace);
		return ensureScript(scriptUrl, function () {
			return !!global.ace;
		}).then(function () {
			configureAce(aceConfig);
			return global.ace;
		});
	}

	/**
	 * Returns Ace loader and module configuration.
	 *
	 * @returns {object}
	 */
	function getAceConfig() {
		return state.config.ace || {};
	}

	/**
	 * Registers bundled Ace module URLs.
	 *
	 * @param {object} aceConfig Ace loader and module configuration.
	 * @returns {void}
	 */
	function configureAce(aceConfig) {
		if (state.aceConfigured || !global.ace || !global.ace.config) {
			return;
		}

		registerAceModuleUrls(aceConfig.modes || {});
		registerAceModuleUrls(aceConfig.themes || {});
		Object.keys(aceConfig.workers || {}).forEach(function (module) {
			global.ace.config.setModuleUrl(module, aceConfig.workers[module]);
		});
		state.aceConfigured = true;
	}

	/**
	 * Registers a keyed Ace module descriptor map.
	 *
	 * @param {object} modules Ace module descriptor map.
	 * @returns {void}
	 */
	function registerAceModuleUrls(modules) {
		Object.keys(modules || {}).forEach(function (key) {
			const moduleConfig = modules[key] || {};
			if (moduleConfig.module && moduleConfig.url) {
				global.ace.config.setModuleUrl(moduleConfig.module, moduleConfig.url);
			}
		});
	}

	/**
	 * Creates an Ace editor with module-local defaults.
	 *
	 * @param {string} editorId Ace editor element id.
	 * @param {object} options Editor options.
	 * @returns {object}
	 */
	function createAceEditor(editorId, options) {
		const aceConfig = getAceConfig();
		const modeConfig = getAceModeConfig(options.mode);
		const themeConfig = getAceThemeConfig(options.theme || aceConfig.theme);
		const editor = global.ace.edit(editorId);
		editor.setTheme(themeConfig.module);
		if (modeConfig.module) {
			editor.session.setMode(modeConfig.module);
		}
		configureAceIndent(editor, options.indent);
		editor.setReadOnly(!!options.readOnly);
		editor.setShowPrintMargin(false);
		editor.setHighlightActiveLine(false);
		editor.session.setUseWorker(!!options.useWorker && !!aceConfig.useWorker);
		editor.renderer.setShowGutter(true);
		editor.renderer.setScrollMargin(6, 6, 0, 0);
		return editor;
	}

	/**
	 * Applies indentation settings to an Ace editor session.
	 *
	 * @param {object} editor Ace editor.
	 * @param {number|string} indent Indentation config.
	 * @returns {void}
	 */
	function configureAceIndent(editor, indent) {
		if (indent === 'tab') {
			editor.session.setUseSoftTabs(false);
			return;
		}
		const spaces = parseInt(indent, 10);
		if (Number.isFinite(spaces) && spaces > 0) {
			editor.session.setUseSoftTabs(true);
			editor.session.setTabSize(Math.min(spaces, 8));
		}
	}

	/**
	 * Returns the configured Ace mode descriptor for a language key.
	 *
	 * @param {string} mode Language mode key.
	 * @returns {object}
	 */
	function getAceModeConfig(mode) {
		const modes = getAceConfig().modes || {};
		const modeConfig = modes[mode] || {};
		return $.extend({
			module: mode ? 'ace/mode/' + mode : null,
			url: null,
			worker: null,
		}, modeConfig);
	}

	/**
	 * Returns the configured Ace theme descriptor.
	 *
	 * @param {string} theme Theme key or Ace theme module id.
	 * @returns {object}
	 */
	function getAceThemeConfig(theme) {
		const themeName = theme || 'github_light_default';
		const themes = getAceConfig().themes || {};
		const themeConfig = themes[themeName] || {};
		return $.extend({
			module: themeName.indexOf('ace/theme/') === 0 ? themeName : 'ace/theme/' + themeName,
			url: null,
			worker: null,
		}, themeConfig);
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
			if (!url) {
				reject(new Error('Script URL is missing'));
				return;
			}
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
	function formatJson(raw, format, indent) {
		const text = String(raw || '').trim();
		if (text === '') {
			return { ok: true, empty: true, text: '' };
		}
		try {
			const parsed = JSON.parse(text);
			return { ok: true, empty: false, text: stringifyJson(parsed, format, indent) };
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
	function stringifyJson(parsed, format, indent) {
		return JSON.stringify(parsed, null, format === 'compact' ? 0 : getIndentText(indent));
	}

	/**
	 * Returns an indentation string for formatter modes.
	 *
	 * @param {number|string} indent Indentation config.
	 * @returns {string}
	 */
	function getIndentText(indent) {
		if (indent === 'tab') {
			return '\t';
		}
		const spaces = parseInt(indent, 10);
		if (Number.isFinite(spaces) && spaces > 0) {
			return new Array(Math.min(spaces, 8) + 1).join(' ');
		}
		return '  ';
	}

	/**
	 * Formats text for an Ace language mode.
	 *
	 * @param {string} raw Raw editor value.
	 * @param {string} mode Ace language mode key.
	 * @param {string} format Storage/display format.
	 * @param {number|string} indent Indentation config.
	 * @returns {object}
	 */
	function formatAceText(raw, mode, format, indent) {
		const text = String(raw || '');
		if (text.trim() === '') {
			return { ok: true, empty: true, text: '' };
		}
		if (mode === 'css') {
			return { ok: true, empty: false, text: formatCss(text, format, indent) };
		}
		if (mode === 'xml') {
			return formatXml(text, format, indent);
		}
		return { ok: true, empty: false, text: text };
	}

	/**
	 * Formats CSS with a small, conservative token-based formatter.
	 *
	 * @param {string} raw Raw CSS.
	 * @param {string} format Storage/display format.
	 * @param {number|string} indent Indentation config.
	 * @returns {string}
	 */
	function formatCss(raw, format, indent) {
		const compact = String(raw || '')
			.replace(/\/\*[\s\S]*?\*\//g, function (match) { return match.replace(/\s+/g, ' '); })
			.replace(/\s+/g, ' ')
			.replace(/\s*([{}:;,>+~])\s*/g, '$1')
			.replace(/;}/g, '}')
			.trim();
		if (format === 'compact') {
			return compact;
		}

		const indentText = getIndentText(indent);
		let level = 0;
		return compact
			.replace(/\{/g, ' {\n')
			.replace(/;/g, ';\n')
			.replace(/\}/g, '\n}\n')
			.split('\n')
			.map(function (line) {
				line = line.trim();
				if (line === '') {
					return '';
				}
				if (line.charAt(0) === '}') {
					level = Math.max(level - 1, 0);
				}
				const output = new Array(level + 1).join(indentText) + line;
				if (line.charAt(line.length - 1) === '{') {
					level += 1;
				}
				return output;
			})
			.filter(function (line) { return line !== ''; })
			.join('\n');
	}

	/**
	 * Formats XML and reports parser errors.
	 *
	 * @param {string} raw Raw XML.
	 * @param {string} format Storage/display format.
	 * @param {number|string} indent Indentation config.
	 * @returns {object}
	 */
	function formatXml(raw, format, indent) {
		const parser = new DOMParser();
		const doc = parser.parseFromString(String(raw || ''), 'application/xml');
		const parseError = doc.getElementsByTagName('parsererror')[0];
		if (parseError) {
			return { ok: false, empty: false, text: raw, error: parseError.textContent || 'XML parse error' };
		}

		const serialized = new XMLSerializer().serializeToString(doc);
		const compact = serialized.replace(/>\s+</g, '><').trim();
		if (format === 'compact') {
			return { ok: true, empty: false, text: compact };
		}
		return { ok: true, empty: false, text: prettyXml(compact, indent) };
	}

	/**
	 * Pretty-prints compact XML.
	 *
	 * @param {string} compactXml Compact XML.
	 * @param {number|string} indent Indentation config.
	 * @returns {string}
	 */
	function prettyXml(compactXml, indent) {
		const indentText = getIndentText(indent);
		let level = 0;
		return compactXml
			.replace(/(>)(<)(\/*)/g, '$1\n$2$3')
			.split('\n')
			.map(function (line) {
				line = line.trim();
				if (line === '') {
					return '';
				}
				if (/^<\//.test(line)) {
					level = Math.max(level - 1, 0);
				}
				const output = new Array(level + 1).join(indentText) + line;
				if (/^<[^!?/][^>]*[^/]?>$/.test(line) && !/^<[^>]+>.*<\/[^>]+>$/.test(line)) {
					level += 1;
				}
				return output;
			})
			.filter(function (line) { return line !== ''; })
			.join('\n');
	}

	/**
	 * Sets the visible JSON field mode.
	 *
	 * @param {object} controller JSON controller.
	 * @param {string} mode Desired mode.
	 * @returns {void}
	 */
	function setJsonMode(controller, mode) {
		setAceBackedMode(controller, mode, {
			editorMode: VIEW_JSON,
			editorOnlyProperty: 'jsonOnly',
			renderFromControl: renderJsonFromControl,
			normalizeEditor: normalizeJsonEditor,
			resizeEditor: resizeAceEditor,
			updateToolbar: updateJsonToolbar,
		});
	}

	/**
	 * Updates JSON toolbar active state.
	 *
	 * @param {object} controller JSON controller.
	 * @returns {void}
	 */
	function updateJsonToolbar(controller) {
		updateTextViewerToolbar(controller);
	}

	/**
	 * Returns the active enhanced JSON panel.
	 *
	 * @param {object} controller JSON controller.
	 * @returns {jQuery}
	 */
	function getJsonActivePanel(controller) {
		return getAceBackedActivePanel(controller);
	}

	/**
	 * Restores the visible panel for the current JSON mode.
	 *
	 * @param {object} controller JSON controller.
	 * @returns {void}
	 */
	function restoreJsonVisibleMode(controller) {
		restoreAceBackedVisibleMode(controller, resizeAceEditor);
	}

	/**
	 * Calculates the content height for the active JSON panel.
	 *
	 * @param {object} controller JSON controller.
	 * @returns {number}
	 */
	function getJsonContentHeight(controller) {
		return getAceBackedContentHeight(controller);
	}

	/**
	 * Renders the raw field value into Ace.
	 *
	 * @param {object} controller JSON controller.
	 * @returns {void}
	 */
	function renderJsonFromControl(controller) {
		const formatted = formatJson(controller.$control.val() || '', controller.displayFormat, controller.indent);
		setJsonStatus(controller, formatted);
		if (!controller.editor) {
			return;
		}
		controller.updatingEditor = true;
		setJsonEditorValue(controller, formatted.text);
		controller.updatingEditor = false;
		controller.editor.resize();
	}

	/**
	 * Sets JSON editor text without treating the resulting Ace event as a user edit.
	 *
	 * @param {object} controller JSON controller.
	 * @param {string} value Editor value.
	 * @returns {void}
	 */
	function setJsonEditorValue(controller, value) {
		controller.editorChangeGeneration += 1;
		controller.suppressedEditorChangeGeneration = controller.editorChangeGeneration;
		controller.editor.setValue(value, -1);
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
		const displayFormatted = formatJson(raw, controller.displayFormat, controller.indent);
		setJsonStatus(controller, displayFormatted);
		if (!displayFormatted.ok || controller.editor.getReadOnly()) {
			return;
		}
		const storageFormatted = formatJson(raw, controller.storageFormat, controller.indent);
		if ((controller.$control.val() || '') === storageFormatted.text) {
			return;
		}
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
		const formatted = formatJson(controller.editor.getValue(), controller.displayFormat, controller.indent);
		setJsonStatus(controller, formatted);
		if (!formatted.ok) {
			return;
		}
		controller.updatingEditor = true;
		setJsonEditorValue(controller, formatted.text);
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
	 * Sets the visible generic Ace text mode.
	 *
	 * @param {object} controller Ace text controller.
	 * @param {string} mode Desired mode.
	 * @returns {void}
	 */
	function setAceTextMode(controller, mode) {
		setAceBackedMode(controller, mode, {
			editorMode: controller.aceMode,
			editorOnlyProperty: 'editorOnly',
			renderFromControl: renderAceTextFromControl,
			normalizeEditor: normalizeAceTextEditor,
			resizeEditor: resizeTextViewerEditor,
			updateToolbar: updateAceTextToolbar,
		});
	}

	/**
	 * Updates generic Ace text toolbar state.
	 *
	 * @param {object} controller Ace text controller.
	 * @returns {void}
	 */
	function updateAceTextToolbar(controller) {
		updateTextViewerToolbar(controller);
	}

	/**
	 * Returns the active generic Ace text panel.
	 *
	 * @param {object} controller Ace text controller.
	 * @returns {jQuery}
	 */
	function getAceTextActivePanel(controller) {
		return getAceBackedActivePanel(controller);
	}

	/**
	 * Restores the visible panel for a generic Ace text mode.
	 *
	 * @param {object} controller Ace text controller.
	 * @returns {void}
	 */
	function restoreAceTextVisibleMode(controller) {
		restoreAceBackedVisibleMode(controller, resizeTextViewerEditor);
	}

	/**
	 * Calculates content height for a generic Ace text panel.
	 *
	 * @param {object} controller Ace text controller.
	 * @returns {number}
	 */
	function getAceTextContentHeight(controller) {
		return getAceBackedContentHeight(controller);
	}

	/**
	 * Renders the raw field value into a generic Ace editor.
	 *
	 * @param {object} controller Ace text controller.
	 * @returns {void}
	 */
	function renderAceTextFromControl(controller) {
		const formatted = formatAceText(controller.$control.val() || '', controller.aceMode, controller.displayFormat, controller.indent);
		setAceTextStatus(controller, formatted);
		if (!controller.editor) {
			return;
		}
		controller.updatingEditor = true;
		setAceTextEditorValue(controller, formatted.text);
		controller.updatingEditor = false;
		resizeTextViewerEditor(controller);
	}

	/**
	 * Sets generic Ace editor text without treating the event as a user edit.
	 *
	 * @param {object} controller Ace text controller.
	 * @param {string} value Editor value.
	 * @returns {void}
	 */
	function setAceTextEditorValue(controller, value) {
		controller.editorChangeGeneration += 1;
		controller.suppressedEditorChangeGeneration = controller.editorChangeGeneration;
		controller.editor.setValue(value, -1);
	}

	/**
	 * Syncs generic Ace editor content into the raw REDCap field.
	 *
	 * @param {object} controller Ace text controller.
	 * @returns {void}
	 */
	function syncAceTextFromEditor(controller) {
		if (!controller.editor || controller.updatingEditor) {
			return;
		}
		const raw = controller.editor.getValue();
		const displayFormatted = formatAceText(raw, controller.aceMode, controller.displayFormat, controller.indent);
		setAceTextStatus(controller, displayFormatted);
		if (!displayFormatted.ok || controller.editor.getReadOnly()) {
			return;
		}
		const storageFormatted = formatAceText(raw, controller.aceMode, controller.storageFormat, controller.indent);
		if ((controller.$control.val() || '') === storageFormatted.text) {
			return;
		}
		controller.skipNextControlRender = true;
		controller.updatingControl = true;
		controller.$control.val(storageFormatted.text).trigger('change');
		controller.updatingControl = false;
	}

	/**
	 * Normalizes generic Ace editor content when supported by the mode.
	 *
	 * @param {object} controller Ace text controller.
	 * @returns {void}
	 */
	function normalizeAceTextEditor(controller) {
		if (!controller.editor || controller.updatingEditor || !controller.normalizes) {
			return;
		}
		const formatted = formatAceText(controller.editor.getValue(), controller.aceMode, controller.displayFormat, controller.indent);
		setAceTextStatus(controller, formatted);
		if (!formatted.ok) {
			return;
		}
		controller.updatingEditor = true;
		setAceTextEditorValue(controller, formatted.text);
		controller.updatingEditor = false;
		syncAceTextFromEditor(controller);
		resizeTextViewerEditor(controller);
	}

	/**
	 * Updates generic Ace text validation status.
	 *
	 * @param {object} controller Ace text controller.
	 * @param {object} formatted Formatting result.
	 * @returns {void}
	 */
	function setAceTextStatus(controller, formatted) {
		controller.$viewer.toggleClass('rc-text-viewer--invalid', !formatted.ok);
		controller.$toolbar.toggleClass('rc-text-viewer--invalid', !formatted.ok);
		if (!controller.normalizes || formatted.empty) {
			controller.$status.html('').attr('title', '').attr('aria-label', '');
			return;
		}
		if (formatted.ok) {
			controller.$status
				.attr('title', 'Valid ' + controller.modeLabel)
				.attr('aria-label', 'Valid ' + controller.modeLabel)
				.html($('<i/>', { class: 'fa-solid fa-check text-muted rc-text-viewer-json-status__valid', 'aria-hidden': 'true' }));
			return;
		}
		controller.$status
			.attr('title', 'Invalid ' + controller.modeLabel + ': ' + formatted.error)
			.attr('aria-label', 'Invalid ' + controller.modeLabel + ': ' + formatted.error)
			.html($('<i/>', { class: 'fa-solid fa-triangle-exclamation text-warning rc-text-viewer-json-status__invalid', 'aria-hidden': 'true' }));
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
				attachEnhancedTextViewer($control, field, viewerType);
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
			jsmoName: null,
			labels: {
				raw: 'Raw',
				text: 'Text',
				markdown: 'Markdown',
				html: 'HTML',
				json: 'JSON',
				css: 'CSS',
				ini: 'INI',
				r: 'R',
				xml: 'XML',
				yaml: 'YAML',
			},
			themePreferences: {
				text: THEME_LIGHT,
				json: THEME_LIGHT,
				markdown: THEME_LIGHT,
				css: THEME_LIGHT,
				ini: THEME_LIGHT,
				r: THEME_LIGHT,
				xml: THEME_LIGHT,
				yaml: THEME_LIGHT,
			},
			ace: {
				script: null,
				theme: 'github_light_default',
				useWorker: false,
				modes: {},
				themes: {},
				workers: {},
			},
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
			controllers: state.controllers,
		};
	}

	global[NS] = {
		init: init,
		refresh: attachConfiguredViewers,
	};
})(window, jQuery);
