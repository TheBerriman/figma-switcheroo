// code.ts — Switcheroo (fixed)

// Use Figma's Transform type for matrix ops
type T2 = Transform;

// Helpers
const IDENTITY: T2 = [[1, 0, 0], [0, 1, 0]];

const toKey = (s: string) => s.trim().toLowerCase();

function requireTwo(): [SceneNode, SceneNode] | undefined {
  const sel = figma.currentPage.selection.filter(
    (n): n is SceneNode => (n as any).visible !== undefined
  );
  return sel.length === 2 ? [sel[0], sel[1]] : undefined;
}

function invert(m: T2): T2 {
  const a = m[0][0], b = m[0][1], c = m[0][2];
  const d = m[1][0], e = m[1][1], f = m[1][2];
  const det = a * e - b * d;
  if (det === 0) return IDENTITY;
  const invA = e / det, invB = -b / det, invD = -d / det, invE = a / det;
  const invC = -(invA * c + invB * f), invF = -(invD * c + invE * f);
  return [[invA, invB, invC], [invD, invE, invF]];
}

function mul(A: T2, B: T2): T2 {
  const a = A[0][0] * B[0][0] + A[0][1] * B[1][0];
  const b = A[0][0] * B[0][1] + A[0][1] * B[1][1];
  const c = A[0][0] * B[0][2] + A[0][1] * B[1][2] + A[0][2];
  const d = A[1][0] * B[0][0] + A[1][1] * B[1][0];
  const e = A[1][0] * B[0][1] + A[1][1] * B[1][1];
  const f = A[1][0] * B[0][2] + A[1][1] * B[1][2] + A[1][2];
  return [[a, b, c], [d, e, f]];
}

function parentAbsTransform(parent: BaseNode & ChildrenMixin | null): T2 {
  if (!parent) return IDENTITY;
  // PageNode does NOT have absoluteTransform. Use identity in that case.
  if ((parent as any).type === "PAGE") return IDENTITY;
  // All other parents are SceneNode and have absoluteTransform.
  return (parent as SceneNode).absoluteTransform;
}

function toParentSpace(abs: T2, parent: BaseNode & ChildrenMixin | null): T2 {
  const pAbs = parentAbsTransform(parent);
  return mul(invert(pAbs), abs);
}

function canSetRelativeTransform(n: SceneNode): boolean {
  const parent = n.parent as any;
  if (
    "layoutPositioning" in n &&
    n.layoutPositioning === "AUTO" &&
    parent &&
    "layoutMode" in parent &&
    parent.layoutMode !== "NONE"
  ) {
    return false; // AUTO child in autolayout ignores x/y
  }
  return true;
}

function swapRelativeTransforms(a: SceneNode, b: SceneNode) {
  const absA = a.absoluteTransform;
  const absB = b.absoluteTransform;
  a.relativeTransform = toParentSpace(absB, a.parent as any);
  b.relativeTransform = toParentSpace(absA, b.parent as any);
}

function swapConstraints(a: SceneNode, b: SceneNode) {
  if ("constraints" in a && "constraints" in b) {
    const tmp = a.constraints;
    a.constraints = b.constraints;
    b.constraints = tmp;
  }
}

function swapParentsAndIndex(a: SceneNode, b: SceneNode) {
  const pA = a.parent as (BaseNode & ChildrenMixin) | null;
  const pB = b.parent as (BaseNode & ChildrenMixin) | null;
  if (!pA || !pB) return;

  const iA = pA.children.indexOf(a);
  const iB = pB.children.indexOf(b);

  if (pA === pB) {
    const p = pA;
    if (iA === iB) return;
    if (iA < iB) {
      p.insertChild(iB, a);
      p.insertChild(iA, b);
    } else {
      p.insertChild(iA, b);
      p.insertChild(iB, a);
    }
    return;
  }

  // Different parents
  pA.insertChild(iA, b);
  pB.insertChild(iB, a);
}

