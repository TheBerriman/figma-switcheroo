// Switcheroo — stable core

type T2 = Transform;
const IDENTITY: T2 = [[1,0,0],[0,1,0]];
const toKey = (s: string) => s.trim().toLowerCase();

function requireTwo(): [SceneNode, SceneNode] | "none" | "one" | "toomany" {
  const sel = figma.currentPage.selection.filter((n): n is SceneNode => (n as any).visible !== undefined);
  if (sel.length === 0) return "none";
  if (sel.length === 1) return "one"; 
  if (sel.length > 2) return "toomany";
  return [sel[0], sel[1]];
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
  if ("constraints" in a && "constraints" in b) { 
    const t = a.constraints; 
    a.constraints = b.constraints; 
    b.constraints = t; 
  }
}

function inInstanceChain(n: SceneNode): boolean {
  for (let p = n.parent; p; p = (p as any).parent) {
    if (!("type" in p)) break;
    if (p.type === "INSTANCE") return true;
  }
  return false;
}

function doSwitchLayers(
  scope: "default"|"canvas"|"panel",
  pos?: { x?: boolean; y?: boolean; rotation?: boolean; constraints?: boolean }
): number | "blocked" {
  const pair = requireTwo(); 
  if (typeof pair === "string") {
    throw new Error("Invalid selection"); // This will be caught by caller
  }
  const [a,b] = pair;

  if (inInstanceChain(a) || inInstanceChain(b)) return "blocked";

  let issues = 0;

  const absA = a.absoluteTransform, absB = b.absoluteTransform;
  const doPanel = scope === "default" || scope === "panel";
  const doCanvas = scope === "default" || scope === "canvas";

  try {
    // Panel index/parent swap
    if (doPanel) swapParentsAndIndex(a, b);

    if (doCanvas) {
      // Old behavior if no granular options provided
      if (!pos) {
        if ("layoutPositioning" in a && "layoutPositioning" in b) {
          const t = a.layoutPositioning;
          a.layoutPositioning = b.layoutPositioning;
          b.layoutPositioning = t;
        }
        
        try { 
          swapConstraints(a, b); 
        } catch (e) {
          issues++;
        }
        
        if (canSetRelativeTransform(a)) {
          try {
            a.relativeTransform = toParentSpace(absB, a.parent as any);
          } catch (e) {
            issues++;
          }
        }
        
        if (canSetRelativeTransform(b)) {
          try {
            b.relativeTransform = toParentSpace(absA, b.parent as any);
          } catch (e) {
            issues++;
          }
        }
      } else {
        // Constraints
        if (pos.constraints) { 
          try { 
            swapConstraints(a, b); 
          } catch (e) {
            issues++;
          }
        }

        // Unified transform application to avoid rotation being overwritten by x/y
        const wantsRot = !!pos.rotation;
        const wantsX = !!pos.x;
        const wantsY = !!pos.y;

        if (wantsRot || wantsX || wantsY) {
          // Clone current absolute transforms
          const newAbsA: [[number,number,number],[number,number,number]] =
            [[absA[0][0], absA[0][1], absA[0][2]], [absA[1][0], absA[1][1], absA[1][2]]];
          const newAbsB: [[number,number,number],[number,number,number]] =
            [[absB[0][0], absB[0][1], absB[0][2]], [absB[1][0], absB[1][1], absB[1][2]]];

          // If rotating, swap the 2x2 orientation blocks
          if (wantsRot) {
            newAbsA[0][0] = absB[0][0]; newAbsA[0][1] = absB[0][1];
            newAbsA[1][0] = absB[1][0]; newAbsA[1][1] = absB[1][1];

            newAbsB[0][0] = absA[0][0]; newAbsB[0][1] = absA[0][1];
            newAbsB[1][0] = absA[1][0]; newAbsB[1][1] = absA[1][1];
          }

          // If swapping positions, swap the translation components
          if (wantsX) { const t = newAbsA[0][2]; newAbsA[0][2] = newAbsB[0][2]; newAbsB[0][2] = t; }
          if (wantsY) { const t = newAbsA[1][2]; newAbsA[1][2] = newAbsB[1][2]; newAbsB[1][2] = t; }

          try {
            if (canSetRelativeTransform(a)) (a as any).relativeTransform = toParentSpace(newAbsA, a.parent as any);
            if (canSetRelativeTransform(b)) (b as any).relativeTransform = toParentSpace(newAbsB, b.parent as any);
          } catch (e) { 
            issues++; 
          }
        }
      }
    } else if (doPanel) {
      // Only panel swap: reapply original transforms
      if (canSetRelativeTransform(a)) {
        try {
          a.relativeTransform = toParentSpace(absA, a.parent as any);
        } catch (e) {
          issues++;
        }
      }
      if (canSetRelativeTransform(b)) {
        try {
          b.relativeTransform = toParentSpace(absB, b.parent as any);
        } catch (e) {
          issues++;
        }
      }
    }
  } catch (e) { 
    issues++; 
  }

  return issues;
}

