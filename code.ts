// Switcheroo — Figma/FigJam/Slides plugin
// Commands:
// 1) "Switch Layers"        — headless. Param: mode = "(default)" | "canvas position" | "layers panel"
// 2) "Switch Properties"    — headless. Param: property = "(All) | Opacity | Variable mode | Blend mode | Corner radius | Fill | Stroke | Effect | Layout grid | Export"
// 3) "Switch…"              — opens UI with checkboxes, live selection-aware

type SwapLayersParam = "(default)" | "canvas position" | "layers panel";
type PropToken =
  | "(All)" | "Opacity" | "Variable mode" | "Blend mode"
  | "Corner radius" | "Fill" | "Stroke" | "Effect" | "Layout grid" | "Export";

const LAYERS_PARAM_SUGGESTIONS: SwapLayersParam[] = ["(default)", "canvas position", "layers panel"];
const PROPS_PARAM_SUGGESTIONS: PropToken[] = ["(All)", "Opacity", "Variable mode", "Blend mode", "Corner radius", "Fill", "Stroke", "Effect", "Layout grid", "Export"];

function notifyExit(msg: string) { figma.notify(msg); figma.closePlugin(); }

// --- Type guards / helpers ----------------------------------------------------

function hasChildren(n: BaseNode | null): n is (BaseNode & ChildrenMixin) {
  return !!n && 'insertChild' in n;
}

function isALContainer(n: BaseNode | null): n is (FrameNode | ComponentNode) {
  if (!n) return false;
  if (n.type === 'FRAME' || n.type === 'COMPONENT') {
    return (n as FrameNode | ComponentNode).layoutMode !== 'NONE';
  }
  return false;
}

function nonALFrame(n: BaseNode | null): n is FrameNode {
  return !!n && n.type === 'FRAME' && (n as FrameNode).layoutMode === 'NONE';
}

function isAncestor(anc: BaseNode, desc: BaseNode): boolean {
  let p = desc.parent;
  while (p) { if (p.id === anc.id) return true; p = p.parent; }
  return false;
}

function canReceive(parent: BaseNode & ChildrenMixin, child: SceneNode): boolean {
  if (parent.type === 'INSTANCE') return false;
  if (parent.type === 'COMPONENT_SET' && child.type !== 'COMPONENT') return false;
  return true;
}

function indexInParent(node: SceneNode): number {
  const p = node.parent as (BaseNode & ChildrenMixin);
  return p.children.indexOf(node);
}

function swapIndicesInSameParent(parent: BaseNode & ChildrenMixin, a: SceneNode, b: SceneNode) {
  const ai = parent.children.indexOf(a);
  const bi = parent.children.indexOf(b);
  if (ai < 0 || bi < 0) return false;
  if (ai < bi) { parent.insertChild(ai, b); parent.insertChild(bi, a); }
  else if (bi < ai) { parent.insertChild(bi, a); parent.insertChild(ai, b); }
  return true;
}

// --- Core swap primitives -----------------------------------------------------

function swapRelativeTransform(a: SceneNode, b: SceneNode) {
  const aRel = (a as any).relativeTransform as Transform;
  const bRel = (b as any).relativeTransform as Transform;
  (a as any).relativeTransform = bRel;
  (b as any).relativeTransform = aRel;
}

function swapParentAndIndex(a: SceneNode, b: SceneNode): boolean {
  const aParent = a.parent; const bParent = b.parent;
  if (!aParent || !bParent) return false;
  if (!hasChildren(aParent) || !hasChildren(bParent)) return false;

  // prevent cycles
  if (isAncestor(a, b) || isAncestor(b, a)) return false;

  // same parent fast path
  if (aParent.id === bParent.id) return swapIndicesInSameParent(aParent, a, b) || false;

  // cross-parent validations
  if (!canReceive(bParent, a) || !canReceive(aParent, b)) return false;

  const ai = indexInParent(a);
  const bi = indexInParent(b);

  bParent.insertChild(bi, a);
  aParent.insertChild(ai, b);
  return true;
}

