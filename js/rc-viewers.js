/* js/rc-viewers.js */
(function (global, $) {
	'use strict';

	const NS = 'REDCapTextViewers';

	if (global[NS]) {
		return;
	}

	const LOGGER = global.ConsoleDebugLogger
		? global.ConsoleDebugLogger.create({ name: NS })
		: makeFallbackLogger();

	const state = {
		config: null,
		acePromise: null,
		editors: {},
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
	 * Renders a Markdown viewer and wires it to field changes.
	 *
	 * @param {jQuery} $control Field input or textarea.
	 * @param {string} fieldName REDCap field name.
	 * @returns {void}
	 */
	function attachMarkdownViewer($control, fieldName) {
		const $shell = createViewerShell($control, fieldName, 'markdown');
		const $body = $shell.find('.rc-text-viewer__body');
		const $status = $shell.find('.rc-text-viewer__status');
		const render = debounce(function () {
			const markdown = $control.val() || '';
			if (!global.marked || typeof global.marked.parse !== 'function') {
				$body.html($('<pre/>').text(markdown));
				$status.text('marked unavailable');
				return;
			}

			try {
				const html = global.marked.parse(markdown, { breaks: true, gfm: true });
				$body.html($('<div/>', { class: 'markdown-body' }).html(sanitizeHtml(html)));
				if (global.hljs) {
					$body.find('pre code').each(function () {
						global.hljs.highlightElement(this);
					});
				}
				$status.text(markdown === '' ? 'empty' : '');
			}
			catch (e) {
				$body.html($('<pre/>').text(markdown));
				$status.text('render failed');
				LOGGER.warn('Markdown render failed', fieldName, e);
			}
		}, 100);

		$control.on('input change keyup', render);
		render();
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
				if (viewerType === 'markdown') {
					attachMarkdownViewer($control, field.name);
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
		};
	}

	global[NS] = {
		init: init,
		refresh: attachConfiguredViewers,
	};
})(window, jQuery);
