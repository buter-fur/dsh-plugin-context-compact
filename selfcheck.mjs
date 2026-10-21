/**
 * Self-check for dsh-plugin-context-compact.
 *
 * Run it from the plugin directory:
 *
 *     node selfcheck.mjs
 *
 * It replays the parts that have to be provably right and cannot be seen by
 * looking at the installed app:
 *
 *   1. neither half imports a bare specifier (one in the Host half fails the
 *      whole plugin, browser half included, because `~/.dsh` has no
 *      `node_modules` up its tree);
 *   2. the Host half loads under Node and exports the Cordis row shape;
 *   3. the browser half registers itself through `window.__ModuleLoader__` and
 *      exports its two pure decisions: which `button` is the context meter, and
 *      what a `/compact` response should say to the reader;
 *   4. `apply` mounts exactly one cell, into the composer dock, with the
 *      services it declares;
 *   5. the bundle manifest is coherent: every runtime/display export exists, the
 *      patch inserts the one row Settings toggles, and both locales and the icon
 *      satisfy the display-metadata contract (title, description, ≤ 256 KiB SVG).
 *
 * The browser half is not a module — the page evaluates it as a script — so the
 * check does the same, in a `node:vm` context, with stubbed `react` and
 * primitives. Nothing is rendered; only the pure helpers and the mount are
 * exercised.
 *
 * @module dsh-plugin-context-compact/selfcheck
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { runInThisContext } from "node:vm";
import assert from "node:assert/strict";

/** Halves whose import surface is a hard constraint. */
const SOURCES = ["lib/index.js", "lib/client.js"];

//#region 1. dependency surface
for (const file of SOURCES) {
	const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
	for (const match of source.matchAll(/^\s*import\s[^;]*?from\s+["']([^"']+)["']/gmu)) {
		const specifier = match[1];
		if (!specifier.startsWith("node:") && !specifier.startsWith("./") && !specifier.startsWith("../")) {
			throw new Error(`${file}: bare specifier is not resolvable from the plugin directory -> ${specifier}`);
		}
	}
}
console.log("dependency surface ok (no bare specifiers in either half)");

//#region 2. host half
const host = await import(new URL("./lib/index.js", import.meta.url).href);
assert.equal(host.name, "context-compact", "host half must export its Cordis name");
assert.ok(Array.isArray(host.inject), "host half must export an inject array");
assert.equal(typeof host.apply, "function", "host half must export apply");
console.log(`host half ok (name=${host.name}, inject=[${host.inject.join(",")}])`);

//#region 3. browser half, evaluated the way the page evaluates it
/** One loaded `window.__ModuleLoader__.load` definition. */
let definition = null;
// Evaluated in this realm on purpose — a fresh `node:vm` realm would give the
// module its own `Object.prototype`, and every later `deepEqual` against a
// dictionary or a params object would fail on the prototype rather than the value.
const load = runInThisContext(
	`(function (window) {\n${readFileSync(new URL("./lib/client.js", import.meta.url), "utf8")}\n})`,
	{ filename: "lib/client.js" }
);
load({ __ModuleLoader__: { load: (value) => { definition = value; } } });
assert.ok(definition !== null, "client half must register itself through window.__ModuleLoader__.load");
assert.equal(definition.id, "dsh-plugin-context-compact", "client half must register under the package name");

/** Only the names the cell and its renderer touch need to exist. */
const stubRequire = (specifier) => specifier === "@deepseek-ai/dsh-client-ui-primitives"
	? { Toast: function Toast() {}, IconWarningOutlineRegular: function IconWarningOutlineRegular() {} }
	: {};
const client = definition.factory(stubRequire);
assert.equal(typeof client.apply, "function", "client half must export apply");
assert.deepEqual(
	Object.keys(client.zh).sort(),
	Object.keys(client.en).sort(),
	"the zh and en dictionaries must share one key set"
);
console.log(`client half ok (id=${definition.id}, ${Object.keys(client.zh).length} dictionary keys)`);

//#region 4. meter discrimination
/**
 * The minimum element surface `isContextMeterTrigger` reads.
 * @param tag - tag name, as the DOM spells it (`BUTTON` / `svg`).
 * @param attributes - the attributes the predicate asks for.
 * @param children - child elements, for the `svg` / `circle` reads.
 * @param text - the element's whole text content.
 * @returns an element-shaped stub.
 */
function element(tag, attributes = {}, children = [], text = "") {
	return {
		tagName: tag,
		textContent: text,
		getAttribute: (name) => (name in attributes ? attributes[name] : null),
		querySelector: (selector) => (selector === "svg" ? children.find((child) => child.tagName === "svg") ?? null : null),
		querySelectorAll: (selector) => (selector === "circle" ? children.filter((child) => child.tagName === "circle") : [])
	};
}
/** The ring exactly as `ContextMeter` draws it. */
const ring = element("svg", { viewBox: "0 0 14 14" }, [element("circle"), element("circle")]);
/** The meter's trigger: dialog popup, the ring, and the reading as its whole text. */
const meter = element("BUTTON", { "aria-haspopup": "dialog" }, [ring, element("span", {}, [], "45%")], "45%");
/** The model selector: also a dialog popup, but a 16px glyph rather than the ring. */
const modelSelector = element("BUTTON", { "aria-haspopup": "dialog" }, [
	element("svg", { viewBox: "0 0 16 16" }, [element("path")])
], "deepseek-flash");
/** A menu trigger that happens to be a button. */
const menuTrigger = element("BUTTON", { "aria-haspopup": "menu" }, [], "…");