function swapConstraintsIfApplicable(a: SceneNode, aDestParent: BaseNode | null, b: SceneNode, bDestParent: BaseNode | null): boolean {
  if (!(nonALFrame(aDestParent) && nonALFrame(bDestParent))) return false;
  if (!('constraints' in (a as any)) || !('constraints' in (b as any))) return false;
  const aCons = (a as any).constraints; const bCons = (b as any).constraints;
  (a as any).constraints = bCons; (b as any).constraints = aCons;
  return true;
}

function swapLayoutPositioningIfApplicable(a: SceneNode, b: SceneNode): boolean {
  const aP = a.parent; const bP = b.parent;
  if (!(isALContainer(aP) && isALContainer(bP))) return false;
  if ((a as any).layoutPositioning === undefined || (b as any).layoutPositioning === undefined) return false;
  const t = (a as any).layoutPositioning;
  (a as any).layoutPositioning = (b as any).layoutPositioning;
  (b as any).layoutPositioning = t;
  return true;
}

// --- Property swaps (for "Switch Properties" and UI) --------------------------

function swapOpacity(a: SceneNode, b: SceneNode): boolean {
  if (!('opacity' in (a as any)) || !('opacity' in (b as any))) return false;
  const t = (a as any).opacity; (a as any).opacity = (b as any).opacity; (b as any).opacity = t; return true;
}

function swapBlendMode(a: SceneNode, b: SceneNode): boolean {
  if (!('blendMode' in (a as any)) || !('blendMode' in (b as any))) return false;
  const t = (a as any).blendMode; (a as any).blendMode = (b as any).blendMode; (b as any).blendMode = t; return true;
}

function swapCornerRadius(a: SceneNode, b: SceneNode): boolean {
  let touched = false;
  const keys = ['cornerRadius','cornerSmoothing','topLeftRadius','topRightRadius','bottomRightRadius','bottomLeftRadius'] as const;
  for (const k of keys) {
    if (k in (a as any) && k in (b as any)) { const t = (a as any)[k]; (a as any)[k] = (b as any)[k]; (b as any)[k] = t; touched = true; }
  }
  return touched;
}

function swapFills(a: SceneNode, b: SceneNode): boolean {
  if (!('fills' in (a as any)) || !('fills' in (b as any))) return false;
  const t = (a as any).fills; (a as any).fills = (b as any).fills; (b as any).fills = t; return true;
}

function swapStrokes(a: SceneNode, b: SceneNode): boolean {
  let ok = true;
  const keys = ['strokes','strokeWeight','strokeAlign','strokeCap','strokeJoin','dashPattern'] as const;
  for (const k of keys) {
    if (!((k in (a as any)) && (k in (b as any)))) ok = false;
  }
  if (!ok) return false;
  for (const k of keys) { const t = (a as any)[k]; (a as any)[k] = (b as any)[k]; (b as any)[k] = t; }
  return true;
}

function swapEffects(a: SceneNode, b: SceneNode): boolean {
  if (!('effects' in (a as any)) || !('effects' in (b as any))) return false;
  const t = (a as any).effects; (a as any).effects = (b as any).effects; (b as any).effects = t;
  if ('effectStyleId' in (a as any) && 'effectStyleId' in (b as any)) {
    const s = (a as any).effectStyleId; (a as any).effectStyleId = (b as any).effectStyleId; (b as any).effectStyleId = s;
  }
  return true;
}

function swapLayoutGrids(a: SceneNode, b: SceneNode): boolean {
  if (!('layoutGrids' in (a as any)) || !('layoutGrids' in (b as any))) return false;
  const t = (a as any).layoutGrids; (a as any).layoutGrids = (b as any).layoutGrids; (b as any).layoutGrids = t; return true;
}

function swapExportSettings(a: SceneNode, b: SceneNode): boolean {
  if (!('exportSettings' in (a as any)) || !('exportSettings' in (b as any))) return false;
  const t = (a as any).exportSettings; (a as any).exportSettings = (b as any).exportSettings; (b as any).exportSettings = t; return true;
}

