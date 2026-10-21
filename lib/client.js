/**
 * Context compaction on right-click — browser half.
 *
 * The composer's context meter (the ring reading `45%` at the bottom-right of
 * the input card, `ui-conversation`'s `ContextMeter`) is the one control whose
 * subject *is* context pressure, so a right-click on it is the shortest gesture
 * for "fold this session now". The ring's left-click already opens the
 * breakdown panel and is deliberately left alone; only `contextmenu` is taken,
 * and only while the pointer is inside that exact button.
 *
 * What the gesture runs is the shipped human-facing compaction path and nothing
 * private: `ctx.remote.commands.execute(sessionId, "/compact", [])`, i.e. the
 * same `/compact` command the composer would submit, with the same Host
 * executor, the same durable `command/run` … `command/done` lifecycle, and the
 * same `manual-compaction` node in the transcript. This plugin adds a gesture
 * and a transient banner; it never touches compaction itself.
 *
 * Nothing is replaced or re-declared. `ContextMeter` is rendered directly by
 * the composer skeleton rather than through a Slot, so the ring is found
 * *structurally* — never by hashed CSS-module class name, which changes with
 * every official build. The only DOM this plugin owns is one `display:none`
 * marker inside the `conversation.composer.dock` Slot, which exists purely to
 * anchor the search at the right conversation: a second Conversation (a Sidebar
 * chat tab) mounts a second meter, and each cell binds only its own.
 *
 * @module dsh-plugin-context-compact/client
 */

