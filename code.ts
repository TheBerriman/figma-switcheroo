// Switcheroo — stable core

type T2 = Transform;
const IDENTITY: T2 = [[1,0,0],[0,1,0]];
const toKey = (s: string) => s.trim().toLowerCase();

function requireTwo(): [SceneNode, SceneNode] | undefined {
  const sel = figma.currentPage.selection.filter((n): n is SceneNode => (n as any).visible !== undefined);
  return sel.length === 2 ? [sel[0], sel[1]] : undefined;
}

// 2x3 matrix helpers
function invert(m: T2): T2 {
  const a=m[0][0], b=m[0][1], c=m[0][2], d=m[1][0], e=m[1][1], f=m[1][2];
  const det = a*e - b*d; if (!det) return IDENTITY;
  const A=e/det, B=-b/det, D=-d/det, E=a/det, C=-(A*c + B*f), F=-(D*c + E*f);
  return [[A,B,C],[D,E,F]];
}
const mul = (A:T2,B:T2):T2 => [
  [A[0][0]*B[0][0]+A[0][1]*B[1][0], A[0][0]*B[0][1]+A[0][1]*B[1][1], A[0][0]*B[0][2]+A[0][1]*B[1][2]+A[0][2]],
  [A[1][0]*B[0][0]+A[1][1]*B[1][0], A[1][0]*B[0][1]+A[1][1]*B[1][1], A[1][0]*B[0][2]+A[1][1]*B[1][2]+A[1][2]],
];

function parentAbsTransform(p: BaseNode & ChildrenMixin | null): T2 {
  if (!p) return IDENTITY;
  if ((p as any).type === "PAGE") return IDENTITY; // PageNode has no absoluteTransform
  return (p as SceneNode).absoluteTransform;
}
const toParentSpace = (abs:T2, p: BaseNode & ChildrenMixin | null) => mul(invert(parentAbsTransform(p)), abs);

function canSetRelativeTransform(n: SceneNode): boolean {
  const parent = n.parent as any;
  if ("layoutPositioning" in n && n.layoutPositioning === "AUTO" && parent && "layoutMode" in parent && parent.layoutMode !== "NONE") {
    return false; // Auto Layout child ignores x/y; set by parent
  }
  return true;
}

// ---- swaps
function swapParentsAndIndex(a: SceneNode, b: SceneNode) {
  const pA = a.parent as (BaseNode & ChildrenMixin) | null;
  const pB = b.parent as (BaseNode & ChildrenMixin) | null;
  if (!pA || !pB) return;

  const iA = pA.children.indexOf(a);
  const iB = pB.children.indexOf(b);

  if (pA === pB) {
    const p = pA;
    if (iA === iB) return;
    if (iA < iB) { p.insertChild(iB, a); p.insertChild(iA, b); }
    else { p.insertChild(iA, b); p.insertChild(iB, a); }
    return;
  }
  // cross-parent
  pA.insertChild(iA, b);
  pB.insertChild(iB, a);
}
function swapConstraints(a: SceneNode, b: SceneNode) {
  if ("constraints" in a && "constraints" in b) { const t=a.constraints; a.constraints=b.constraints; b.constraints=t; }
}

function inComponentOrInstance(n: SceneNode): boolean {
  for (let p = n.parent; p; p = (p as any).parent) {
    if (!("type" in p)) break;
    if (p.type === "INSTANCE" || p.type === "COMPONENT" || p.type === "COMPONENT_SET") return true;
  }
  return false;
}

function doSwitchLayers(scope: "default"|"canvas"|"panel"): number | "invalid" | "blocked" {
  const pair = requireTwo(); if (!pair) return "invalid";
  const [a,b] = pair;

  if (inComponentOrInstance(a) || inComponentOrInstance(b)) return "blocked";

  let issues = 0;

  const absA = a.absoluteTransform, absB = b.absoluteTransform;
  const doPanel = scope === "default" || scope === "panel";
  const doCanvas = scope === "default" || scope === "canvas";

  try {
    if (doPanel) swapParentsAndIndex(a,b);

    if (doCanvas && "layoutPositioning" in a && "layoutPositioning" in b) {
      const t = a.layoutPositioning; a.layoutPositioning = b.layoutPositioning; b.layoutPositioning = t;
    }

    if (doCanvas) { try { swapConstraints(a,b); } catch {} }

    if (doCanvas) {
      if (canSetRelativeTransform(a)) a.relativeTransform = toParentSpace(absB, a.parent as any);
      if (canSetRelativeTransform(b)) b.relativeTransform = toParentSpace(absA, b.parent as any);
    } else if (doPanel) {
      if (canSetRelativeTransform(a)) a.relativeTransform = toParentSpace(absA, a.parent as any);
      if (canSetRelativeTransform(b)) b.relativeTransform = toParentSpace(absB, b.parent as any);
    }
  } catch { issues++; }
  return issues;
}