// Best-effort variable mode swap: requires explicit mode APIs on nodes
function swapVariableModes(a: SceneNode, b: SceneNode): boolean {
  const aAny = a as any; const bAny = b as any;
  const hasAPI = typeof aAny.getExplicitVariableModesForCollection === 'function'
              && typeof bAny.getExplicitVariableModesForCollection === 'function'
              && typeof aAny.setExplicitVariableModeForCollection === 'function'
              && typeof bAny.setExplicitVariableModeForCollection === 'function'
              && !!figma.variables;
  if (!hasAPI) return false;

  let touched = false;
  try {
    const collections = figma.variables.getLocalVariableCollections?.() || [];
    for (const col of collections) {
      const aMode = aAny.getExplicitVariableModesForCollection(col.id);
      const bMode = bAny.getExplicitVariableModesForCollection(col.id);
      if (aMode || bMode) {
        aAny.setExplicitVariableModeForCollection(col.id, bMode ?? null);
        bAny.setExplicitVariableModeForCollection(col.id, aMode ?? null);
        touched = true;
      }
    }
  } catch {
    return false;
  }
  return touched;
}

// Utility to run property swaps and build a summary
function runPropertySwaps(a: SceneNode, b: SceneNode, props: Set<PropToken>): { swapped: string[]; unsupported: number } {
  const swapped: string[] = [];
  let unsupported = 0;

  function trySwap(label: PropToken, fn: () => boolean) {
    const ok = fn();
    if (ok) swapped.push(label);
    else unsupported++;
  }

  const want = (label: PropToken) => props.has("(All)" as PropToken) || props.has(label);

  if (want("Opacity"))        trySwap("Opacity",        () => swapOpacity(a,b));
  if (want("Variable mode"))  trySwap("Variable mode",  () => swapVariableModes(a,b));
  if (want("Blend mode"))     trySwap("Blend mode",     () => swapBlendMode(a,b));
  if (want("Corner radius"))  trySwap("Corner radius",  () => swapCornerRadius(a,b));
  if (want("Fill"))           trySwap("Fill",           () => swapFills(a,b));
  if (want("Stroke"))         trySwap("Stroke",         () => swapStrokes(a,b));
  if (want("Effect"))         trySwap("Effect",         () => swapEffects(a,b));
  if (want("Layout grid"))    trySwap("Layout grid",    () => swapLayoutGrids(a,b));
  if (want("Export"))         trySwap("Export",         () => swapExportSettings(a,b));

  return { swapped, unsupported };
}

// --- Quick Actions parameter suggestions -------------------------------------

figma.parameters.on("input", ({ key, query, result }) => {
  if (figma.command === "Switch Layers") {
    if (key === "mode") {
      const q = (query || "").toLowerCase();
      result.setSuggestions(LAYERS_PARAM_SUGGESTIONS.filter(s => s.includes(q)));
    }
  }
  if (figma.command === "Switch Properties") {
    if (key === "property") {
      const q = (query || "").toLowerCase();
      result.setSuggestions(PROPS_PARAM_SUGGESTIONS.filter(s => s.toLowerCase().includes(q)));
    }
  }
});

// --- Command runners ----------------------------------------------------------

function ensureTwoLayers(): [SceneNode, SceneNode] | null {
  const sel = figma.currentPage.selection;
  if (sel.length !== 2) { notifyExit("❌ Select exactly 2 layers."); return null; }
  const a = sel[0] as SceneNode, b = sel[1] as SceneNode;
  if (!a.parent || !b.parent) { notifyExit("❌ Could not resolve parents."); return null; }
  return [a,b];
}

function runSwitchLayers(mode: SwapLayersParam) {
  const pair = ensureTwoLayers(); if (!pair) return;
  const [a,b] = pair;

  // Parent/index
  let didReparent = false;
  if (mode !== "canvas position") {
    const ok = swapParentAndIndex(a,b);
    if (!ok) return notifyExit("❌ Cannot swap parent/index here (invalid target or ancestor/descendant).");
    didReparent = true;
  }

  // Transform (position+rotation)
  let didTransform = false;
  if (mode !== "layers panel") {
    swapRelativeTransform(a,b);
    didTransform = true;
  }

  // Constraints: apply in default & canvas position (not in layers panel)
  let didConstraints = false;
  if (mode === "(default)" || mode === "canvas position") {
    didConstraints = swapConstraintsIfApplicable(a, a.parent, b, b.parent);
  }

  // Absolute Positioning (layoutPositioning) only when BOTH are children of AL parents (default & canvas position)
  let didAbs = false;
  if (mode === "(default)" || mode === "canvas position") {
    didAbs = swapLayoutPositioningIfApplicable(a, b);
  }

  // Toast summary + AL caveat
  const parts: string[] = [];
  if (didReparent) parts.push("parent/index");
  if (didTransform) parts.push("transform");
  if (didConstraints) parts.push("constraints");
  if (didAbs) parts.push("absolute positioning");

  let note = "";
  const aAutoChild = isALContainer(a.parent) && (a as any).layoutPositioning === "AUTO";
  const bAutoChild = isALContainer(b.parent) && (b as any).layoutPositioning === "AUTO";
  if (didTransform && (aAutoChild || bAutoChild)) {
    note = " Note: AUTO-positioned auto-layout children may not visibly move.";
  }

  notifyExit(`✅ Swapped: ${parts.join(", ")}.${note}`);
}