assert.equal(client.isContextMeterTrigger(meter), true, "the meter's own trigger must be recognized");
assert.equal(client.isContextMeterTrigger(modelSelector), false, "a dialog popup without the ring must be refused");
assert.equal(client.isContextMeterTrigger(menuTrigger), false, "a menu popup must be refused");
assert.equal(client.isContextMeterTrigger(element("BUTTON", { "aria-haspopup": "dialog" }, [
	element("svg", { viewBox: "0 0 14 14" }, [element("circle")])
], "45%")), false, "a one-circle ring must be refused");
assert.equal(client.isContextMeterTrigger(element("BUTTON", { "aria-haspopup": "dialog" }, [ring], "loading")), false,
	"a trigger that is not painting a percentage must be refused");
assert.equal(client.isContextMeterTrigger(element("svg", { "aria-haspopup": "dialog" }, [ring], "45%")), false,
	"a non-button must be refused");
assert.equal(client.isContextMeterTrigger(null), false, "a missing candidate must be refused");

const dockWithMeter = { querySelectorAll: () => [modelSelector, meter] };
assert.equal(client.meterTriggerIn(dockWithMeter), meter, "the meter must be found among other popups");
assert.equal(client.meterTriggerIn({ querySelectorAll: () => [modelSelector] }), null, "an absent meter must read as absent");
assert.equal(client.meterTriggerIn(null), null, "a missing dock must read as absent");
console.log("meter discrimination ok (7 negatives, ring recognized, dock search)");

//#region 5. anchor walk
/** The Slot anchor this plugin's cell is registered into. */
const SLOT_SELECTOR = '[data-slot="conversation.composer.dock"]';
/** The dock row the shell renders around that anchor. */
const dockElement = { addEventListener: () => {}, removeEventListener: () => {} };
const anchorElement = { parentElement: dockElement };
/** The cell's marker, inside whichever wrapper the Slot renderer emitted. */
const marker = {
	parentElement: { parentElement: anchorElement, closest: () => null },
	closest: (selector) => (selector === SLOT_SELECTOR ? anchorElement : null)
};
assert.equal(client.dockOf(marker), dockElement, "the dock must be the anchor's own parent");
assert.equal(client.dockOf({ parentElement: dockElement, closest: () => null }), dockElement,
	"without an anchor the marker's own parent is the fallback");
assert.equal(client.dockOf({ parentElement: dockElement }), dockElement, "a marker without closest must not throw");
assert.equal(client.dockOf(null), null, "a missing marker must not throw");
console.log("anchor walk ok (slot anchor first, marker parent as fallback)");

//#region 6. outcome mapping
const success = (text, sourceEventSeq) => ({
	ok: true,
	value: { commandId: "cmd", result: sourceEventSeq === undefined ? { kind: "success", text } : { kind: "success", text, sourceEventSeq } }
});
/** Every case, with the banner state it must produce. */
const cases = [
	[success("Compacted 12 history items (~8400 tokens).", 42),
		{ key: "toast.doneCount", params: { count: "12", tokens: "8400 tokens" }, tone: "success" }],
	[success("Compacted 1 history item (~96 tokens).", 7),
		{ key: "toast.doneCount", params: { count: "1", tokens: "96 tokens" }, tone: "success" }],
	[success("Compacted 1,024 history items (~1.5M tokens).", 9),
		{ key: "toast.doneCount", params: { count: "1,024", tokens: "1.5M tokens" }, tone: "success" }],
	[success("Compacted some history.", 3), { key: "toast.done", tone: "success" }],
	// No `sourceEventSeq` is how the Host says it folded nothing; the check pins
	// that down so the sentence is never matched for its own wording.
	[success("No compactable history yet."), { key: "toast.nothing" }],
	[{ ok: true, value: { commandId: "cmd", result: { kind: "error", text: "Compaction cancelled." } } },
		{ key: "toast.failed", params: { detail: "Compaction cancelled." }, warn: true }],
	[{ ok: true, value: { commandId: "cmd", result: { kind: "error", text: "   " } } },
		{ key: "toast.failed", params: { detail: "unknown error" }, warn: true }],
	[{ ok: true }, { key: "toast.unknown", warn: true }],
	[{ ok: true, value: undefined }, { key: "toast.unknown", warn: true }],
	[{ ok: false, error: { code: "disconnected", message: "no live client" } },
		{ key: "toast.refused", params: { detail: "disconnected: no live client" }, warn: true }],
	[{ ok: false }, { key: "toast.refused", params: { detail: "unknown error" }, warn: true }],
	[null, { key: "toast.unreachable", params: { detail: "no response" }, warn: true }],
	["nonsense", { key: "toast.unreachable", params: { detail: "no response" }, warn: true }]
];
for (const [input, expected] of cases) {
	const actual = client.outcomeOf(input);
	// The last-but-one case above carries an unmatched success sentence; assert on
	// the key and tone only where the numbers cannot be extracted.
	assert.equal(actual.key, expected.key, `key for ${JSON.stringify(input)}`);
	assert.equal(actual.tone, expected.tone, `tone for ${JSON.stringify(input)}`);
	assert.equal(actual.warn, expected.warn, `warn for ${JSON.stringify(input)}`);
	if (expected.params !== undefined) assert.deepEqual(actual.params, expected.params, `params for ${JSON.stringify(input)}`);
	assert.ok(client.zh[actual.key] !== undefined && client.en[actual.key] !== undefined,
		`banner key ${actual.key} must exist in both dictionaries`);
}
console.log(`outcome mapping ok (${cases.length} cases, every key localized)`);