// Property swaps
function swapOpacity(a: SceneNode, b: SceneNode) {
  if ("opacity" in a && "opacity" in b) {
    const t = a.opacity; a.opacity = b.opacity; b.opacity = t; return true;
  }
  return false;
}
function swapBlendMode(a: SceneNode, b: SceneNode) {
  if ("blendMode" in a && "blendMode" in b) {
    const t = a.blendMode; a.blendMode = b.blendMode; b.blendMode = t; return true;
  }
  return false;
}
function swapCornerRadius(a: SceneNode, b: SceneNode) {
  if (!("cornerRadius" in a) || !("cornerRadius" in b)) return false;

  const hasIndA = "topLeftRadius" in (a as any);
  const hasIndB = "topLeftRadius" in (b as any);

  if (hasIndA && hasIndB) {
    const ar = {
      tl: (a as any).topLeftRadius, tr: (a as any).topRightRadius,
      bl: (a as any).bottomLeftRadius, br: (a as any).bottomRightRadius
    };
    const br = {
      tl: (b as any).topLeftRadius, tr: (b as any).topRightRadius,
      bl: (b as any).bottomLeftRadius, br: (b as any).bottomRightRadius
    };
    (a as any).topLeftRadius = br.tl; (a as any).topRightRadius = br.tr;
    (a as any).bottomLeftRadius = br.bl; (a as any).bottomRightRadius = br.br;
    (b as any).topLeftRadius = ar.tl; (b as any).topRightRadius = ar.tr;
    (b as any).bottomLeftRadius = ar.bl; (b as any).bottomRightRadius = ar.br;
    return true;
  }

  const t = (a as any).cornerRadius;
  (a as any).cornerRadius = (b as any).cornerRadius;
  (b as any).cornerRadius = t;
  return true;
}
function swapFills(a: SceneNode, b: SceneNode) {
  if ("fills" in a && "fills" in b) {
    const t = a.fills; a.fills = b.fills; b.fills = t;
    if ("fillStyleId" in a && "fillStyleId" in b) {
      const ts = (a as any).fillStyleId; (a as any).fillStyleId = (b as any).fillStyleId; (b as any).fillStyleId = ts;
    }
    return true;
  }
  return false;
}
function swapStrokes(a: SceneNode, b: SceneNode) {
  if ("strokes" in a && "strokes" in b) {
    let t: any;
    t = a.strokes; a.strokes = b.strokes; b.strokes = t;
    if ("strokeStyleId" in a && "strokeStyleId" in b) { t = (a as any).strokeStyleId; (a as any).strokeStyleId = (b as any).strokeStyleId; (b as any).strokeStyleId = t; }
    if ("strokeWeight" in a && "strokeWeight" in b) { t = (a as any).strokeWeight; (a as any).strokeWeight = (b as any).strokeWeight; (b as any).strokeWeight = t; }
    if ("strokeAlign" in a && "strokeAlign" in b) { t = (a as any).strokeAlign; (a as any).strokeAlign = (b as any).strokeAlign; (b as any).strokeAlign = t; }
    if ("dashPattern" in a && "dashPattern" in b) { t = (a as any).dashPattern; (a as any).dashPattern = (b as any).dashPattern; (b as any).dashPattern = t; }
    if ("strokeCap" in a && "strokeCap" in b) { t = (a as any).strokeCap; (a as any).strokeCap = (b as any).strokeCap; (b as any).strokeCap = t; }
    if ("strokeJoin" in a && "strokeJoin" in b) { t = (a as any).strokeJoin; (a as any).strokeJoin = (b as any).strokeJoin; (b as any).strokeJoin = t; }
    if ("strokeMiterLimit" in a && "strokeMiterLimit" in b) { t = (a as any).strokeMiterLimit; (a as any).strokeMiterLimit = (b as any).strokeMiterLimit; (b as any).strokeMiterLimit = t; }
    return true;
  }
  return false;
}
function swapEffects(a: SceneNode, b: SceneNode) {
  if ("effects" in a && "effects" in b) {
    const t = a.effects; a.effects = b.effects; b.effects = t;
    if ("effectStyleId" in a && "effectStyleId" in b) {
      const ts = (a as any).effectStyleId; (a as any).effectStyleId = (b as any).effectStyleId; (b as any).effectStyleId = ts;
    }
    return true;
  }
  return false;
}
function swapLayoutGrids(a: SceneNode, b: SceneNode) {
  if ("layoutGrids" in a && "layoutGrids" in b) {
    const t = a.layoutGrids; a.layoutGrids = b.layoutGrids; b.layoutGrids = t;
    if ("gridStyleId" in a && "gridStyleId" in b) {
      const ts = (a as any).gridStyleId; (a as any).gridStyleId = (b as any).gridStyleId; (b as any).gridStyleId = ts;
    }
    return true;
  }
  return false;
}
function swapExport(a: SceneNode, b: SceneNode) {
  if ("exportSettings" in a && "exportSettings" in b) {
    const t = a.exportSettings; a.exportSettings = b.exportSettings; b.exportSettings = t; return true;
  }
  return false;
}

