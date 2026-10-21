/**
 * Context compaction on right-click — Host half.
 *
 * All of this feature's work happens in the browser half: it listens for a
 * right-click on the composer's context meter and calls the Host's already
 * existing `/compact` Remote. The Host needs one thing from this package and
 * nothing else — a Loader row whose `dsh.client` declaration pulls the browser
 * half into the Web boot graph. So this half is deliberately empty.
 *
 * It imports NOTHING, and that is a hard constraint. Node resolves an import
 * from the importing file's own directory, and this package lives outside the
 * dsh installation, so no `@deepseek-ai/*` or bare npm specifier is reachable
 * from here: one import fails the entire plugin at load — Host half and browser
 * half together.
 *
 * @module dsh-plugin-context-compact
 */

/** Cordis plugin name; the Loader row id in the profile patch is `context-compact`. */
const name = "context-compact";

/** No service is required: the row exists only to carry the client declaration. */
const inject = [];

/** Mount the placeholder row. */
function apply() {}

export { apply, inject, name };