// ---- properties
type PropKey = "opacity"|"blend mode"|"corner radius"|"fill"|"stroke"|"effect"|"layout grid"|"export"|"variable mode";

type Swapper = (a: SceneNode, b: SceneNode) => 1 | undefined | Promise<1 | undefined>;

const cloneObjs = <T extends object>(arr: ReadonlyArray<T>): T[] =>
  arr.map(o => ({ ...o }));

const deepEqual = (a: any, b: any): boolean => {
  if (a === b) return true;
  if (!a || !b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  if (typeof a === "object" && typeof b === "object") {
    const ak = Object.keys(a), bk = Object.keys(b);
    if (ak.length !== bk.length) return false;
    for (const k of ak) if (!deepEqual(a[k], (b as any)[k])) return false;
    return true;
  }
  return false;
};

async function setStyleIdAsync(node: SceneNode, kind: 'fill'|'effect'|'grid', id?: string) {
  const n = node as any;
  try {
    if (kind === 'fill'   && 'setFillStyleIdAsync'   in n) return await n.setFillStyleIdAsync(id ?? '');
    if (kind === 'effect' && 'setEffectStyleIdAsync' in n) return await n.setEffectStyleIdAsync(id ?? '');
    if (kind === 'grid'   && 'setGridStyleIdAsync'   in n) return await n.setGridStyleIdAsync(id ?? '');
  } catch (e) {
    throw new Error(`[setStyleIdAsync:${kind}] ${(e as Error).message}`);
  }
}

const swap: Record<PropKey, Swapper> = {
  opacity: (a: SceneNode, b: SceneNode) =>
    ("opacity" in a && "opacity" in b &&
      (a.opacity === b.opacity
        ? undefined
        : ([a.opacity, b.opacity] = [b.opacity, a.opacity], 1))) || undefined,

  "blend mode": (a: SceneNode, b: SceneNode) =>
    ("blendMode" in a && "blendMode" in b && (() => {
      const A = a as any, B = b as any;
      if (A.blendMode === B.blendMode) return undefined;
      [A.blendMode, B.blendMode] = [B.blendMode, A.blendMode];
      return 1 as const;
    })()) || undefined,

  "corner radius": (a: SceneNode, b: SceneNode) => (
    ("cornerRadius" in a && "cornerRadius" in b) || ("topLeftRadius" in (a as any) && "topLeftRadius" in (b as any))
  ) && (() => {
    const A = a as any, B = b as any;

    // equality check across both modes
    const sameUnified = ("cornerRadius" in A && "cornerRadius" in B) && A.cornerRadius === B.cornerRadius;
    const samePerCorner =
      ("topLeftRadius" in A && "topLeftRadius" in B) &&
      A.topLeftRadius === B.topLeftRadius &&
      A.topRightRadius === B.topRightRadius &&
      A.bottomLeftRadius === B.bottomLeftRadius &&
      A.bottomRightRadius === B.bottomRightRadius;
    const sameSmoothing = (!("cornerSmoothing" in A) && !("cornerSmoothing" in B)) ||
                          (("cornerSmoothing" in A && "cornerSmoothing" in B) && A.cornerSmoothing === B.cornerSmoothing);

    if ((sameUnified || samePerCorner) && sameSmoothing) return undefined;

    // perform swap preserving whichever mode each node currently uses
    if ("topLeftRadius" in A && "topLeftRadius" in B) {
      [A.topLeftRadius,    B.topLeftRadius   ] = [B.topLeftRadius,    A.topLeftRadius   ];
      [A.topRightRadius,   B.topRightRadius  ] = [B.topRightRadius,   A.topRightRadius  ];
      [A.bottomLeftRadius, B.bottomLeftRadius] = [B.bottomLeftRadius, A.bottomLeftRadius];
      [A.bottomRightRadius,B.bottomRightRadius]=[B.bottomRightRadius, A.bottomRightRadius];
      if ("cornerSmoothing" in A && "cornerSmoothing" in B)
        [A.cornerSmoothing, B.cornerSmoothing] = [B.cornerSmoothing, A.cornerSmoothing];
      return 1;
    }

    [A.cornerRadius, B.cornerRadius] = [B.cornerRadius, A.cornerRadius];
    if ("cornerSmoothing" in A && "cornerSmoothing" in B)
      [A.cornerSmoothing, B.cornerSmoothing] = [B.cornerSmoothing, A.cornerSmoothing];
    return 1;
  })() || undefined,

  fill: async (a, b) =>
    ("fills" in a && "fills" in b && (async () => {
      const A = a as any, B = b as any;
      const af = A.fills ?? [], bf = B.fills ?? [];
      const aStyle = "fillStyleId" in A ? A.fillStyleId : undefined;
      const bStyle = "fillStyleId" in B ? B.fillStyleId : undefined;

      const same = deepEqual(af, bf) && (aStyle === bStyle);
      if (same) return undefined;

      // swap paints first
      A.fills = cloneObjs(bf);
      B.fills = cloneObjs(af);

      // then swap linked styles using async API
      await setStyleIdAsync(A, "fill", bStyle);
      await setStyleIdAsync(B, "fill", aStyle);
      return 1 as const;
    })()) || undefined,

  stroke: async (a, b) => (
    "strokes" in a && "strokes" in b && (async () => {
      const A = a as any, B = b as any;

      const samePaints = deepEqual(A.strokes ?? [], B.strokes ?? []);
      const sameBasic =
        A.strokeWeight === B.strokeWeight &&
        A.strokeAlign === B.strokeAlign &&
        deepEqual(A.dashPattern ?? [], B.dashPattern ?? []) &&
        A.strokeCap === B.strokeCap &&
        A.strokeJoin === B.strokeJoin &&
        A.strokeMiterLimit === B.strokeMiterLimit;

      const hasSidesA = "strokeTopWeight" in A, hasSidesB = "strokeTopWeight" in B;
      const sameSides = hasSidesA && hasSidesB &&
        A.strokeTopWeight === B.strokeTopWeight &&
        A.strokeRightWeight === B.strokeRightWeight &&
        A.strokeBottomWeight === B.strokeBottomWeight &&
        A.strokeLeftWeight === B.strokeLeftWeight;

      if (samePaints && sameBasic && (!hasSidesA || !hasSidesB || sameSides)) return undefined;

      // swap paints first to satisfy eligibility for style/align settings
      const as = A.strokes, bs = B.strokes;
      A.strokes = cloneObjs(bs); B.strokes = cloneObjs(as);

      // swap style id if present
      try { 
        if ("strokeStyleId" in A && "strokeStyleId" in B) 
          [A.strokeStyleId, B.strokeStyleId] = [B.strokeStyleId, A.strokeStyleId]; 
      } catch (e) {
        // Style ID swap failed, continue with other properties
      }

      // then swap basic stroke props
      try {
        if ("strokeWeight" in A && "strokeWeight" in B) {
          if (typeof A.strokeWeight === "number" && typeof B.strokeWeight === "number") {
            [A.strokeWeight, B.strokeWeight] = [B.strokeWeight, A.strokeWeight];
          }
        }
      } catch (e) {
        // strokeWeight swap failed, continue
      }
      
      try { if ("strokeAlign"  in A && "strokeAlign"  in B) [A.strokeAlign,  B.strokeAlign ] = [B.strokeAlign,  A.strokeAlign ]; } catch (e) {}
      try { if ("dashPattern"  in A && "dashPattern"  in B) [A.dashPattern,  B.dashPattern ] = [B.dashPattern,  A.dashPattern ]; } catch (e) {}
      try { if ("strokeCap"    in A && "strokeCap"    in B) [A.strokeCap,    B.strokeCap   ] = [B.strokeCap,    A.strokeCap   ]; } catch (e) {}
      try { if ("strokeJoin"   in A && "strokeJoin"   in B) [A.strokeJoin,   B.strokeJoin  ] = [B.strokeJoin,   A.strokeJoin  ]; } catch (e) {}
      try { if ("strokeMiterLimit" in A && "strokeMiterLimit" in B) [A.strokeMiterLimit, B.strokeMiterLimit] = [B.strokeMiterLimit, A.strokeMiterLimit]; } catch (e) {}

      // finally per-side weights if both support them
      if (hasSidesA && hasSidesB) {
        try {
          [A.strokeTopWeight,    B.strokeTopWeight   ] = [B.strokeTopWeight,    A.strokeTopWeight   ];
          [A.strokeRightWeight,  B.strokeRightWeight ] = [B.strokeRightWeight,  A.strokeRightWeight ];
          [A.strokeBottomWeight, B.strokeBottomWeight] = [B.strokeBottomWeight, A.strokeBottomWeight];
          [A.strokeLeftWeight,   B.strokeLeftWeight  ] = [B.strokeLeftWeight,   A.strokeLeftWeight  ];
        } catch (e) {
          // Per-side weight swap failed
        }
      }

      return 1;
    })()
  ) || undefined,

  effect: async (a, b) =>
    ("effects" in a && "effects" in b && (async () => {
      const A = a as any, B = b as any;
      const ae = A.effects ?? [], be = B.effects ?? [];
      const aStyle = "effectStyleId" in A ? A.effectStyleId : undefined;
      const bStyle = "effectStyleId" in B ? B.effectStyleId : undefined;

      const same = deepEqual(ae, be) && (aStyle === bStyle);
      if (same) return undefined;

      A.effects = cloneObjs(be);
      B.effects = cloneObjs(ae);

      await setStyleIdAsync(A, "effect", bStyle);
      await setStyleIdAsync(B, "effect", aStyle);
      return 1 as const;
    })()) || undefined,

  "layout grid": async (a, b) =>
    ("layoutGrids" in a && "layoutGrids" in b && (async () => {
      const A = a as any, B = b as any;
      const ag = A.layoutGrids ?? [], bg = B.layoutGrids ?? [];
      const aStyle = "gridStyleId" in A ? A.gridStyleId : undefined;
      const bStyle = "gridStyleId" in B ? B.gridStyleId : undefined;

      const same = deepEqual(ag, bg) && (aStyle === bStyle);
      if (same) return undefined;

      A.layoutGrids = cloneObjs(bg);
      B.layoutGrids = cloneObjs(ag);

      await setStyleIdAsync(A, "grid", bStyle);
      await setStyleIdAsync(B, "grid", aStyle);
      return 1 as const;
    })()) || undefined,

  export: (a, b) => (
    "exportSettings" in a && "exportSettings" in b && (() => {
      const A = a as any, B = b as any;
      const ae = A.exportSettings ?? [];
      const be = B.exportSettings ?? [];
      if (deepEqual(ae, be)) return undefined;
      A.exportSettings = cloneObjs(be);
      B.exportSettings = cloneObjs(ae);
      return 1 as const;
    })()
  ) || undefined,

  "variable mode": async (a, b) => {
    const A = a as any, B = b as any;

    // Effective collections on each node
    const modesA = (A.resolvedVariableModes ?? {}) as Record<string, string>;
    const modesB = (B.resolvedVariableModes ?? {}) as Record<string, string>;

    // Only act where both nodes actually have variables resolved for the collection
    const shared = Object.keys(modesA).filter(id => id in modesB);
    if (shared.length === 0) return undefined;

    // Swap only EXPLICIT modes; do not force-set inherited defaults
    const expA = (A.explicitVariableModes ?? {}) as Record<string, string>;
    const expB = (B.explicitVariableModes ?? {}) as Record<string, string>;

    let changed = 0;

    for (const colId of shared) {
      const coll = await figma.variables.getVariableCollectionByIdAsync(colId);
      if (!coll) continue;

      const aExp = expA[colId];
      const bExp = expB[colId];

      // Apply A -> B
      if (aExp) { B.setExplicitVariableModeForCollection(coll, aExp); changed++; }
      else { B.clearExplicitVariableModeForCollection(coll); changed++; }

      // Apply B -> A
      if (bExp) { A.setExplicitVariableModeForCollection(coll, bExp); changed++; }
      else { A.clearExplicitVariableModeForCollection(coll); changed++; }
    }

    return changed > 0 ? 1 : undefined;
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
  const pair = requireTwo();
  if (typeof pair === "string") {
    throw new Error("Invalid selection"); // Will be caught by caller
  }
  const [a, b] = pair;
  const keys: PropKey[] = ["opacity","blend mode","corner radius","fill","stroke","effect","layout grid","export","variable mode"];
  const list = (prop === "all") ? keys : [prop];
  const ok: PropKey[] = [];
  const failed: { key: PropKey; err: string }[] = [];
  const ineligible: { key: PropKey; reason: string }[] = [];

  for (const k of list) {
    if (!(supports(k, a) && supports(k, b))) {
      ineligible.push({ key: k, reason: "unsupported on one or both nodes" });
      continue;
    }

    if (k === "corner radius") {
      console.log("[swap-debug] cornerRadius", (a as any).cornerRadius, (b as any).cornerRadius);
    } else if (k === "fill") {
      console.log("[swap-debug] fill", JSON.stringify((a as any).fills), JSON.stringify((b as any).fills));
    } else if (k === "stroke") {
      console.log("[swap-debug] stroke paints", JSON.stringify((a as any).strokes), JSON.stringify((b as any).strokes));
    } else if (k === "effect") {
      console.log("[swap-debug] effect", JSON.stringify((a as any).effects), JSON.stringify((b as any).effects));
    } else if (k === "layout grid") {
      console.log("[swap-debug] layoutGrids", JSON.stringify((a as any).layoutGrids), JSON.stringify((b as any).layoutGrids));
    } else if (k === "export") {
      console.log("[swap-debug] exportSettings", JSON.stringify((a as any).exportSettings), JSON.stringify((b as any).exportSettings));
    }

    try {
      const r = await (swap[k] as any)(a, b);
      if (r) ok.push(k);
      else ineligible.push({ key: k, reason: "no-op (identical or empty values)" });
    } catch (e: any) {
      failed.push({ key: k, err: String(e?.message || e) });
    }
  }

  console.log("[swap-debug] props result", { ok, failed, ineligible });
  
  return { okCount: ok.length, failCount: failed.length, skipCount: ineligible.length, ok, failed, ineligible };
}

// ---- run + parameters
figma.parameters.on("input", ({ query, key, result }) => {
  const q = (query ?? "").toLowerCase();
  if (key === "scope") {
    const choices = ["canvas position","layers panel"];
    result.setSuggestions(choices.filter(s => s.toLowerCase().includes(q)));
  } else if (key === "property") {
    const choices = ["opacity","variable mode","blend mode","corner radius","fill","stroke","effect","layout grid","export"];
    result.setSuggestions(choices.filter(s => s.toLowerCase().includes(q)));
  } else {
    result.setSuggestions([]);
  }
});

figma.on("run", async ({ command, parameters }) => {
  if (command === "switch-layers") {
    const scopeRaw = toKey(String(parameters?.scope ?? ""));
    const scope: "default"|"canvas"|"panel" =
      scopeRaw.includes("canvas") ? "canvas" :
      (scopeRaw.includes("layers") || scopeRaw.includes("panel")) ? "panel" : "default";
  
    const pair = requireTwo();
    let msg = "Switched layers.";
    
    if (typeof pair === "string") {
      switch (pair) {
        case "none": msg = "Select some layers first."; break;
        case "one": msg = "Select one more layer (2 total needed)."; break;
        case "toomany": msg = "Select only 2 layers (currently have more)."; break;
      }
      figma.closePlugin(msg); // Remove setTimeout
      return;
    }
  
    try {
      const res = doSwitchLayers(scope);
      if (res === "blocked") msg = "Not supported on components or instances.";
      else if (typeof res === "number" && res > 0) msg = `Switched layers with ${res} issue(s).`;
    } catch (e) { 
      msg = "Switched layers with issues."; 
    }
    
    figma.closePlugin(msg); // Remove setTimeout
    return;
  }

  if (command === "switch-properties") {
    const pair = requireTwo();
    
    if (typeof pair === "string") {
      let msg: string;
      switch (pair) {
        case "none": msg = "Select some layers first."; break;
        case "one": msg = "Select one more layer (2 total needed)."; break;
        case "toomany": msg = "Select only 2 layers (currently have more)."; break;
      }
      figma.closePlugin(msg);
      return;
    }
  
    const p = toKey(String(parameters?.property ?? ""));
    const map: Record<string, PropKey | "all"> = {
      "(all)":"all","all":"all","opacity":"opacity","blend":"blend mode","blend mode":"blend mode",
      "corner radius":"corner radius","radius":"corner radius","fill":"fill","stroke":"stroke",
      "effect":"effect","effects":"effect","layout grid":"layout grid","grid":"layout grid","export":"export","variable mode":"variable mode"
    };
  
    let msg = "Switched properties.";
    try {
      const res = await doSwitchProperties(map[p] ?? "all");
      if (res.okCount === 0 && res.failCount === 0) msg = "No eligible properties to switch.";
      else if (res.failCount === 0) msg = `Switched ${res.okCount}. ${res.skipCount} skipped.`;
      else msg = `Switched ${res.okCount}. ${res.failCount} failed. ${res.skipCount} skipped.`;
    } catch (e) { 
      msg = "Switched properties with issues."; 
    }
    
    figma.closePlugin(msg); // Remove setTimeout
    return;
  }

  if (command === "switch-ui") {
    figma.showUI(__html__, { width: 320, height: 436, themeColors: true });
    postSelectionState();
    bindUiHandlers();
  }
});

// ---- UI bridge
type UiOptions = {
  swapInLayers: boolean;
  layers: boolean;
  position: { x:boolean; y:boolean; rotation:boolean; constraints:boolean };
  appearance: { opacity:boolean; blendMode:boolean; cornerRadius:boolean };
  props: { fill:boolean; stroke:boolean; effect:boolean; layoutGrid:boolean; export:boolean; variableMode:boolean };
};
type UiMessage =
  | { type: "RUN_SWAP"; payload: { options: UiOptions|null } }
  | { type: "SELECTION_STATE"; payload?: any }
  | { type: "DONE"; payload?: any }
  | { type: "REQUEST_SELECTION_STATE" }
  | { type: "CLOSE" };

function postSelectionState() {
  if (!figma.ui) return;
  const pair = figma.currentPage.selection.filter((n): n is SceneNode => true).slice(0, 2);
  const all = (f: (n: SceneNode) => boolean) => pair.length === 2 && pair.every(f);

  const state = {
    twoSelected: pair.length === 2,
    canPosition: all(canSetRelativeTransform),
    canConstraints: all(n => "constraints" in n),
    canCorner:     all(n => "cornerRadius" in n || "topLeftRadius" in (n as any)),
    canFill:       all(n => "fills" in n),
    canStroke:     all(n => "strokes" in n),
    canEffect:     all(n => "effects" in n),
    canGrid:       all(n => "layoutGrids" in n),
    canExport:     all(n => "exportSettings" in n),
    canVariable:   all(n => "setExplicitVariableModeForCollection" in (n as any)),
    canLayerIndex: pair.length === 2 && !pair.some(inInstanceChain),
    canOpacity:    all(n => "opacity" in n),
    canBlend:      all(n => "blendMode" in n),
  };

  figma.ui.postMessage({ type: "SELECTION_STATE", payload: state });
}  

function bindUiHandlers() {
  figma.on("selectionchange", postSelectionState);
  figma.ui.onmessage = async (msg: UiMessage) => {
    if (msg.type === "REQUEST_SELECTION_STATE") { 
      postSelectionState(); 
      return; 
    }

    if (msg.type === "RUN_SWAP") {
      const opts = msg.payload.options;
      if (!opts) { 
        figma.closePlugin(); 
        return; 
      }
    
      const pair = requireTwo();
      if (typeof pair === "string") {
        let message: string;
        switch (pair) {
          case "none": message = "Select some layers first."; break;
          case "one": message = "Select one more layer (2 total needed)."; break;
          case "toomany": message = "Select only 2 layers (currently have more)."; break;
        }
        figma.notify(message);
        return; // Keep UI open for corrections
      }

      let ok = 0, fail = 0, skip = 0;

      // Panel / Canvas intents
      const wantPanel = !!opts.layers;
      const wantPos =
        !!opts.position &&
        (opts.position.x || opts.position.y || opts.position.rotation || opts.position.constraints);

      // Helpers
      const countTrue = (arr: boolean[]) => arr.reduce((n, v) => n + (v ? 1 : 0), 0);
      const tally = (r: "invalid" | "blocked" | number | void, attempts: number) => {
        if (attempts <= 0) return;
        if (r === "invalid" || r === "blocked") { fail += attempts; return; }
        if (typeof r === "number" && r > 0) {
          // r = number of failed transform operations returned by doSwitchLayers
          const f = Math.min(r, attempts);
          fail += f;
          ok += Math.max(0, attempts - f);
        } else {
          ok += attempts;
        }
      };

      // Execute transform swaps first
      if (wantPanel && wantPos) {
        const attempts = 1 + countTrue([opts.position.x, opts.position.y, opts.position.rotation, opts.position.constraints]);
        const r = doSwitchLayers("default", opts.position);
        tally(r, attempts);
      } else if (wantPanel) {
        const attempts = 1;
        const r = doSwitchLayers("panel");
        tally(r, attempts);
      } else if (wantPos) {
        const attempts = countTrue([opts.position.x, opts.position.y, opts.position.rotation, opts.position.constraints]);
        const r = doSwitchLayers("canvas", opts.position);
        tally(r, attempts);
      }

      // Properties
      const props: PropKey[] = [];
      if (opts.appearance?.opacity) props.push("opacity");
      if (opts.appearance?.blendMode) props.push("blend mode");
      if (opts.appearance?.cornerRadius) props.push("corner radius");
      if (opts.props?.fill) props.push("fill");
      if (opts.props?.stroke) props.push("stroke");
      if (opts.props?.effect) props.push("effect");
      if (opts.props?.layoutGrid) props.push("layout grid");
      if (opts.props?.export) props.push("export");
      if (opts.props?.variableMode) props.push("variable mode");

      for (const p of props) {
        const r = await doSwitchProperties(p);
        if (r && r !== "invalid") { 
          ok += r.okCount; 
          fail += r.failCount; 
          skip += r.skipCount; 
        }
      }

      // Mirror Switch Properties messaging, but keep UI open on failure
      if (fail === 0 && ok === 0 && !wantPos && !wantPanel) { 
        figma.notify("No eligible properties to switch."); 
        return; 
      }
      if (fail === 0) { 
        figma.closePlugin(`Switched ${ok}. ${skip} skipped.`); 
        return; 
      }
      figma.notify(`Switched ${ok}. ${fail} failed. ${skip} skipped.`);
      return;
    }

    if (msg.type === "CLOSE") figma.closePlugin();
  };
}