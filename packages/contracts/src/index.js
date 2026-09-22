/**
 * boat's contract extensions over the dsh seams. Types and constants only:
 * the tool and skill metadata boat plugins consume, the `boat/*` events the
 * boat driver dispatches, the log nodes boat plugins append, and the
 * projection keys they publish. Declared here, by declaration merging onto
 * the dsh maps, so that providers and consumers depend on this package and
 * never on each other — the same rule dsh applies to its own seams.
 * @module @boat/contracts
 */
/** `provider` of every assistant message boat writes without a model call (intake replies, imported history). */
export const BOAT_ASSISTANT_PROVIDER = 'boat';
//# sourceMappingURL=index.js.map