// Orchestrators
function doSwitchLayers(scope: "default" | "canvas" | "panel"): number | "invalid" {
  const pair = requireTwo();
  if (!pair) return "invalid";
  const [a, b] = pair;

  let issues = 0;
  const absA = a.absoluteTransform;
  const absB = b.absoluteTransform;
  const doPanel = (scope === "default" || scope === "panel");
  const doCanvas = (scope === "default" || scope === "canvas");

  try {
    if (doPanel) swapParentsAndIndex(a, b);

    // swap LP here once (optional: see note 3)
    if (doCanvas && "layoutPositioning" in a && "layoutPositioning" in b) {
      const t = a.layoutPositioning; a.layoutPositioning = b.layoutPositioning; b.layoutPositioning = t;
    }

    if (doCanvas) { try { swapConstraints(a, b); } catch {} }

    if (doCanvas) {
      if (canSetRelativeTransform(a)) a.relativeTransform = toParentSpace(absB, a.parent as any);
      if (canSetRelativeTransform(b)) b.relativeTransform = toParentSpace(absA, b.parent as any);
    } else if (doPanel) {
      if (canSetRelativeTransform(a)) a.relativeTransform = toParentSpace(absA, a.parent as any);
      if (canSetRelativeTransform(b)) b.relativeTransform = toParentSpace(absB, b.parent as any);
    }
  } catch { issues++; }

  return issues; // <-- important
}

type PropKey = "opacity" | "blend mode" | "corner radius" | "fill" | "stroke" | "effect" | "layout grid" | "export";

function doSwitchProperties(prop: PropKey | "all"): { tried: number; ok: number; fail: number } | "invalid" {
  const pair = requireTwo();
  if (!pair) return "invalid";
  const [a, b] = pair;

  const run = (k: PropKey) => {
    switch (k) {
      case "opacity": return swapOpacity(a, b);
      case "blend mode": return swapBlendMode(a, b);
      case "corner radius": return swapCornerRadius(a, b);
      case "fill": return swapFills(a, b);
      case "stroke": return swapStrokes(a, b);
      case "effect": return swapEffects(a, b);
      case "layout grid": return swapLayoutGrids(a, b);
      case "export": return swapExport(a, b);
    }
  };

  const keys: PropKey[] = ["opacity","blend mode","corner radius","fill","stroke","effect","layout grid","export"];
  let tried = 0, ok = 0;
  if (prop === "all") for (const k of keys) { tried++; if (run(k)) ok++; }
  else { tried = 1; if (run(prop)) ok = 1; }
  const fail = tried - ok;

  return { tried, ok, fail }; // <-- important
}