window.__ModuleLoader__.load({
	// A bare (unscoped) package name is the resolved package's own name.
	id: "dsh-plugin-context-compact",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		let primitives = require("@deepseek-ai/dsh-client-ui-primitives");

		//#region copy
		/** Dictionary namespace owned by this plugin. */
		const NS = "context-compact";
		/** The command line the gesture submits; exactly what the composer would send. */
		const COMMAND_LINE = "/compact";
		/** Chinese copy — the key set the English dictionary is checked against. */
		const zh = {
			"toast.running": "正在压缩上下文…",
			"toast.done": "上下文已压缩，较早的历史已折叠为检查点。",
			"toast.doneCount": "上下文已压缩：折叠了 {count} 条历史（约 {tokens}）。",
			"toast.nothing": "还没有可压缩的历史。",
			"toast.refused": "压缩请求被拒绝：{detail}",
			"toast.failed": "压缩未完成：{detail}",
			"toast.unknown": "压缩请求未被识别，可能缺少 /compact 命令。",
			"toast.unreachable": "压缩请求没有送达：{detail}"
		};
		/** English copy, checked against the Chinese key set. */
		const en = {
			"toast.running": "Compacting context…",
			"toast.done": "Context compacted — older history is folded into a checkpoint.",
			"toast.doneCount": "Context compacted: {count} history items folded (~{tokens}).",
			"toast.nothing": "There is no compactable history yet.",
			"toast.refused": "The compaction request was refused: {detail}",
			"toast.failed": "Compaction did not finish: {detail}",
			"toast.unknown": "The compaction request was not recognized; the /compact command may be missing.",
			"toast.unreachable": "The compaction request did not reach the app: {detail}"
		};
		//#endregion

		//#region meter detection
		/**
		 * The Slot this plugin's marker sits in. Its own parent element is the
		 * composer's dock row — the flex row that also holds the meter.
		 */
		const DOCK_SLOT = "conversation.composer.dock";
		/** Selector for that Slot's anchor element, as the Slot renderer emits it. */
		const SLOT_SELECTOR = `[data-slot="${DOCK_SLOT}"]`;
		/** The composer card the banner centers over, as the composer marks it. */
		const CARD_SELECTOR = "[data-composer-card]";
		/** Ring geometry `ContextMeter` draws: one 14×14 svg with exactly two circles. */
		const METER_VIEW_BOX = "0 0 14 14";
		const METER_CIRCLES = 2;
		/** The trigger's entire text content is its reading, e.g. `45%`. */
		const METER_READING = /^\d{1,3}%$/u;

		/**
		 * Whether a `button` is the composer's context meter.
		 *
		 * Every signal is structural — `aria-haspopup`, ring geometry, and the
		 * percentage the button paints — so no build's hashed class name is
		 * load-bearing. Anything this cannot prove is simply not the meter, and a
		 * miss costs one unhandled right-click (the browser menu), never a wrong
		 * compaction.
		 * @param candidate - element the dock holds, usually a `button`.
		 * @returns true only for the meter's trigger.
		 */
		function isContextMeterTrigger(candidate) {
			if (candidate === null || candidate === undefined) return false;
			if (typeof candidate.getAttribute !== "function") return false;
			if (String(candidate.tagName).toUpperCase() !== "BUTTON") return false;
			if (candidate.getAttribute("aria-haspopup") !== "dialog") return false;
			const svg = typeof candidate.querySelector === "function" ? candidate.querySelector("svg") : null;
			if (svg === null || svg === undefined || typeof svg.getAttribute !== "function") return false;
			if (svg.getAttribute("viewBox") !== METER_VIEW_BOX) return false;
			const circles = typeof svg.querySelectorAll === "function" ? svg.querySelectorAll("circle") : null;
			if (circles === null || circles === undefined || circles.length !== METER_CIRCLES) return false;
			return METER_READING.test(String(candidate.textContent ?? "").trim());
		}

		/**
		 * The meter trigger inside one composer dock, or null while the meter is not
		 * rendered (no provider has reported both pressure and a route capacity, or
		 * the composer is showing an activity action in its place).
		 * @param container - the composer's dock element.
		 * @returns the trigger, or null.
		 */
		function meterTriggerIn(container) {
			if (container === null || container === undefined) return null;
			if (typeof container.querySelectorAll !== "function") return null;
			for (const candidate of container.querySelectorAll('button[aria-haspopup="dialog"]')) {
				if (isContextMeterTrigger(candidate)) return candidate;
			}
			return null;
		}

		/**
		 * The composer dock that holds this cell's own meter.
		 *
		 * The walk is anchored on the Slot the cell was registered into, so a second
		 * Conversation on the page resolves to its own dock rather than to whichever
		 * meter happens to come first in the document.
		 * @param marker - this cell's own marker element.
		 * @returns the dock element, or null.
		 */
		function dockOf(marker) {
			if (marker === null || marker === undefined) return null;
			const anchor = typeof marker.closest === "function" ? marker.closest(SLOT_SELECTOR) : null;
			if (anchor !== null && anchor !== undefined) return anchor.parentElement;
			return marker.parentElement ?? null;
		}
		//#endregion

		//#region outcome
		/**
		 * The count and token figures the `/compact` handler embeds in its success
		 * text (`Compacted 12 history items (~8400 tokens).`). Read only to make the
		 * banner concrete; a miss falls back to the unnumbered sentence.
		 */
		const COMPACTED_COUNTS = /(\d[\d,]*)\D+\(~([^)]+)\)/u;

		/**
		 * Translate one `commands.execute` response into banner state.
		 *
		 * Pure, and the whole reason the gesture's result can be described in the
		 * reader's language without reparsing prose: the Host's success payload
		 * carries `sourceEventSeq` exactly when it actually folded history, so
		 * "nothing to compact" is told apart structurally instead of by matching an
		 * English sentence.
		 * @param response - the Remote result envelope, or anything else that arrived.
		 * @returns `{ key, params?, tone?, warn? }` naming banner copy.
		 */
		function outcomeOf(response) {
			if (response === null || typeof response !== "object") {
				return { key: "toast.unreachable", params: { detail: "no response" }, warn: true };
			}
			if (response.ok === false) {
				const error = response.error;
				const detail = error === null || error === undefined
					? "unknown error"
					: `${error.code ?? "error"}: ${error.message ?? ""}`.trim();
				return { key: "toast.refused", params: { detail }, warn: true };
			}
			const value = response.value;
			if (value === null || value === undefined) return { key: "toast.unknown", warn: true };
			const result = value.result;
			if (result === null || result === undefined) return { key: "toast.unknown", warn: true };
			if (result.kind === "success") {
				if (result.sourceEventSeq === undefined) return { key: "toast.nothing" };
				const counts = COMPACTED_COUNTS.exec(typeof result.text === "string" ? result.text : "");
				if (counts === null) return { key: "toast.done", tone: "success" };
				return { key: "toast.doneCount", params: { count: counts[1], tokens: counts[2] }, tone: "success" };
			}
			const text = typeof result.text === "string" ? result.text.trim() : "";
			if (text.length === 0) return { key: "toast.failed", params: { detail: "unknown error" }, warn: true };
			return { key: "toast.failed", params: { detail: text }, warn: true };
		}
		//#endregion

		//#region presentation
		/** How long the in-flight banner holds before the result replaces it. */
		const RUNNING_HOLD_MS = 120000;
		/** How long a finished banner holds before it starts fading. */
		const DONE_HOLD_MS = 4000;
		/** A failure names what broke, so it is given longer to be read. */
		const FAILED_HOLD_MS = 8000;

		/**
		 * One invisible cell whose only job is to bind `contextmenu` on this
		 * conversation's dock and report the outcome through the shared banner.
		 *
		 * The cell renders `display:none`: it is a mount point in the DOM tree, not
		 * a flex item, so the dock's layout is byte-for-byte what it was before.
		 * @param props - Slot props plus this plugin's `t` and `compact`.
		 * @returns the marker plus an optional banner.
		 */
		function ContextCompactCell({ sessionId, t, compact }) {
			const markerRef = react.useRef(null);
			const [toast, setToast] = react.useState(null);
			const [anchor, setAnchor] = react.useState(null);
			const busyRef = react.useRef(false);
			const seqRef = react.useRef(0);

			/**
			 * Run one compaction for this cell's session.
			 *
			 * Re-entrancy is refused locally rather than left to the Host: a second
			 * gesture while one compaction is in flight has nothing to add, and the
			 * Host would only answer `busy`.
			 */
			const run = react.useCallback(async () => {
				if (busyRef.current) return;
				if (typeof sessionId !== "string" || sessionId.length === 0) return;
				busyRef.current = true;
				seqRef.current += 1;
				setToast({ seq: seqRef.current, key: "toast.running", holdMs: RUNNING_HOLD_MS });
				let outcome;
				try {
					outcome = await compact(sessionId);
				} catch (error) {
					const detail = error !== null && typeof error === "object" && typeof error.message === "string"
						? error.message
						: String(error);
					outcome = { key: "toast.unreachable", params: { detail }, warn: true };
				} finally {
					busyRef.current = false;
				}
				seqRef.current += 1;
				setToast({
					seq: seqRef.current,
					...outcome,
					holdMs: outcome.warn === true ? FAILED_HOLD_MS : DONE_HOLD_MS
				});
			}, [compact, sessionId]);

			react.useEffect(() => {
				const marker = markerRef.current;
				if (marker === null) return undefined;
				const dock = dockOf(marker);
				if (dock === null || typeof dock.addEventListener !== "function") return undefined;
				const root = dock.parentElement ?? null;
				setAnchor(root === null ? null : root.querySelector(CARD_SELECTOR));
				const onContextMenu = (event) => {
					const trigger = meterTriggerIn(dock);
					// Rising edge only: the gesture is taken exactly when the pointer is
					// inside the meter, and is left entirely alone everywhere else.
					if (trigger === null || !trigger.contains(event.target)) return;
					event.preventDefault();
					void run();
				};
				dock.addEventListener("contextmenu", onContextMenu);
				return () => dock.removeEventListener("contextmenu", onContextMenu);
			}, [run]);

			return react_jsx_runtime.jsxs(react.Fragment, {
				children: [
					react_jsx_runtime.jsx("span", {
						ref: markerRef,
						"data-context-compact-anchor": "",
						style: { display: "none" }
					}),
					toast === null ? null : react_jsx_runtime.jsx(primitives.Toast, {
						key: toast.seq,
						text: t(toast.key, toast.params),
						tone: toast.tone,
						icon: toast.warn === true ? react_jsx_runtime.jsx(primitives.IconWarningOutlineRegular, {}) : undefined,
						holdMs: toast.holdMs,
						anchor,
						onDone: () => setToast(null)
					})
				]
			});
		}
		//#endregion

		//#region activation
		/** Services required by the right-click cell. */
		const inject = ["slots", "locale", "remote", "remote.commands"];

		/**
		 * Mount the right-click cell and the command call behind it.
		 * @param ctx - client root context.
		 */
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "context-compact: dictionaries");
			const translate = ctx.locale.bind(NS);
			/**
			 * Translate one of this plugin's keys.
			 *
			 * A dictionary miss returns the key itself, which would paint a raw
			 * `toast.*` string into the banner, so a miss falls back to the Chinese
			 * dictionary — the key set both dictionaries are checked against.
			 * @param key - namespaced key owned by this plugin.
			 * @param params - `{slot}` values to interpolate.
			 * @returns display copy.
			 */
			const t = (key, params) => {
				const text = translate(key, params);
				if (text !== key) return text;
				const fallback = zh[key] ?? key;
				if (params === undefined) return fallback;
				return fallback.replace(/\{(\w+)\}/gu, (match, name) => (name in params ? String(params[name]) : match));
			};
			/**
			 * Submit `/compact` to this session's Host executor.
			 * @param sessionId - the session whose history is folded.
			 * @returns banner state describing the executor's own outcome.
			 */
			const compact = async (sessionId) => outcomeOf(await ctx.remote.commands.execute(sessionId, COMMAND_LINE, []));
			// Order 20 keeps the cell last among the composer's dock entries. It has no
			// box, so the position is cosmetic; only the anchor matters.
			ctx.slots.inject(DOCK_SLOT, () => ctx.slots.register({
				name: DOCK_SLOT,
				id: "context-compact",
				order: 20,
				locale: NS
			}, (props) => react_jsx_runtime.jsx(ContextCompactCell, { ...props, t, compact })));
		}
		//#endregion

		// Exported for the plugin's own regression check: the gesture's whole
		// discrimination and reporting logic is pure and has to be provably right.
		exports.isContextMeterTrigger = isContextMeterTrigger;
		exports.meterTriggerIn = meterTriggerIn;
		exports.dockOf = dockOf;
		exports.outcomeOf = outcomeOf;
		exports.ContextCompactCell = ContextCompactCell;
		// Both dictionaries travel with the module so the check can prove the two key
		// sets still agree, and that every banner state names a key that exists.
		exports.zh = zh;
		exports.en = en;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