function runSwitchProperties(property: PropToken | undefined) {
  const pair = ensureTwoLayers(); if (!pair) return;
  const [a,b] = pair;

  const wanted = new Set<PropToken>(property ? [property] : ["(All)"]);

  const { swapped, unsupported } = runPropertySwaps(a,b,wanted);
  if (swapped.length === 0) {
    return notifyExit(unsupported > 0 ? `⚠️ No properties swapped. Skipped ${unsupported} unsupported.` : "⚠️ No properties swapped.");
  }
  const summary = `✅ Swapped: ${swapped.join(", ")}.` + (unsupported ? ` Skipped ${unsupported} unsupported.` : "");
  notifyExit(summary);
}

// --- UI helpers --------------------------------------------------------------

function computeSupport(a: SceneNode, b: SceneNode) {
  const aP = a.parent; const bP = b.parent;

  // Position/Rotation via relativeTransform (may not translate in AL/AUTO)
  const positionX = true, positionY = true, rotation = true;

  const constraints = nonALFrame(aP) && nonALFrame(bP) && ('constraints' in (a as any)) && ('constraints' in (b as any));
  const ignoreLayout = isALContainer(aP) && isALContainer(bP) && ((a as any).layoutPositioning !== undefined) && ((b as any).layoutPositioning !== undefined);
  const layoutGrid = ('layoutGrids' in (a as any)) && ('layoutGrids' in (b as any));

  const opacity = ('opacity' in (a as any)) && ('opacity' in (b as any));
  const variableMode = typeof (a as any).getExplicitVariableModesForCollection === 'function'
                    && typeof (b as any).getExplicitVariableModesForCollection === 'function'
                    && typeof (a as any).setExplicitVariableModeForCollection === 'function'
                    && typeof (b as any).setExplicitVariableModeForCollection === 'function'
                    && !!figma.variables;
  const blendMode = ('blendMode' in (a as any)) && ('blendMode' in (b as any));
  const cornerRadius = ['cornerRadius','cornerSmoothing','topLeftRadius','topRightRadius','bottomRightRadius','bottomLeftRadius']
    .some(k => (k in (a as any)) && (k in (b as any)));

  const fill = ('fills' in (a as any)) && ('fills' in (b as any));
  const stroke = ['strokes','strokeWeight','strokeAlign','strokeCap','strokeJoin','dashPattern']
    .every(k => (k in (a as any)) && (k in (b as any)));
  const effect = ('effects' in (a as any)) && ('effects' in (b as any));
  const exportable = ('exportSettings' in (a as any)) && ('exportSettings' in (b as any));

  return {
    positionX, positionY, rotation,
    constraints, ignoreLayout, layoutGrid,
    opacity, variableMode, blendMode, cornerRadius,
    fill, stroke, effect, exportable
  };
}