//#region 7. mount
/** Services `apply` must ask for. */
const declared = ["slots", "locale", "remote", "remote.commands"];
assert.deepEqual(client.inject, declared, "the cell must declare exactly the services it uses");
const injected = [];
const registered = [];
const effects = [];
client.apply({
	effect: (callback) => { effects.push(callback()); return () => {}; },
	locale: { register: () => () => {}, bind: () => (key) => key },
	remote: { commands: { execute: async () => success("No compactable history yet.") } },
	slots: {
		inject: (key, callback) => { injected.push(key); callback(); },
		register: (options, render) => { registered.push({ options, render }); return () => {}; }
	}
});
assert.deepEqual(injected, ["conversation.composer.dock"], "the cell must attach to the composer dock");
assert.equal(registered.length, 1, "exactly one dock cell must be registered");
assert.equal(registered[0].options.id, "context-compact", "the cell must claim its own id");
assert.equal(registered[0].options.name, "conversation.composer.dock", "the cell must re-state its slot");
assert.equal(typeof registered[0].render, "function", "the cell must render");
console.log(`mount ok (slot=${injected[0]}, id=${registered[0].options.id}, order=${registered[0].options.order})`);

//#region 8. bundle manifest
// Settings renders this package without activating it, from exports alone: a
// broken export or missing icon degrades the row to default artwork and name.
const manifest = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
assert.equal(manifest.type, "module", "the Host half is an ES module");
assert.equal(manifest.dsh?.bundle?.patch, "./cordis.patch.yml", "the package must declare its bundle patch");
assert.equal(manifest.dsh?.client?.platform, "web", "the browser half is a Web client module");
/** `exports` values are a string or a conditions object; wildcards are checked by use. */
const targetOf = (value) => (typeof value === "string" ? value : value?.default);
for (const [specifier, value] of Object.entries(manifest.exports)) {
	const target = targetOf(value);
	if (target === undefined || target.includes("*")) continue;
	assert.ok(existsSync(new URL(target, import.meta.url)), `exports ${specifier} -> ${target} must exist`);
}
const patch = readFileSync(new URL(manifest.dsh.bundle.patch, import.meta.url), "utf8");
assert.match(patch, /^\s*-\s*insert:/mu, "the bundle patch must insert a row");
assert.match(patch, /id:\s*context-compact\b/u, "the patch must insert the id Settings toggles");
assert.match(patch, /name:\s*dsh-plugin-context-compact\b/u, "the patch must mount this package");
const LOCALES = ["zh", "en"];
/** Display metadata, keyed by locale, so the copy can be compared across them. */
const meta = {};
for (const locale of LOCALES) {
	const file = new URL(`./locale/${locale}.json`, import.meta.url);
	assert.ok(existsSync(file), `locale/${locale}.json must exist`);
	meta[locale] = JSON.parse(readFileSync(file, "utf8")).meta;
	assert.ok(meta[locale]?.title?.trim(), `locale/${locale}.json needs meta.title`);
	assert.ok(meta[locale]?.description?.trim(), `locale/${locale}.json needs meta.description`);
}
// Independent copy, not one locale copied into the other: the cheap template
// failure is leaving English text (or literal "TODO") under the zh file.
assert.notEqual(meta.zh.title, meta.en.title, "the two locales must carry their own title");
const icon = new URL("./icon.svg", import.meta.url);
assert.ok(existsSync(icon), "icon.svg must exist");
const iconBytes = statSync(icon).size;
assert.ok(iconBytes > 0 && iconBytes <= 256 * 1024, "the icon must be a non-empty SVG under 256 KiB");
const iconSource = readFileSync(icon, "utf8");
assert.match(iconSource, /<svg[^>]*viewBox="/u, "the icon must be an SVG document");
assert.match(iconSource, /<\/svg>\s*$/u, "the icon must be a complete SVG document");
console.log(`bundle manifest ok (patch=${manifest.dsh.bundle.patch}, 2 locales, icon ${iconBytes} B)`);

console.log("\nall checks passed");