// ---- properties
type PropKey = "opacity"|"blend mode"|"corner radius"|"fill"|"stroke"|"effect"|"layout grid"|"export"|"variable mode";

type Swapper = (a: SceneNode, b: SceneNode) => 1 | undefined | Promise<1 | undefined>;
const cloneObjs = <T extends object>(arr: ReadonlyArray<T>): T[] => arr.map(o => ({ ...o }));

const swap: Record<PropKey, Swapper> = {
  opacity: (a: SceneNode, b: SceneNode) =>
    ("opacity" in a && "opacity" in b && ([a.opacity, b.opacity] = [b.opacity, a.opacity], 1)) || undefined,

  "blend mode": (a: SceneNode, b: SceneNode) =>
    ("blendMode" in a && "blendMode" in b &&
      ([(a as any).blendMode, (b as any).blendMode] = [(b as any).blendMode, (a as any).blendMode], 1)) || undefined,

  "corner radius": (a: SceneNode, b: SceneNode) =>
    ("cornerRadius" in a && "cornerRadius" in b &&
      (() => {
        const A = a as any, B = b as any;
        if ("topLeftRadius" in A && "topLeftRadius" in B) {
          [A.topLeftRadius, B.topLeftRadius] = [B.topLeftRadius, A.topLeftRadius];
          [A.topRightRadius, B.topRightRadius] = [B.topRightRadius, A.topRightRadius];
          [A.bottomLeftRadius, B.bottomLeftRadius] = [B.bottomLeftRadius, A.bottomLeftRadius];
          [A.bottomRightRadius, B.bottomRightRadius] = [B.bottomRightRadius, A.bottomRightRadius];
          return 1 as const;
        }
        [A.cornerRadius, B.cornerRadius] = [B.cornerRadius, A.cornerRadius];
        return 1 as const;
      })()) || undefined,

  fill: (a, b) =>
  ("fills" in a && "fills" in b && (() => {
    const A = a as any, B = b as any; const af = A.fills, bf = B.fills;
    A.fills = cloneObjs(bf); B.fills = cloneObjs(af);
    if ("fillStyleId" in A && "fillStyleId" in B) [A.fillStyleId, B.fillStyleId] = [B.fillStyleId, A.fillStyleId];
    return 1 as const;
  })()) || undefined,

stroke: (a, b) =>
  ("strokes" in a && "strokes" in b && (() => {
    const A = a as any, B = b as any; const as = A.strokes, bs = B.strokes;
    A.strokes = cloneObjs(bs); B.strokes = cloneObjs(as);
    if ("strokeStyleId" in A && "strokeStyleId" in B) [A.strokeStyleId, B.strokeStyleId] = [B.strokeStyleId, A.strokeStyleId];
    if ("strokeWeight" in A && "strokeWeight" in B) [A.strokeWeight, B.strokeWeight] = [B.strokeWeight, A.strokeWeight];
    if ("strokeAlign" in A && "strokeAlign" in B) [A.strokeAlign, B.strokeAlign] = [B.strokeAlign, A.strokeAlign];
    if ("dashPattern" in A && "dashPattern" in B) [A.dashPattern, B.dashPattern] = [B.dashPattern, A.dashPattern];
    if ("strokeCap" in A && "strokeCap" in B) [A.strokeCap, B.strokeCap] = [B.strokeCap, A.strokeCap];
    if ("strokeJoin" in A && "strokeJoin" in B) [A.strokeJoin, B.strokeJoin] = [B.strokeJoin, A.strokeJoin];
    if ("strokeMiterLimit" in A && "strokeMiterLimit" in B) [A.strokeMiterLimit, B.strokeMiterLimit] = [B.strokeMiterLimit, A.strokeMiterLimit];
    return 1 as const;
  })()) || undefined,

effect: (a, b) =>
  ("effects" in a && "effects" in b && (() => {
    const A = a as any, B = b as any; const ae = A.effects, be = B.effects;
    A.effects = cloneObjs(be); B.effects = cloneObjs(ae);
    if ("effectStyleId" in A && "effectStyleId" in B) [A.effectStyleId, B.effectStyleId] = [B.effectStyleId, A.effectStyleId];
    return 1 as const;
  })()) || undefined,

"layout grid": (a, b) =>
  ("layoutGrids" in a && "layoutGrids" in b && (() => {
    const A = a as any, B = b as any; const ag = A.layoutGrids, bg = B.layoutGrids;
    A.layoutGrids = cloneObjs(bg); B.layoutGrids = cloneObjs(ag);
    if ("gridStyleId" in A && "gridStyleId" in B) [A.gridStyleId, B.gridStyleId] = [B.gridStyleId, A.gridStyleId];
    return 1 as const;
  })()) || undefined,

export: (a, b) =>
  ("exportSettings" in a && "exportSettings" in b && (() => {
    const A = a as any, B = b as any; const ae = A.exportSettings, be = B.exportSettings;
    A.exportSettings = cloneObjs(be); B.exportSettings = cloneObjs(ae);
    return 1 as const;
  })()) || undefined,

"variable mode": async (a, b) => {
  const modesA = (a as any).resolvedVariableModes as Record<string,string>|undefined;
  const modesB = (b as any).resolvedVariableModes as Record<string,string>|undefined;
  if (!modesA && !modesB) return undefined;
  const ids = new Set([...(Object.keys(modesA||{})), ...(Object.keys(modesB||{}))]);
  for (const colId of ids) {
    const coll = await figma.variables.getVariableCollectionByIdAsync(colId);
    if (!coll) continue;
    const modeA = modesA?.[colId];
    const modeB = modesB?.[colId];
    if (modeB) (a as any).setExplicitVariableModeForCollection(coll, modeB);
    else (a as any).clearExplicitVariableModeForCollection(coll);
    if (modeA) (b as any).setExplicitVariableModeForCollection(coll, modeA);
    else (b as any).clearExplicitVariableModeForCollection(coll);
  }
  return 1 as const;
},
};