function runAdvanced(payload: {
  flags: {
    x: boolean; y: boolean; rotation: boolean;
    constraints: boolean; ignoreLayout: boolean; layoutGrid: boolean;
    opacity: boolean; variableMode: boolean; blendMode: boolean; cornerRadius: boolean;
    fill: boolean; stroke: boolean; effect: boolean; exportable: boolean;
  };
  swapInLayers: boolean;
}) {
  const pair = ensureTwoLayers(); if (!pair) return;
  const [a,b] = pair;

  // Optional reparent/index
  let didReparent = false;
  if (payload.swapInLayers) {
    const ok = swapParentAndIndex(a,b);
    if (ok) didReparent = true; else return notifyExit("❌ Cannot swap parent/index here (invalid target or ancestor/descendant).");
  }

  // Position/rotation via relativeTransform
  let didTransform = false;
  if (payload.flags.x || payload.flags.y || payload.flags.rotation) {
    swapRelativeTransform(a,b);
    didTransform = true;
  }

  // Layout-level extras
  let didConstraints = false, didAbs = false;
  if (payload.flags.constraints) {
    didConstraints = swapConstraintsIfApplicable(a, a.parent, b, b.parent);
  }
  if (payload.flags.ignoreLayout) {
    didAbs = swapLayoutPositioningIfApplicable(a,b);
  }

  // Properties
  const propsWanted = new Set<PropToken>();
  if (payload.flags.opacity)        propsWanted.add("Opacity");
  if (payload.flags["variableMode" as keyof typeof payload.flags]) propsWanted.add("Variable mode");
  if (payload.flags.blendMode)      propsWanted.add("Blend mode");
  if (payload.flags.cornerRadius)   propsWanted.add("Corner radius");
  if (payload.flags.fill)           propsWanted.add("Fill");
  if (payload.flags.stroke)         propsWanted.add("Stroke");
  if (payload.flags.effect)         propsWanted.add("Effect");
  if (payload.flags.layoutGrid)     propsWanted.add("Layout grid");
  if (payload.flags.exportable)     propsWanted.add("Export");

  const { swapped, unsupported } = runPropertySwaps(a,b,propsWanted);

  const parts: string[] = [];
  if (didReparent) parts.push("parent/index");
  if (didTransform) parts.push("transform");
  if (didConstraints) parts.push("constraints");
  if (didAbs) parts.push("absolute positioning");
  if (swapped.length) parts.push(...swapped.map(s => s.toLowerCase()));

  let note = "";
  const aAutoChild = isALContainer(a.parent) && (a as any).layoutPositioning === "AUTO";
  const bAutoChild = isALContainer(b.parent) && (b as any).layoutPositioning === "AUTO";
  if (didTransform && (aAutoChild || bAutoChild)) {
    note = " Note: AUTO-positioned auto-layout children may not visibly move.";
  }

  const base = parts.length ? `✅ Swapped: ${parts.join(", ")}.` : "✅ No changes requested.";
  const skip = unsupported ? ` Skipped ${unsupported} unsupported.` : "";
  notifyExit(base + skip + note);
}

// --- Selection change -> UI sync ---------------------------------------------

figma.on("selectionchange", () => {
  if (figma.command === "Switch…") {
    const sel = figma.currentPage.selection;
    if (sel.length === 2) {
      const [a,b] = sel as [SceneNode, SceneNode];
      figma.ui?.postMessage({ type: "SUPPORT_STATE", support: computeSupport(a,b) });
    } else {
      figma.ui?.postMessage({ type: "SUPPORT_STATE", support: null });
    }
  }
});

// --- Entry -------------------------------------------------------------------

figma.on("run", (evt) => {
  const command = figma.command;

  if (command === "Switch Layers") {
    const mode = ((evt as RunEvent).parameters?.["mode"] as SwapLayersParam | undefined) ?? "(default)";
    runSwitchLayers(mode);
    return;
  }

  if (command === "Switch Properties") {
    const prop = (evt as RunEvent).parameters?.["property"] as PropToken | undefined;
    runSwitchProperties(prop);
    return;
  }

  if (command === "Switch…") {
    figma.showUI(__html__, { width: 320, height: 428, themeColors: true });

    // wire UI handlers (no optional chaining on LHS)
    if (figma.ui) {
      figma.ui.onmessage = (msg) => {
        if (msg?.type === "ADVANCED_RUN") runAdvanced(msg.payload);
        if (msg?.type === "REQUEST_SUPPORT") {
          const pair = ensureTwoLayers(); if (!pair) return;
          const [a,b] = pair;
          figma.ui!.postMessage({ type: "SUPPORT_STATE", support: computeSupport(a,b) });
        }
      };

      // send initial support state
      const sel = figma.currentPage.selection;
      const support = sel.length === 2 ? computeSupport(sel[0] as SceneNode, sel[1] as SceneNode) : null;
      figma.ui.postMessage({ type: "SUPPORT_STATE", support });
    }
    return;
  }

  notifyExit("❌ Unknown command.");
});