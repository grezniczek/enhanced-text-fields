/**
 * REDCap SIR (Structured Intermediate Representation)
 *
 */
/* js/sir-plugin.js */
(function (global) {
	'use strict';

	const NS = 'REDCap_SIR';

	if (global[NS]) {
		// If REDCap injects scripts multiple times, avoid redefinition
		return;
	}

	const LOGGER = ConsoleDebugLogger.create({ name: NS });

	//#region ---------- state --------------

	const state = {
		view: 'md', // or 'json'
		snapshot: null, // snapshot = { fetchedAtMs, generated_at, sir_md, sir_json, sir_json_pretty }
		rendered: {
			md: false,
			json: false
		},
		mode: '',
	};
	const ui = {
		toolbarEl: null,
		statusEl: null,
		mdDestEl: null,
		jsonDestEl: null,
	};
	const fetcher = makeAbortableFetcher();
	let cfg;
	let workerClient;

	//#endregion

	//#region ---------- utilities ----------

	function qs(sel) { return document.querySelector(sel); }

	function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

	function nowMs() { return (global.performance && performance.now) ? performance.now() : Date.now(); }

	function sanitizeHtml(html) {
		return global.DOMPurify ? global.DOMPurify.sanitize(html) : html;
	}

	function highlightWithin(root) {
		if (!global.hljs) return;
		root.querySelectorAll('pre code').forEach((el) => global.hljs.highlightElement(el));
	}

	function makeAbortableFetcher() {
		let ctrl = null;
		return {
			abort() { if (ctrl) ctrl.abort(); ctrl = null; },
			async text(url, opts = {}) {
				this.abort();
				ctrl = new AbortController();
				const res = await fetch(url, {
					credentials: 'same-origin',
					signal: ctrl.signal,
					...opts,
				});
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				return await res.text();
			},
			async json(url, opts = {}) {
				this.abort();
				ctrl = new AbortController();
				if (typeof opts.headers === 'undefined') opts.headers = {};
				if (!opts.headers['Accept']) opts.headers['Accept'] = 'application/json';
				const res = await fetch(url, {
					credentials: 'same-origin',
					signal: ctrl.signal,
					...opts,
				});
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				return await res.json();
			},
		};
	}

	function updateAgeText() {
		const age = Date.now() - state.snapshot.fetchedAtMs;
		qs('[data-sir-age]').innerHTML = `Last fetched: <b>${Math.round(age / 1000)}</b> s ago`;
	}

	function downloadText(filename, text, mime) {
		const blob = new Blob([text], { type: mime || 'application/octet-stream' });
		const url = URL.createObjectURL(blob);

		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		a.rel = 'noopener';

		// Safari sometimes needs the element in the DOM
		document.body.appendChild(a);
		a.click();
		a.remove();

		// Give the browser a tick before revoking
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}

	function getCachedMarkdownText() {
		return state.snapshot?.sir_md ?? '';
	}

	function getCachedJsonText(pretty = true) {
		// If your bundle already contains a pretty string, prefer it:
		if (typeof state.snapshot?.sir_json_pretty === 'string') return state.snapshot.sir_json_pretty;

		const j = state.snapshot?.sir_json;

		if (typeof j === 'string') {
			// Already a string (maybe pretty, maybe not)
			if (!pretty) return j;
			try { return JSON.stringify(JSON.parse(j), null, 2); } catch { return j; }
		}

		if (j && typeof j === 'object') {
			return JSON.stringify(j, null, pretty ? 2 : 0);
		}

		return '';
	}

	function makeBaseFilename() {
		const pid = get(
			state.snapshot,
			'sir_json.meta.runtime.pid',
			(new URL(location.href)).searchParams.get('pid')
		);
		const draft = get(
			state.snapshot,
			'sir_json.project.lifecycle.metadata_view',
			'indeterminate'
		);
		const date = toClientTime(get(state.snapshot, 'sir_json.meta.generated_at', (new Date()).toISOString())).replaceAll(':', '').replaceAll(' ', '_');
		return `sir_pid${pid || 'project'}_${draft}_${date}`;
	}

	/**
	   * Safely get nested value from an object.
	   *
	   * @param {object} obj
	   * @param {string|string[]} path - e.g. "meta.project.id" or ["meta","project","id"]
	   * @param {*} [defaultValue]
	   * @returns {*}
	   */
	function get(obj, path, defaultValue = undefined) {
		if (obj == null) return defaultValue;

		const parts = Array.isArray(path)
			? path
			: String(path)
				.replace(/\[(\w+)\]/g, '.$1') // convert [0] to .0
				.replace(/^\./, '')
				.split('.');

		let current = obj;

		for (const key of parts) {
			if (current == null) return defaultValue;
			if (!Object.prototype.hasOwnProperty.call(current, key)) {
				return defaultValue;
			}
			current = current[key];
		}

		return current === undefined ? defaultValue : current;
	}

	/**
	   * Convert GMT/UTC ISO timestamp (e.g. 2026-02-16T21:08:44Z)
	   * to client-local time string in format: YYYY-MM-DD HH:mm:ss
	   *
	   * @param {string} gmtTimeString
	   * @returns {string}
	   */
	function toClientTime(gmtTimeString) {
		if (!gmtTimeString) return '';

		const d = new Date(gmtTimeString);
		if (isNaN(d.getTime())) return '';

		const pad = (n) => String(n).padStart(2, '0');

		return (
			d.getFullYear() + '-' +
			pad(d.getMonth() + 1) + '-' +
			pad(d.getDate()) + ' ' +
			pad(d.getHours()) + ':' +
			pad(d.getMinutes()) + ':' +
			pad(d.getSeconds())
		);
	}

	//#endregion utilities

	//#region ---------- worker dispatcher ----------

	function createWorkerClient(workerUrl, { markedUrl, initTimeoutMs = 5000 } = {}) {
		if (!workerUrl) return null;

		let worker;
		try {
			worker = new Worker(workerUrl);
		} catch {
			return null;
		}

		let seq = 0;
		const pending = new Map(); // id -> {resolve,reject,timeoutHandle}

		function nextId() {
			seq += 1;
			// include time to reduce collision risk across reloads
			return `sir_${Date.now()}_${seq}`;
		}

		worker.addEventListener('message', (ev) => {
			const msg = ev.data || {};
			const id = msg.id;
			if (!id) return;

			const p = pending.get(id);
			if (!p) return;

			pending.delete(id);
			if (p.timeoutHandle) clearTimeout(p.timeoutHandle);

			if (msg.ok) p.resolve(msg);
			else p.reject(new Error(msg.error || 'Worker error'));
		});

		worker.addEventListener('error', (e) => {
			// Hard fail all pending
			for (const [id, p] of pending.entries()) {
				pending.delete(id);
				if (p.timeoutHandle) clearTimeout(p.timeoutHandle);
				p.reject(e);
			}
		});

		function request(type, payload, { timeoutMs = 30000 } = {}) {
			const id = nextId();

			return new Promise((resolve, reject) => {
				const timeoutHandle = timeoutMs
					? setTimeout(() => {
						pending.delete(id);
						reject(new Error(`Worker timeout: ${type}`));
					}, timeoutMs)
					: null;

				pending.set(id, { resolve, reject, timeoutHandle });

				worker.postMessage({ type, id, ...payload });
			});
		}

		let readyPromise = null;

		function init() {
			if (readyPromise) return readyPromise;

			readyPromise = (async () => {
				if (!markedUrl) throw new Error('markedUrl missing for worker init');
				await request('init', { markedUrl }, { timeoutMs: initTimeoutMs });
				return true;
			})();

			return readyPromise;
		}

		async function render(md, { timeoutMs = 60000 } = {}) {
			await init();
			const msg = await request('render', { md }, { timeoutMs });
			return msg.html;
		}

		function destroy() {
			try { worker.terminate(); } catch { }
			for (const [id, p] of pending.entries()) {
				pending.delete(id);
				if (p.timeoutHandle) clearTimeout(p.timeoutHandle);
				p.reject(new Error('Worker destroyed'));
			}
		}

		return { init, render, destroy };
	}
	//#endregion

	//#region ---------- toolbar and views ----------

	function initToolbar() {
		// Event delegation
		$(ui.toolbarEl).on('click', (ev) => {
			const btn = ev.target.closest('[data-sir-action]');
			if (!btn) return;
			ev.preventDefault();
			const action = btn.getAttribute('data-sir-action');

			if (action === 'set-mode' && state.mode === '') {
				// Set mode
				const mode = btn.getAttribute('data-sir-mode');
				state.mode = mode;
				startToLoad();
				return;
			}
			if (action === 'toggle-view') {
				const view = btn.getAttribute('data-sir-view');
				setView(view);
				return;
			}
			if (action == 'switch-mode') {
				const getMode = state.mode === 'prod' ? 'draft' : 'prod';
				window.location.href = cfg.urls.reload + '&mode=' + getMode;
				return;
			}
		});
	}

	function startToLoad() {
		loadBundle().catch((e) => {
			if (e.name === 'AbortError') return;
			if (ui.statusEl) ui.statusEl.textContent = 'Failed.';
			ui.mdDestEl.textContent = String(e);
			console.error(e);
		}).then(() => {
			showOnly(state.view);
			updateViewButtons();
			enableToolbar('set');
			initDownloadMenu(ui.toolbarEl);
			setDownloadsEnabled(true);
		});
	}

	// Make toolbar accessible
	function enableToolbar(mode) {
		const $tb = $(ui.toolbarEl);
		if (mode == 'required') {
			$tb.find('.sir-mode-set').hide();
		}
		else if (mode == 'set') {
			$('.sir-mode-required').remove();
			$tb.find('[data-sir-mode]').each(function () {
				if (!$(this).attr('data-sir-mode').includes(state.mode)) $(this).remove();
			});
			$tb.find('.sir-mode-set').show();
			if (!cfg.draft_enabled) {
				$tb.find('[data-sir-action="switch-mode"]').remove();
			}
		}
		$tb.removeClass('sir-initially-disabled d-none');
	}
	function disableToolbar() {
		const $tb = $(ui.toolbarEl);
		$tb.addClass('sir-initially-disabled d-none');
	}

	function updateViewButtons() {
		const toolbarEl = document.querySelector(cfg.selectors.toolbar);
		if (!toolbarEl) return;

		toolbarEl.querySelectorAll('[data-sir-view]').forEach((btn) => {
			const v = btn.getAttribute('data-sir-view');
			const isActive = (v === state.view);
			btn.classList.toggle('active', isActive);
			btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');

			// Optional: for bootstrap-ish look
			// Active becomes solid, inactive outlined
			btn.classList.toggle('btn-secondary', isActive);
			btn.classList.toggle('btn-outline-secondary', !isActive);
		});
	}

	function showOnly(view) {
		const mdEl = document.querySelector(cfg.selectors.markdownDest);
		const jsonEl = document.querySelector(cfg.selectors.jsonDest);

		if (mdEl) mdEl.style.display = (view === 'md') ? '' : 'none';
		if (jsonEl) jsonEl.style.display = (view === 'json') ? '' : 'none';
	}

	function setView(view) {
		if (view === state.view) return;

		state.view = view;

		// If you have per-view operations that should be aborted, do it here:
		// e.g. abort JSON render / abort MD load, etc.

		showOnly(state.view);
		updateViewButtons();

		// Lazy render JSON if needed (placeholder; you said it’s already displayed, so keep it minimal)
		if (state.view === 'json' && !state.rendered.json) {
			renderJsonView();
		}

		// Lazy render MD if needed (usually already done)
		if (state.view === 'md' && !state.rendered.md) {
			renderMarkdownView();
		}
	}

	function renderMarkdownView() {
		// Already rendered MD HTML into #sir-markdown during initial load
		state.rendered.md = true;
	}

	function renderJsonView() {
		// If pretty JSON text is already cached in snapshot, use it
		const jsonText =
			state.snapshot?.sir_json_pretty ||
			(state.snapshot?.sir_json ? JSON.stringify(state.snapshot.sir_json, null, 2) : '');

		ui.jsonDestEl.innerHTML = '';
		const pre = document.createElement('pre');
		pre.className = 'sir-json-pre';
		pre.textContent = jsonText;
		ui.jsonDestEl.appendChild(pre);

		state.rendered.json = true;
	}

	function downloadFromCache(kind) {
		const base = makeBaseFilename();

		if (kind === 'md') {
			const md = getCachedMarkdownText();
			downloadText(`${base}.md`, md, 'text/markdown;charset=utf-8');
			return;
		}

		if (kind === 'json') {
			const jsonText = getCachedJsonText(true);
			downloadText(`${base}.json`, jsonText, 'application/json;charset=utf-8');
			return;
		}

		if (kind === 'current') {
			// current view depends on state.view
			downloadFromCache(state.view === 'json' ? 'json' : 'md');
			return;
		}
	}

	function initDownloadMenu(toolbarEl) {
		toolbarEl.addEventListener('click', (ev) => {
			const a = ev.target.closest('[data-sir-download]');
			if (!a) return;

			ev.preventDefault();

			const kind = a.getAttribute('data-sir-download');
			if (!state.snapshot) return; // or show status "Not loaded yet"

			if (kind === 'md' || kind === 'json' || kind === 'current') {
				downloadFromCache(kind);
			}
		});
	}

	function setDownloadsEnabled(enabled) {
		document.querySelectorAll('[data-sir-download]').forEach((el) => {
			el.classList.toggle('disabled', !enabled);
			el.setAttribute('aria-disabled', enabled ? 'false' : 'true');
			el.tabIndex = enabled ? 0 : -1;
		});
	}


	async function parseMarkdown(md) {
		if (workerClient) {
			return await workerClient.render(md, { timeoutMs: cfg.worker.renderTimeoutMs });
		}
		if (!global.marked) throw new Error('marked is not available');
		return global.marked.parse(md);
	}

	async function loadBundle() {
		const t0 = nowMs();

		if (ui.statusEl) ui.statusEl.textContent = 'Loading…';
		ui.mdDestEl.innerHTML = '';

		// Allow shell paint
		await new Promise(requestAnimationFrame);

		const bundle = await fetcher.json(cfg.urls.bundle[state.mode]);
		bundle.fetchedAtMs = Date.now();
		state.snapshot = bundle;

		const t1 = nowMs();
		if (ui.statusEl) ui.statusEl.textContent = 'Rendering…';

		const html = await parseMarkdown(bundle.sir_md);

		const t2 = nowMs();

		ui.mdDestEl.innerHTML = sanitizeHtml(html);
		highlightWithin(ui.mdDestEl);
		state.rendered.md = true;

		const t3 = nowMs();

		if (ui.statusEl) ui.statusEl.textContent = '';

		log(`Data loaded in ${Math.round(t1 - t0)} ms. Markdown: ${state.snapshot.sir_md.length} bytes (render time: ${Math.round(t2 - t1)} ms).`, state.snapshot.sir_json);

		updateAgeText();
		setInterval(updateAgeText, 5_000);
	}

	function abort() { fetcher.abort(); }

	function destroy() {
		abort();
		if (workerClient) workerClient.destroy();
	}

	//#endregion

	//#region ---------- main module ----------

	function init(config, jsmo) {
		cfg = Object.assign({
			selectors: {
				toolbar: '#sir-toolbar',
				status: '#sir-status',
				markdownDest: '#sir-markdown',
				jsonDest: '#sir-json',
			},
			urls: {
				markdown: null,   // required
				mdWorker: null,   // optional
				marked: null,     // required if mdWorker is used
			},
			worker: {
				initTimeoutMs: 5000,
				renderTimeoutMs: 120000, // big projects
			},
			debug: false,
			version: '?',
			draft_enabled: false,
			initial_mode: '',
		}, config || {});

		LOGGER.configure({ active: cfg.debug, version: cfg.version });
		const { log, warn, error } = LOGGER;
		log('Initialized', cfg);

		ui.statusEl = qs(cfg.selectors.status);
		ui.toolbarEl = qs(cfg.selectors.toolbar);
		ui.mdDestEl = qs(cfg.selectors.markdownDest);
		ui.jsonDestEl = qs(cfg.selectors.jsonDest);
		if (!ui.toolbarEl) { error('toolbar element not found'); return; }
		if (!ui.statusEl) { error('status element not found'); return; }
		if (!ui.mdDestEl) { error('markdown destination element not found'); return; }
		if (!ui.jsonDestEl) { error('json destination element not found'); return; }
		if (!cfg.urls.bundle) { error('urls.bundle missing'); return; }

		workerClient = createWorkerClient(cfg.urls.mdWorker, {
			markedUrl: cfg.urls.marked,
			initTimeoutMs: cfg.worker.initTimeoutMs,
		});

		state.mode = cfg.initial_mode;

		// Act depending on project state (drafted changes?)

		initToolbar();
		if (cfg.draft_enabled && state.mode === '') {
			// Nedd to ask user which state to load
			enableToolbar('required');
		}
		else {
			startToLoad();
		}

		return {
			config: cfg,
			jsmo,
			reload: loadBundle,
			abort,
			destroy,
		};
	}

	global[NS] = { init };

	//#endregion

})(window);