function supports(k: PropKey, n: SceneNode): boolean {
  switch (k) {
    case "opacity": return "opacity" in n;
    case "blend mode": return "blendMode" in n;
    case "corner radius": return "cornerRadius" in n || "topLeftRadius" in (n as any);
    case "fill": return "fills" in n;
    case "stroke": return "strokes" in n;
    case "effect": return "effects" in n;
    case "layout grid": return "layoutGrids" in n;
    case "export": return "exportSettings" in n;
    case "variable mode": return "setExplicitVariableModeForCollection" in (n as any);
  }
}

async function doSwitchProperties(prop: PropKey | "all") {
  const pair = requireTwo(); if (!pair) return "invalid" as const;
  const [a,b] = pair;
  const keys: PropKey[] = ["opacity","blend mode","corner radius","fill","stroke","effect","layout grid","export","variable mode"];
  const todo = (prop === "all" ? keys : [prop]).filter(k => supports(k,a) && supports(k,b));

  let ok=0, fail=0; const skipped = (prop === "all" ? keys.length : 1) - todo.length;
  for (const k of todo) {
    try {
      const r = await (swap[k] as any)(a,b);
      if (r) ok++; else fail++;
    } catch { fail++; }
  }
  return { ok, fail, skipped };
}

// ---- run + parameters
figma.parameters.on("input", ({ query, key, result }) => {
  const q = (query ?? "").toLowerCase();
  if (key === "scope") {
    const choices = ["(default)","canvas position","layers panel"];
    result.setSuggestions(choices.filter(s => s.toLowerCase().includes(q)));
  } else if (key === "property") {
    const choices = ["(all)","opacity","blend mode","corner radius","fill","stroke","effect","layout grid","export","variable mode"];
    result.setSuggestions(choices.filter(s => s.toLowerCase().includes(q)));
  } else {
    result.setSuggestions([]);
  }
});