// Run + parameter suggestions
figma.on("run", ({ command, parameters }) => {
  if (command === "switch-layers") {
    const scopeRaw = (parameters?.scope ?? "(default)").toString().toLowerCase();
    const scope = scopeRaw.includes("canvas") ? "canvas"
            : (scopeRaw.includes("layers") || scopeRaw.includes("panel")) ? "panel"
            : "default";

    let msg = "Switched layers.";
    try {
      const res = doSwitchLayers(scope as any);
      if (res === "invalid") msg = "Select exactly two layers.";
      else if (typeof res === "number" && res > 0) msg = `Switched layers with ${res} issue(s).`;
    } catch {
      msg = "Switched layers with issues.";
    } finally {
      // Force Quick Actions to close after mutations settle
      setTimeout(() => figma.closePlugin(msg), 0);
    }
    return;
  }

  if (command === "switch-properties") {
    const p = (parameters?.property ?? "(all)").toString().toLowerCase();
    const map: Record<string, PropKey | "all"> = {
      "(all)":"all","all":"all","opacity":"opacity","blend":"blend mode","blend mode":"blend mode",
      "corner radius":"corner radius","radius":"corner radius","fill":"fill","stroke":"stroke",
      "effect":"effect","effects":"effect","layout grid":"layout grid","grid":"layout grid","export":"export"
    };

    let msg = "Switched properties.";
    try {
      const res = doSwitchProperties(map[p] ?? "all");
      if (res === "invalid") msg = "Select exactly two layers.";
      else if (res) {
        if (res.ok === 0) msg = "No eligible properties to switch.";
        else if (res.fail > 0) msg = `Switched ${res.ok} propert${res.ok === 1 ? "y" : "ies"}. ${res.fail} skipped.`;
      }
    } catch {
      msg = "Switched properties with issues.";
    } finally {
      // Force Quick Actions to close after mutations settle
      setTimeout(() => figma.closePlugin(msg), 0);
    }
    return;
  }


  if (command === "switch-ui") {
    figma.showUI(__html__, { width: 320, height: 428, themeColors: true });
    postSelectionState();
    bindUiHandlers();
  }
});

figma.parameters.on("input", ({ query, key, result }) => {
  if (key === "scope") {
    const choices = ["(default)", "canvas position", "layers panel"];
    result.setSuggestions(choices.filter(c => c.toLowerCase().includes(query.toLowerCase())));
  }
  if (key === "property") {
    const choices = ["(all)", "opacity", "blend mode", "corner radius", "fill", "stroke", "effect", "layout grid", "export"];
    result.setSuggestions(choices.filter(c => c.toLowerCase().includes(query.toLowerCase())));
  }
});

// UI messaging
type UiOptions = {
  swapInLayers: boolean;
  position: { x: boolean; y: boolean; rotation: boolean; constraints: boolean; ignoreLayout: boolean };
  appearance: { opacity: boolean; blendMode: boolean; cornerRadius: boolean };
  props: { fill: boolean; stroke: boolean; effect: boolean; layoutGrid: boolean; export: boolean };
};
type UiMessage =
  | { type: "RUN_SWAP"; payload: { options: UiOptions | null } }
  | { type: "SELECTION_STATE"; payload?: any } // sent to UI
  | { type: "DONE"; payload?: any }            // sent to UI
  | { type: "REQUEST_SELECTION_STATE" }
  | { type: "CLOSE" };

function postSelectionState() {
  if (!figma.ui) return; // prevent error if no UI open
  const pair = figma.currentPage.selection.filter((n): n is SceneNode => true).slice(0, 2);
  const has = (checker: (n: SceneNode) => boolean) => pair.some(checker);
  const state = {
    hasPosition: pair.length === 2,
    canConstraints: has((n) => "constraints" in n),
    canCorner: has((n) => "cornerRadius" in n),
    canFill: has((n) => "fills" in n),
    canStroke: has((n) => "strokes" in n),
    canEffect: has((n) => "effects" in n),
    canGrid: has((n) => "layoutGrids" in n),
    canExport: has((n) => "exportSettings" in n),
    twoSelected: pair.length === 2
  };
  figma.ui.postMessage({ type: "SELECTION_STATE", payload: state });
}

function bindUiHandlers() {
  figma.on("selectionchange", postSelectionState);

  figma.ui.onmessage = (msg: UiMessage) => {
    if (msg.type === "REQUEST_SELECTION_STATE") {
      postSelectionState();
      return;
    }
    if (msg.type === "RUN_SWAP") {
      const opts = msg.payload.options;
      if (!opts) { figma.closePlugin(); return; }

      const pair = requireTwo();
      if (!pair) {
        if (figma.ui) figma.ui.postMessage({ type: "DONE", payload: { ok: false } });
        return;
      }
      const [a, b] = pair;

      let issues = 0;
      // ... your swap logic stays exactly as it is ...
      if (figma.ui) figma.ui.postMessage({ type: "DONE", payload: { ok: issues === 0, issues } });
      if (issues === 0) figma.notify("Swap complete.");
      else figma.notify(`Swap finished with ${issues} issue(s).`, { error: true });
      return;
    }
    if (msg.type === "CLOSE") {
      figma.closePlugin();
    }
  };
}