figma.on("run", async ({ command, parameters }) => {
  if (command === "switch-layers") {
    const scopeRaw = toKey(String(parameters?.scope ?? "(default)"));
    const scope: "default"|"canvas"|"panel" =
      scopeRaw.includes("canvas") ? "canvas" :
      (scopeRaw.includes("layers") || scopeRaw.includes("panel")) ? "panel" : "default";

    let msg = "Switched layers.";
    try {
      const res = doSwitchLayers(scope);
      if (res === "invalid") msg = "Select exactly two layers.";
      else if (res === "blocked") msg = "Not supported on components or instances.";
      else if (typeof res === "number" && res > 0) msg = `Switched layers with ${res} issue(s).`;
    } catch { msg = "Switched layers with issues."; }
    setTimeout(() => figma.closePlugin(msg), 0);
    return;
  }

  if (command === "switch-properties") {
    const p = toKey(String(parameters?.property ?? "(all)"));
    const map: Record<string, PropKey | "all"> = {
      "(all)":"all","all":"all","opacity":"opacity","blend":"blend mode","blend mode":"blend mode",
      "corner radius":"corner radius","radius":"corner radius","fill":"fill","stroke":"stroke",
      "effect":"effect","effects":"effect","layout grid":"layout grid","grid":"layout grid","export":"export","variable mode":"variable mode"
    };

    let msg = "Switched properties.";
    try {
      const res = await doSwitchProperties(map[p] ?? "all");
      if (res === "invalid") msg = "Select exactly two layers.";
      else if (res.ok === 0 && res.fail === 0) msg = "No eligible properties to switch.";
      else if (res.fail === 0) msg = `Switched ${res.ok}. ${res.skipped} ineligible.`;
      else msg = `Switched ${res.ok}. ${res.fail} failed. ${res.skipped} ineligible.`;
    } catch { msg = "Switched properties with issues."; }
    setTimeout(() => figma.closePlugin(msg), 0);
    return;
  }

  async function loadUiOptions(): Promise<UiOptions | null> {
    try { return await figma.clientStorage.getAsync("switcheroo.ui.options"); } catch { return null; }
  }
  async function saveUiOptions(opts: UiOptions) {
    try { await figma.clientStorage.setAsync("switcheroo.ui.options", opts); } catch {}
  }


  if (command === "switch-ui") {
    figma.showUI(__html__, { width: 320, height: 428, themeColors: true });
    postSelectionState();
    bindUiHandlers();
    (async () => {
      const saved = await loadUiOptions();
      figma.ui.postMessage({ type:"LOAD_OPTIONS", payload: saved });
    })();
  }
});

// ---- UI bridge
type UiOptions = {
  swapInLayers: boolean;
  position: { x:boolean; y:boolean; rotation:boolean; constraints:boolean; ignoreLayout:boolean };
  appearance: { opacity:boolean; blendMode:boolean; cornerRadius:boolean };
  props: { fill:boolean; stroke:boolean; effect:boolean; layoutGrid:boolean; export:boolean };
};
type UiMessage =
  | { type: "RUN_SWAP"; payload: { options: UiOptions|null } }
  | { type: "SELECTION_STATE"; payload?: any }
  | { type: "DONE"; payload?: any }
  | { type: "REQUEST_SELECTION_STATE" }
  | { type: "CLOSE" };

function postSelectionState() {
  if (!figma.ui) return;
  const pair = figma.currentPage.selection.filter((n): n is SceneNode => true).slice(0,2);
  const has = (f:(n:SceneNode)=>boolean)=>pair.some(f);
  const state = {
    twoSelected: pair.length === 2,
    hasPosition: pair.length === 2,
    canConstraints: has(n=>"constraints" in n),
    canCorner: has(n=>"cornerRadius" in n),
    canFill: has(n=>"fills" in n),
    canStroke: has(n=>"strokes" in n),
    canEffect: has(n=>"effects" in n),
    canGrid: has(n=>"layoutGrids" in n),
    canExport: has(n=>"exportSettings" in n),
  };
  figma.ui.postMessage({ type:"SELECTION_STATE", payload: state });
}

function bindUiHandlers() {
  figma.on("selectionchange", postSelectionState);
  figma.ui.onmessage = async (msg: UiMessage) => {
  if (msg.type === "REQUEST_SELECTION_STATE") { postSelectionState(); return; }

  if (msg.type === "RUN_SWAP") {
    const opts = msg.payload.options;
    if (!opts) { figma.closePlugin(); return; }

    await saveUiOptions(opts);

    if (opts.swapInLayers) doSwitchLayers("panel");

    if (opts.position.x || opts.position.y || opts.position.rotation || opts.position.constraints) {
      doSwitchLayers("canvas");
    }

    const props: PropKey[] = [];
    if (opts.appearance.opacity) props.push("opacity");
    if (opts.appearance.blendMode) props.push("blend mode");
    if (opts.appearance.cornerRadius) props.push("corner radius");
    if (opts.props.fill) props.push("fill");
    if (opts.props.stroke) props.push("stroke");
    if (opts.props.effect) props.push("effect");
    if (opts.props.layoutGrid) props.push("layout grid");
    if (opts.props.export) props.push("export");

    for (const p of props) await doSwitchProperties(p);

    figma.ui.postMessage({ type:"DONE", payload:{ ok:true }});
    figma.notify("Swap complete.");
    return;
  }

  if (msg.type === "CLOSE") figma.closePlugin();
};
}
