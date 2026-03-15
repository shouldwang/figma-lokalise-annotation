// create by shouldwang
// with vibe coding

// ==================== UTILITIES ====================

// UI Management
const UIManager = {
  showByCommand(command: string) {
    console.log("[showUIByCommand] command:", command);
    if (command === "annotate-lokalise") {
      figma.showUI(__uiFiles__.main, { width: 360, height: 800 });
    } else if (command === "get-lokalise-list") {
      figma.showUI(__uiFiles__.secondary, { width: 400, height: 800 });
    }
  }
};

// Node utilities
type AnnotationNode = GroupNode | InstanceNode;
type AnnotationContainer = PageNode | SceneNode;
type AnnotationIndex = Record<string, string>;

const ANNOTATION_INDEX_KEY = "annotationIndex";
const ANNOTATION_TYPE_VALUE = "component";
const ANNOTATION_NAME_PATTERN = /^lokaliseAnnotation-\d+$/;

const AnnotationIndexUtils = {
  read(): AnnotationIndex {
    const raw = figma.currentPage.getPluginData(ANNOTATION_INDEX_KEY);
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return {};
      const index: AnnotationIndex = {};
      for (const [uuid, nodeId] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof uuid === "string" && typeof nodeId === "string" && uuid && nodeId) {
          index[uuid] = nodeId;
        }
      }
      return index;
    } catch {
      return {};
    }
  },

  write(index: AnnotationIndex): void {
    figma.currentPage.setPluginData(ANNOTATION_INDEX_KEY, JSON.stringify(index));
  },

  set(uuid: string, nodeId: string): void {
    const index = this.read();
    index[uuid] = nodeId;
    this.write(index);
  },

  remove(uuid: string): void {
    const index = this.read();
    if (!index[uuid]) return;
    delete index[uuid];
    this.write(index);
  }
};

const NodeUtils = {
  // Find or cache the "Annotations" main group on the current page (legacy compatibility only)
  async getMainGroup(): Promise<GroupNode | null> {
    const isValidMainGroupName = (name: string) => name === "Annotations" || name === "📝 Annotations";
    const cachedId = figma.currentPage.getPluginData("mainGroupId");
    if (cachedId) {
      try {
        const node = await figma.getNodeByIdAsync(cachedId);
        if (node.type === "GROUP" && isValidMainGroupName(node.name)) {
          if (node.name !== "Annotations") node.name = "Annotations";
          return node as GroupNode;
        }
      } catch {
        console.log("[getMainGroup] Invalid cached mainGroupId:", cachedId);
      }
    }
    for (const node of figma.currentPage.children) {
      if (node.type === "GROUP" && isValidMainGroupName(node.name)) {
        if (node.name !== "Annotations") node.name = "Annotations";
        figma.currentPage.setPluginData("mainGroupId", node.id);
        return node as GroupNode;
      }
    }
    return null;
  },

  // Get the outermost frame ancestor of a node
  getOutermostFrame(node: SceneNode): FrameNode | null {
    let current: BaseNode | null = node;
    let outermost: FrameNode | null = null;
    while (current && current.parent && current.parent.type !== "PAGE") {
      if (current.parent.type === "FRAME") {
        outermost = current.parent as FrameNode;
      }
      current = current.parent as BaseNode;
    }
    return outermost;
  },

  getAnnotationUuid(node: AnnotationNode): string {
    return node.getPluginData("uuid") || node.name.match(/-(\d+)$/)?.[1] || "";
  },

  isAnnotationNode(node: SceneNode): node is AnnotationNode {
    if (node.type !== "GROUP" && node.type !== "INSTANCE") return false;
    if (node.getPluginData("annotationType") === ANNOTATION_TYPE_VALUE) return true;
    return ANNOTATION_NAME_PATTERN.test(node.name);
  },

  getContainerAbsoluteOrigin(container: AnnotationContainer): { x: number; y: number } {
    if (container.type === "PAGE") return { x: 0, y: 0 };
    const t = container.absoluteTransform;
    return { x: t[0][2], y: t[1][2] };
  },

  getPlacementContainer(textNode: TextNode): AnnotationContainer {
    const outermostFrame = this.getOutermostFrame(textNode);
    if (outermostFrame && outermostFrame.parent && "appendChild" in outermostFrame.parent) {
      return outermostFrame.parent as AnnotationContainer;
    }
    if (textNode.parent && "appendChild" in textNode.parent) {
      return textNode.parent as AnnotationContainer;
    }
    return figma.currentPage;
  },

  async rebuildAnnotationIndex(): Promise<AnnotationNode[]> {
    const nodes = figma.currentPage.findAll((node) => this.isAnnotationNode(node as SceneNode)) as AnnotationNode[];
    const index: AnnotationIndex = {};
    for (const node of nodes) {
      const uuid = this.getAnnotationUuid(node);
      if (!uuid) continue;
      index[uuid] = node.id;
    }
    AnnotationIndexUtils.write(index);
    return nodes.filter((node) => Boolean(this.getAnnotationUuid(node)));
  },

  // Find all lokalise annotation roots using index first, then fallback to full-page rebuild.
  async findLokaliseGroups(): Promise<AnnotationNode[]> {
    const index = AnnotationIndexUtils.read();
    const uuids = Object.keys(index);
    if (uuids.length === 0) {
      return await this.rebuildAnnotationIndex();
    }

    const nodes: AnnotationNode[] = [];
    const nextIndex: AnnotationIndex = {};

    for (const uuid of uuids) {
      const nodeId = index[uuid];
      if (!nodeId) continue;
      const node = await figma.getNodeByIdAsync(nodeId);
      if (!node || !("type" in node)) continue;
      if (!this.isAnnotationNode(node as SceneNode)) continue;
      const annotationNode = node as AnnotationNode;
      const realUuid = this.getAnnotationUuid(annotationNode);
      if (!realUuid) continue;
      nextIndex[realUuid] = annotationNode.id;
      nodes.push(annotationNode);
    }

    if (nodes.length === 0) {
      return await this.rebuildAnnotationIndex();
    }

    if (JSON.stringify(nextIndex) !== JSON.stringify(index)) {
      AnnotationIndexUtils.write(nextIndex);
    }
    return nodes;
  },

  async findAnnotationByUuid(uuid: string): Promise<AnnotationNode | null> {
    if (!uuid) return null;
    const index = AnnotationIndexUtils.read();
    const nodeId = index[uuid];
    if (nodeId) {
      const node = await figma.getNodeByIdAsync(nodeId);
      if (node && "type" in node && this.isAnnotationNode(node as SceneNode)) {
        return node as AnnotationNode;
      }
      delete index[uuid];
      AnnotationIndexUtils.write(index);
    }

    const nodes = await this.findLokaliseGroups();
    return nodes.find((node) => this.getAnnotationUuid(node) === uuid) || null;
  }
};

// Storage utilities
const StorageUtils = {
  async getLanguageSettings(): Promise<any> {
    const saved = await figma.clientStorage.getAsync("languageSettings");
    
    // If user has saved settings, return them
    if (saved && saved.supportedLanguages && saved.supportedLanguages.length > 0) {
      return saved;
    }
    
    // Otherwise return defaults with pre-selected languages
    return {
      baseLanguage: { code: 'en', name: 'English' },
      supportedLanguages: [
        { code: 'ja', name: 'Japanese' },
        { code: 'zh_TW', name: 'Chinese Traditional' },
        { code: 'en_US', name: 'English (United States)' },
        { code: 'zh_CN', name: 'Chinese Simplified' }
      ]
    };
  },

  async saveLanguageSettings(languageSettings: any): Promise<void> {
    await figma.clientStorage.setAsync("languageSettings", languageSettings);
  }
};

// Binding + component annotation settings (synced with ref.js flow)
const STORAGE_KEY_COMPONENT = "annotationComponentKey";
const STORAGE_KEY_COMPONENT_NAME = "annotationComponentName";
const STORAGE_KEY_COMPONENT_SET = "annotationComponentSetKey";
const STORAGE_KEY_COMPONENT_NODE = "annotationComponentNodeId";
const STORAGE_KEY_COMPONENT_SET_NODE = "annotationComponentSetNodeId";
const STORAGE_KEY_PROJECT_OPTIONS = "annotationProjectOptions";

const NESTED_PROJECT_INSTANCE_NAME = ".LokaProjectName";
const DEFAULT_COMPONENT_SET_NAME = "Lokalise Annotation 2.0";
const DEFAULT_PROJECT_COMPONENT_SET_NAME = ".LokaProjectName";
const DEFAULT_PROJECT_OPTIONS = ["A", "B", "C"];
const DEFAULT_POINTER_VALUES = ["朝上", "朝下", "朝左", "朝右"];
const POINTER_VALUE: Record<string, string> = {
  TOP: "朝下",
  BOTTOM: "朝上",
  LEFT: "朝右",
  RIGHT: "朝左"
};
const ANNOTATION_PADDING = 8;
const COLOR_BLUE = { r: 0.114, g: 0.306, b: 0.847 };
const COLOR_BLACK = { r: 0, g: 0, b: 0 };
const COLOR_WHITE = { r: 1, g: 1, b: 1 };
const COLOR_EXIST = { r: 0.7059, g: 0, b: 1 };

let annotationComponentKey = "";
let annotationComponentName = "";
let annotationComponentSetKey = "";
let annotationComponentNodeId = "";
let annotationComponentSetNodeId = "";
let cachedProjectOptions: string[] = [];
let isBound = false;

async function initBindingState(): Promise<void> {
  annotationComponentKey = (await figma.clientStorage.getAsync(STORAGE_KEY_COMPONENT)) || "";
  annotationComponentName = (await figma.clientStorage.getAsync(STORAGE_KEY_COMPONENT_NAME)) || "";
  annotationComponentSetKey = (await figma.clientStorage.getAsync(STORAGE_KEY_COMPONENT_SET)) || "";
  annotationComponentNodeId = (await figma.clientStorage.getAsync(STORAGE_KEY_COMPONENT_NODE)) || "";
  annotationComponentSetNodeId = (await figma.clientStorage.getAsync(STORAGE_KEY_COMPONENT_SET_NODE)) || "";
  cachedProjectOptions = (await figma.clientStorage.getAsync(STORAGE_KEY_PROJECT_OPTIONS)) || [];
  isBound = Boolean(annotationComponentKey || annotationComponentNodeId);
}

async function getBoundProjectOptions(): Promise<string[]> {
  if (!isBound) return [];
  try {
    const options = await getProjectOptionsFromBoundComponent();
    if (options.length > 0) {
      cachedProjectOptions = options;
      await figma.clientStorage.setAsync(STORAGE_KEY_PROJECT_OPTIONS, options);
      return options;
    }
  } catch (error) {
    console.log("[binding] getBoundProjectOptions failed:", error);
  }
  return Array.isArray(cachedProjectOptions) ? cachedProjectOptions : [];
}

function postBindingInitState(projectOptions: string[]) {
  figma.ui.postMessage({
    type: "init-state",
    isBound,
    hasSelection: figma.currentPage.selection.length > 0,
    projectOptions,
    boundComponentName: annotationComponentName,
    boundComponentKey: annotationComponentKey
  });
}

function postSelectionState() {
  figma.ui.postMessage({
    type: "selection-state",
    hasSelection: figma.currentPage.selection.length > 0
  });
}

async function handleBindComponentFlow(): Promise<void> {
  const selection = figma.currentPage.selection;
  if (selection.length !== 1) {
    figma.notify("Please select exactly one component set, component, or instance first.");
    return;
  }

  const selected = selection[0];
  const bindingTarget = await resolveBindingTargetFromSelection(selected);
  const component = bindingTarget.component;
  if (!component || !component.key) {
    figma.notify("Binding failed: please select a component set, component, or instance.");
    return;
  }

  await persistBinding(bindingTarget);
  const projectOptions = await getProjectOptionsFromBoundComponent(bindingTarget.component);
  await figma.clientStorage.setAsync(STORAGE_KEY_PROJECT_OPTIONS, projectOptions);
  cachedProjectOptions = projectOptions;

  figma.notify("Lokalise Annotation component bound successfully.");
  figma.ui.postMessage({
    type: "bind-success",
    projectOptions,
    boundComponentName: annotationComponentName,
    boundComponentKey: annotationComponentKey,
    hasSelection: figma.currentPage.selection.length > 0
  });
}

async function handleCreateBindComponentFlow(): Promise<void> {
  try {
    let componentSet = findLocalComponentSetByName(DEFAULT_COMPONENT_SET_NAME);
    if (!componentSet) {
      componentSet = await createDefaultAnnotationComponentSet();
      figma.notify("Starter Lokalise Annotation component set created.");
    }

    const bindingTarget = await resolveBindingTargetFromSelection(componentSet);
    if (!bindingTarget.component) {
      figma.notify("Create & Bind failed: unable to resolve component from generated set.");
      return;
    }

    await persistBinding(bindingTarget);
    const projectOptions = await getProjectOptionsFromBoundComponent(bindingTarget.component);
    await figma.clientStorage.setAsync(STORAGE_KEY_PROJECT_OPTIONS, projectOptions);
    cachedProjectOptions = projectOptions;

    figma.notify("Starter component created and bound successfully.");
    figma.ui.postMessage({
      type: "bind-success",
      projectOptions,
      boundComponentName: annotationComponentName,
      boundComponentKey: annotationComponentKey,
      hasSelection: figma.currentPage.selection.length > 0
    });
  } catch (error) {
    figma.notify(`Create & Bind failed: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}

async function handleUnbindComponentFlow(): Promise<void> {
  await figma.clientStorage.deleteAsync(STORAGE_KEY_COMPONENT);
  await figma.clientStorage.deleteAsync(STORAGE_KEY_COMPONENT_NAME);
  await figma.clientStorage.deleteAsync(STORAGE_KEY_COMPONENT_SET);
  await figma.clientStorage.deleteAsync(STORAGE_KEY_COMPONENT_NODE);
  await figma.clientStorage.deleteAsync(STORAGE_KEY_COMPONENT_SET_NODE);
  await figma.clientStorage.deleteAsync(STORAGE_KEY_PROJECT_OPTIONS);

  annotationComponentKey = "";
  annotationComponentName = "";
  annotationComponentSetKey = "";
  annotationComponentNodeId = "";
  annotationComponentSetNodeId = "";
  cachedProjectOptions = [];
  isBound = false;

  figma.notify("Lokalise Annotation component has been unbound.");
  figma.ui.postMessage({
    type: "unbind-success",
    hasSelection: figma.currentPage.selection.length > 0
  });
}

async function resolveBindingTargetFromSelection(node: SceneNode): Promise<any> {
  if (node.type === "COMPONENT_SET") {
    const firstVariant = node.children.find((child) => child.type === "COMPONENT") as ComponentNode | null;
    return {
      component: firstVariant,
      displayName: node.name || "Bound Annotation Component",
      componentSetKey: node.key || "",
      componentSetNodeId: node.id || ""
    };
  }

  if (node.type === "COMPONENT") {
    const setName = node.parent && node.parent.type === "COMPONENT_SET" ? node.parent.name : "";
    const setKey = node.parent && node.parent.type === "COMPONENT_SET" ? node.parent.key : "";
    return {
      component: node,
      displayName: setName || node.name || "Bound Annotation Component",
      componentSetKey: setKey || "",
      componentSetNodeId: node.parent && node.parent.type === "COMPONENT_SET" ? node.parent.id : ""
    };
  }

  if (node.type === "INSTANCE") {
    const mainComponent = await getInstanceMainComponentSafe(node);
    const setName =
      mainComponent && mainComponent.parent && mainComponent.parent.type === "COMPONENT_SET"
        ? mainComponent.parent.name
        : "";
    const setKey =
      mainComponent && mainComponent.parent && mainComponent.parent.type === "COMPONENT_SET"
        ? mainComponent.parent.key
        : "";
    return {
      component: mainComponent,
      displayName: setName || (mainComponent ? mainComponent.name : "") || "Bound Annotation Component",
      componentSetKey: setKey || "",
      componentSetNodeId:
        mainComponent && mainComponent.parent && mainComponent.parent.type === "COMPONENT_SET"
          ? mainComponent.parent.id
          : ""
    };
  }

  return {
    component: null,
    displayName: "",
    componentSetKey: "",
    componentSetNodeId: ""
  };
}

async function getInstanceMainComponentSafe(instance: InstanceNode): Promise<ComponentNode | null> {
  try {
    const main = await instance.getMainComponentAsync();
    return main && main.type === "COMPONENT" ? main : null;
  } catch (_e) {
    return null;
  }
}

async function persistBinding(bindingTarget: any): Promise<void> {
  const component = bindingTarget.component as ComponentNode;
  annotationComponentKey = component.key;
  annotationComponentName = bindingTarget.displayName || component.name || "Bound Annotation Component";
  annotationComponentSetKey = bindingTarget.componentSetKey || "";
  annotationComponentNodeId = component.id || "";
  annotationComponentSetNodeId = bindingTarget.componentSetNodeId || "";
  await figma.clientStorage.setAsync(STORAGE_KEY_COMPONENT, annotationComponentKey);
  await figma.clientStorage.setAsync(STORAGE_KEY_COMPONENT_NAME, annotationComponentName);
  await figma.clientStorage.setAsync(STORAGE_KEY_COMPONENT_SET, annotationComponentSetKey);
  await figma.clientStorage.setAsync(STORAGE_KEY_COMPONENT_NODE, annotationComponentNodeId);
  await figma.clientStorage.setAsync(STORAGE_KEY_COMPONENT_SET_NODE, annotationComponentSetNodeId);
  isBound = true;
}

function findLocalComponentSetByName(name: string): ComponentSetNode | null {
  const found = figma.currentPage.findOne((node) => node.type === "COMPONENT_SET" && node.name === name);
  return found && found.type === "COMPONENT_SET" ? found : null;
}

async function createDefaultAnnotationComponentSet(): Promise<ComponentSetNode> {
  await loadFirstAvailableFont([
    { family: "DM Mono", style: "Medium" },
    { family: "Inter", style: "Medium" }
  ]);
  await loadFirstAvailableFont([
    { family: "DM Mono", style: "Medium Italic" },
    { family: "Inter", style: "Italic" },
    { family: "Inter", style: "Regular" }
  ]);

  const projectSet = await findOrCreateProjectComponentSet();
  const projectComponent =
    projectSet && projectSet.children.length > 0 && projectSet.children[0].type === "COMPONENT"
      ? (projectSet.children[0] as ComponentNode)
      : null;

  const variants: ComponentNode[] = [];
  let x = figma.viewport.center.x - 420;
  let y = figma.viewport.center.y - 240;

  for (const pointer of DEFAULT_POINTER_VALUES) {
    const component = figma.createComponent();
    component.name = `Pointer=${pointer}`;
    component.x = x;
    component.y = y;
    component.strokeWeight = 2;
    component.cornerRadius = 4;
    component.fills = [];
    component.strokes = [];
    component.layoutMode = pointer === "朝上" || pointer === "朝下" ? "VERTICAL" : "HORIZONTAL";
    component.primaryAxisSizingMode = "AUTO";
    component.counterAxisSizingMode = "AUTO";
    component.primaryAxisAlignItems = "MIN";
    component.counterAxisAlignItems = "CENTER";
    component.itemSpacing = 0;

    const pointerVector = await createPointerVector(pointer);
    const card = figma.createFrame();
    card.name = "Card";
    card.layoutMode = "HORIZONTAL";
    card.primaryAxisSizingMode = "AUTO";
    card.counterAxisSizingMode = "AUTO";
    card.primaryAxisAlignItems = "MIN";
    card.counterAxisAlignItems = "CENTER";
    card.itemSpacing = 4;
    card.paddingTop = 4;
    card.paddingBottom = 4;
    card.paddingLeft = 6;
    card.paddingRight = 6;
    card.cornerRadius = 4;
    card.strokes = [{ type: "SOLID", color: COLOR_BLUE }];
    card.strokeWeight = 1;
    card.fills = [{ type: "SOLID", color: COLOR_WHITE }];

    if (projectComponent) {
      const projectInstance = projectComponent.createInstance();
      projectInstance.name = NESTED_PROJECT_INSTANCE_NAME;
      card.appendChild(projectInstance);
    }

    const title = figma.createText();
    title.name = "Title";
    title.fontName = await resolveLoadedFont([
      { family: "DM Mono", style: "Medium" },
      { family: "Inter", style: "Medium" }
    ]);
    title.characters = "String Key";
    title.fontSize = 12;
    title.fills = [{ type: "SOLID", color: COLOR_BLACK }];
    card.appendChild(title);

    const existText = figma.createText();
    existText.name = "[Exist]";
    existText.fontName = await resolveLoadedFont([
      { family: "DM Mono", style: "Medium Italic" },
      { family: "Inter", style: "Italic" },
      { family: "Inter", style: "Regular" }
    ]);
    existText.characters = "[Exist]";
    existText.fontSize = 9;
    existText.fills = [{ type: "SOLID", color: COLOR_EXIST }];
    existText.visible = false;
    card.appendChild(existText);

    const pointerFirst = pointer === "朝左" || pointer === "朝上";
    if (pointerFirst) {
      component.appendChild(pointerVector);
      component.appendChild(card);
    } else {
      component.appendChild(card);
      component.appendChild(pointerVector);
    }

    const keyProp = component.addComponentProperty("KeyName", "TEXT", "String Key");
    title.componentPropertyReferences = { characters: keyProp };
    const existProp = component.addComponentProperty("Exist", "BOOLEAN", false);
    existText.componentPropertyReferences = { visible: existProp };

    variants.push(component);
    y += 260;
    if (pointer === "朝下") {
      x += 460;
      y = figma.viewport.center.y - 240;
    }
  }

  const set = figma.combineAsVariants(variants, figma.currentPage);
  set.name = DEFAULT_COMPONENT_SET_NAME;
  set.cornerRadius = 0;
  return set;
}

async function createPointerVector(pointer: string): Promise<VectorNode> {
  const vector = figma.createVector();
  vector.name = "Pointer";
  vector.fills = [];
  vector.strokes = [{ type: "SOLID", color: COLOR_BLUE }];
  vector.strokeWeight = 1.5;

  let start = { x: 0, y: 0 };
  let end = { x: 0, y: 0 };
  if (pointer === "朝左") {
    start = { x: 196, y: 8 };
    end = { x: 0, y: 8 };
    vector.resize(196, 16);
  } else if (pointer === "朝右") {
    start = { x: 0, y: 8 };
    end = { x: 196, y: 8 };
    vector.resize(196, 16);
  } else if (pointer === "朝上") {
    start = { x: 8, y: 196 };
    end = { x: 8, y: 0 };
    vector.resize(16, 196);
  } else {
    start = { x: 8, y: 0 };
    end = { x: 8, y: 196 };
    vector.resize(16, 196);
  }

  const vectorNetwork: VectorNetwork = {
    vertices: [
      { x: start.x, y: start.y, strokeCap: "NONE" },
      { x: end.x, y: end.y, strokeCap: "ARROW_EQUILATERAL" }
    ],
    segments: [{ start: 0, end: 1 }],
    regions: []
  };
  await vector.setVectorNetworkAsync(vectorNetwork);
  return vector;
}

async function findOrCreateProjectComponentSet(): Promise<ComponentSetNode> {
  const existing = findLocalComponentSetByName(DEFAULT_PROJECT_COMPONENT_SET_NAME);
  if (existing) return existing;
  return createProjectComponentSet();
}

async function createProjectComponentSet(): Promise<ComponentSetNode> {
  const projectFont = await resolveLoadedFont([
    { family: "DM Mono", style: "Medium" },
    { family: "Inter", style: "Medium" }
  ]);

  const variants: ComponentNode[] = [];
  let x = figma.viewport.center.x + 120;
  const y = figma.viewport.center.y - 240;
  for (const project of DEFAULT_PROJECT_OPTIONS) {
    const component = figma.createComponent();
    component.name = `projectName=${project}`;
    component.x = x;
    component.y = y;
    component.layoutMode = "HORIZONTAL";
    component.primaryAxisSizingMode = "AUTO";
    component.counterAxisSizingMode = "AUTO";
    component.primaryAxisAlignItems = "MIN";
    component.counterAxisAlignItems = "MIN";
    component.itemSpacing = 0;
    component.paddingTop = 2;
    component.paddingRight = 4;
    component.paddingBottom = 2;
    component.paddingLeft = 4;
    component.cornerRadius = 1;
    component.fills = [{ type: "SOLID", color: COLOR_BLUE }];
    component.strokes = [];

    const text = figma.createText();
    text.name = "projectName";
    text.fontName = projectFont;
    text.characters = project;
    text.fontSize = 10;
    text.fills = [{ type: "SOLID", color: COLOR_WHITE }];
    component.appendChild(text);

    variants.push(component);
    x += Math.max(40, text.width + 24);
  }

  const set = figma.combineAsVariants(variants, figma.currentPage);
  set.name = DEFAULT_PROJECT_COMPONENT_SET_NAME;
  set.cornerRadius = 0;
  return set;
}

async function loadFirstAvailableFont(candidates: FontName[]): Promise<FontName> {
  for (const font of candidates) {
    try {
      await figma.loadFontAsync(font);
      return font;
    } catch (_e) {}
  }
  throw new Error(`Unable to load any font from candidates: ${JSON.stringify(candidates)}`);
}

async function resolveLoadedFont(candidates: FontName[]): Promise<FontName> {
  return loadFirstAvailableFont(candidates);
}

async function getAnnotationComponent(): Promise<ComponentNode | null> {
  if (annotationComponentKey) {
    try {
      return await figma.importComponentByKeyAsync(annotationComponentKey);
    } catch (_e) {}
  }
  if (annotationComponentNodeId) {
    try {
      const node = await figma.getNodeByIdAsync(annotationComponentNodeId);
      if (node && node.type === "COMPONENT") return node;
    } catch (_e) {}
  }
  if (annotationComponentSetNodeId) {
    try {
      const setNode = await figma.getNodeByIdAsync(annotationComponentSetNodeId);
      if (setNode && setNode.type === "COMPONENT_SET") {
        const first = setNode.children.find((child) => child.type === "COMPONENT");
        if (first && first.type === "COMPONENT") return first;
      }
    } catch (_e) {}
  }
  return null;
}

async function getBoundComponentSet(): Promise<ComponentSetNode | null> {
  if (annotationComponentSetKey) {
    try {
      return await figma.importComponentSetByKeyAsync(annotationComponentSetKey);
    } catch (_e) {}
  }
  if (annotationComponentSetNodeId) {
    try {
      const node = await figma.getNodeByIdAsync(annotationComponentSetNodeId);
      if (node && node.type === "COMPONENT_SET") return node;
    } catch (_e) {}
  }
  return null;
}

async function getProjectOptionsFromBoundComponent(componentOverride?: ComponentNode): Promise<string[]> {
  const component = componentOverride || (await getAnnotationComponent());
  if (!component) return [];

  const nestedOptions = await getProjectOptionsFromNestedProjectInstance(component);
  if (nestedOptions.length > 0) return nestedOptions;

  const deepScanOptions = await getProjectOptionsByDeepScan(component);
  if (deepScanOptions.length > 0) return deepScanOptions;

  if (annotationComponentSetKey || annotationComponentSetNodeId) {
    const componentSet = await getBoundComponentSet();
    if (componentSet) {
      let options = await getProjectOptionsFromDefinitions((componentSet as any).componentPropertyDefinitions || {});
      if (options.length === 0) {
        options = getProjectOptionsFromVariantGroups((componentSet as any).variantGroupProperties || {});
      }
      if (options.length > 0) return options;
    }
  }

  const componentDefinitions = getComponentPropertyDefinitionsSafe(component);
  if (componentDefinitions) {
    const options = await getProjectOptionsFromDefinitions(componentDefinitions);
    if (options.length > 0) return options;
  }

  const parent = component.parent;
  if (parent && parent.type === "COMPONENT_SET") {
    let options = await getProjectOptionsFromDefinitions((parent as any).componentPropertyDefinitions || {});
    if (options.length === 0) {
      options = getProjectOptionsFromVariantGroups((parent as any).variantGroupProperties || {});
    }
    if (options.length > 0) return options;
  }
  return [];
}

async function getProjectOptionsFromDefinitions(definitions: any): Promise<string[]> {
  for (const [rawKey, def] of Object.entries(definitions || {}) as any[]) {
    if (!isProjectPropertyKey(rawKey)) continue;
    if (def.type === "VARIANT" && Array.isArray(def.variantOptions) && def.variantOptions.length > 0) {
      return def.variantOptions;
    }
    if (def.type === "INSTANCE_SWAP" && Array.isArray(def.preferredValues) && def.preferredValues.length > 0) {
      const values = await resolvePreferredValues(def.preferredValues);
      if (values.length > 0) return values;
    }
  }

  for (const [, def] of Object.entries(definitions || {}) as any[]) {
    if (def.type === "VARIANT" && Array.isArray(def.variantOptions) && def.variantOptions.length > 0) {
      if (looksLikeProjectValues(def.variantOptions)) return def.variantOptions;
    }
    if (def.type === "INSTANCE_SWAP" && Array.isArray(def.preferredValues) && def.preferredValues.length > 0) {
      const values = await resolvePreferredValues(def.preferredValues);
      if (looksLikeProjectValues(values)) return values;
    }
  }
  return [];
}

function getProjectOptionsFromVariantGroups(groups: any): string[] {
  for (const [rawKey, def] of Object.entries(groups || {}) as any[]) {
    if (!isProjectPropertyKey(rawKey)) continue;
    if (Array.isArray(def.values) && def.values.length > 0) return def.values;
  }
  for (const [, def] of Object.entries(groups || {}) as any[]) {
    if (!Array.isArray(def.values) || def.values.length === 0) continue;
    if (looksLikeProjectValues(def.values)) return def.values;
  }
  return [];
}

function isProjectPropertyKey(rawKey: string): boolean {
  const raw = String(rawKey).toLowerCase();
  const normalized = normalizePropertyName(rawKey).toLowerCase();
  return raw.includes("project") || normalized === "project" || normalized === "projectname" || normalized.includes("project");
}

function looksLikeProjectValues(values: any[]): boolean {
  return values.some((value) => /^(\d+)([.\w() -]*)$/i.test(String(value).trim()));
}

function normalizePropertyName(rawKey: string): string {
  return String(rawKey).split("#")[0];
}

function getComponentPropertyDefinitionsSafe(component: ComponentNode): any {
  try {
    return (component as any).componentPropertyDefinitions || {};
  } catch (_e) {
    return null;
  }
}

async function resolvePreferredValues(preferredValues: any[]): Promise<string[]> {
  const labels: string[] = [];
  for (const item of preferredValues || []) {
    if (typeof item === "string") {
      labels.push(item);
      continue;
    }
    if (item && typeof item.name === "string" && item.name.trim()) {
      labels.push(item.name.trim());
      continue;
    }
    const key = item && typeof item.key === "string" ? item.key : "";
    if (!key) continue;
    const bySet = await tryGetNodeNameByKey(key, true);
    if (bySet) {
      labels.push(bySet);
      continue;
    }
    const byComponent = await tryGetNodeNameByKey(key, false);
    if (byComponent) labels.push(byComponent);
  }
  return Array.from(new Set(labels.filter(Boolean)));
}

async function tryGetNodeNameByKey(key: string, isSet: boolean): Promise<string> {
  try {
    const node = isSet ? await figma.importComponentSetByKeyAsync(key) : await figma.importComponentByKeyAsync(key);
    return node && node.name ? String(node.name).trim() : "";
  } catch (_e) {
    return "";
  }
}

async function getProjectOptionsFromNestedProjectInstance(component: ComponentNode): Promise<string[]> {
  return withProbeInstance(component, async (probe) => {
    const nested = findNestedProjectInstance(probe);
    if (!nested) return [];

    const main = await getInstanceMainComponentSafe(nested);
    if (!main) return [];

    const mainDefinitions = getComponentPropertyDefinitionsSafe(main);
    if (mainDefinitions) {
      const options = await getProjectOptionsFromDefinitions(mainDefinitions);
      if (options.length > 0) return options;
    }

    const parent = main.parent;
    if (parent && parent.type === "COMPONENT_SET") {
      let options = await getProjectOptionsFromDefinitions((parent as any).componentPropertyDefinitions || {});
      if (options.length === 0) {
        options = getProjectOptionsFromVariantGroups((parent as any).variantGroupProperties || {});
      }
      if (options.length > 0) return options;
    }

    return [];
  });
}

async function getProjectOptionsByDeepScan(component: ComponentNode): Promise<string[]> {
  return withProbeInstance(component, async (probe) => {
    const nestedInstances = probe.findAll((node) => node.type === "INSTANCE") as InstanceNode[];
    for (const nested of nestedInstances) {
      const main = await getInstanceMainComponentSafe(nested);
      if (!main) continue;
      const mainDefinitions = getComponentPropertyDefinitionsSafe(main);
      if (mainDefinitions) {
        const options = await getProjectOptionsFromDefinitions(mainDefinitions);
        if (options.length > 0) return options;
      }
      const parent = main.parent;
      if (parent && parent.type === "COMPONENT_SET") {
        let options = await getProjectOptionsFromDefinitions((parent as any).componentPropertyDefinitions || {});
        if (options.length === 0) {
          options = getProjectOptionsFromVariantGroups((parent as any).variantGroupProperties || {});
        }
        if (options.length > 0) return options;
      }
    }
    return [];
  });
}

async function withProbeInstance<T>(component: ComponentNode, fn: (probe: InstanceNode) => Promise<T>): Promise<T> {
  const probe = component.createInstance();
  probe.visible = false;
  probe.x = figma.viewport.center.x + 20000;
  probe.y = figma.viewport.center.y + 20000;
  figma.currentPage.appendChild(probe);
  try {
    return await fn(probe);
  } finally {
    if (probe.parent) probe.remove();
  }
}

function findNestedProjectInstance(root: BaseNode & ChildrenMixin): InstanceNode | null {
  const candidates = root.findAll((node) => node.type === "INSTANCE") as InstanceNode[];

  for (const node of candidates) {
    const propKey = findInstancePropertyKey(node, (name) => name.includes("project"));
    if (propKey) return node;
  }

  for (const node of candidates) {
    const instanceName = String(node.name || "").toLowerCase();
    if (
      instanceName.includes(NESTED_PROJECT_INSTANCE_NAME.toLowerCase()) ||
      instanceName.includes("project")
    ) {
      return node;
    }
  }
  return null;
}

function findInstancePropertyKey(instance: InstanceNode, matcher: (name: string) => boolean): string {
  for (const [rawKey] of Object.entries(instance.componentProperties || {})) {
    const raw = String(rawKey).toLowerCase();
    const normalized = normalizePropertyName(rawKey).toLowerCase();
    if (matcher(raw) || matcher(normalized)) return rawKey;
  }
  return "";
}

function getInstanceExistValue(instance: InstanceNode): boolean {
  const existKey = findInstancePropertyKey(instance, (name) => name === "exist" || name.includes("exist"));
  if (existKey) {
    const prop = (instance.componentProperties || {})[existKey] as any;
    if (prop && typeof prop.value === "boolean") return prop.value;
    if (prop && typeof prop.value === "string") return prop.value === "true";
  }

  const existText = instance.findOne(
    (node) => node.type === "TEXT" && String(node.name || "").toLowerCase().includes("exist")
  ) as TextNode | null;
  return Boolean(existText && existText.visible);
}

async function applyProperties(instance: InstanceNode, values: { project: string; exist: boolean; keyName: string }) {
  const props: Record<string, string | boolean> = {};
  const projectKey = findInstancePropertyKey(instance, (name) => name.includes("project"));
  const existKey = findInstancePropertyKey(instance, (name) => name === "exist" || name.includes("exist"));
  const keyNameKey = findInstancePropertyKey(instance, (name) => name === "keyname" || name.includes("keyname"));

  if (projectKey) props[projectKey] = String(values.project);
  if (existKey) props[existKey] = Boolean(values.exist);
  if (keyNameKey) props[keyNameKey] = String(values.keyName);
  if (Object.keys(props).length > 0) instance.setProperties(props);

  if (!projectKey) {
    setNestedProjectProperty(instance, String(values.project));
    await setProjectTextFallback(instance, String(values.project));
  }
  if (!keyNameKey) {
    await setKeyNameTextFallback(instance, String(values.keyName));
  }
}

function setPointer(instance: InstanceNode, side: "TOP" | "BOTTOM" | "LEFT" | "RIGHT") {
  const pointer = POINTER_VALUE[side];
  const pointerKey = findInstancePropertyKey(instance, (name) => name === "pointer" || name.includes("pointer"));
  if (!pointerKey) return;
  instance.setProperties({ [pointerKey]: pointer });
}

function setNestedProjectProperty(instance: InstanceNode, projectValue: string) {
  const nested = findNestedProjectInstance(instance);
  if (!nested) return;
  const key = findInstancePropertyKey(nested, (name) => name.includes("project"));
  if (!key) return;
  nested.setProperties({ [key]: projectValue });
}

async function setKeyNameTextFallback(instance: InstanceNode, value: string) {
  const target = instance.findOne((node) => node.type === "TEXT" && String(node.name || "").toLowerCase().includes("key"));
  if (!target || target.type !== "TEXT") return;
  await writeTextNode(target, value);
}

async function setProjectTextFallback(instance: InstanceNode, value: string) {
  const target = instance.findOne((node) => node.type === "TEXT" && String(node.name || "").toLowerCase().includes("project"));
  if (!target || target.type !== "TEXT") return;
  await writeTextNode(target, value);
}

async function writeTextNode(textNode: TextNode, value: string) {
  if (textNode.fontName !== figma.mixed) {
    await figma.loadFontAsync(textNode.fontName as FontName);
    textNode.characters = value;
    return;
  }
  const segments = textNode.getStyledTextSegments(["fontName"]);
  for (const segment of segments) {
    await figma.loadFontAsync(segment.fontName as FontName);
  }
  textNode.characters = value;
}

// Position calculation utilities
const PositionUtils = {
  calculateGaps(textNode: TextNode) {
    const t = textNode.absoluteTransform;
    const x = t[0][2], y = t[1][2];
    const w = textNode.width, h = textNode.height;
    const outer = NodeUtils.getOutermostFrame(textNode);
    const viewport = figma.viewport.bounds;
    const leftBound = outer ? outer.absoluteTransform[0][2] : viewport.x;
    const rightBound = outer ? leftBound + outer.width : viewport.x + viewport.width;
    const topBound = outer ? outer.absoluteTransform[1][2] : viewport.y;
    const bottomBound = outer ? topBound + outer.height : viewport.y + viewport.height;
    
    return {
      left: x - leftBound,
      right: rightBound - (x + w),
      top: y - topBound,
      bottom: bottomBound - (y + h)
    };
  },

  determineDirection(_gaps: any, requestedDirection: string = "top"): string {
    const normalized = String(requestedDirection || "top").toLowerCase();
    if (normalized === "top" || normalized === "bottom" || normalized === "left" || normalized === "right") {
      return normalized;
    }
    return "top";
  },

  calculatePositions(textNode: TextNode, frameWidth: number, frameHeight: number) {
    const t = textNode.absoluteTransform;
    const x = t[0][2], y = t[1][2];
    const w = textNode.width, h = textNode.height;
    
    return {
      right: { x: x + w, y: y + h / 2 - frameHeight / 2 },
      left: { x: x - frameWidth, y: y + h / 2 - frameHeight / 2 },
      top: { x: x + w / 2 - frameWidth / 2, y: y - frameHeight },
      bottom: { x: x + w / 2 - frameWidth / 2, y: y + h }
    };
  }
};

function directionToSide(direction: string): "TOP" | "BOTTOM" | "LEFT" | "RIGHT" {
  const normalized = String(direction || "top").toLowerCase();
  if (normalized === "top") return "TOP";
  if (normalized === "bottom") return "BOTTOM";
  if (normalized === "left") return "LEFT";
  if (normalized === "right") return "RIGHT";
  return "TOP";
}

function sideToDirection(side: "TOP" | "BOTTOM" | "LEFT" | "RIGHT"): "top" | "bottom" | "left" | "right" {
  if (side === "TOP") return "top";
  if (side === "BOTTOM") return "bottom";
  if (side === "LEFT") return "left";
  return "right";
}

function resolvePlacementSide(direction: string, _textNode: TextNode): "TOP" | "BOTTOM" | "LEFT" | "RIGHT" {
  return directionToSide(direction);
}

function getRootAnnotationInstance(node: AnnotationNode): InstanceNode | null {
  if (node.type === "INSTANCE") return node;
  return node.findOne((n) => n.type === "INSTANCE") as InstanceNode | null;
}

// ==================== ANNOTATION SERVICES ====================

const AnnotationService = {
  async isTextNodeAnnotated(textNode: TextNode): Promise<{isAnnotated: boolean, keyName?: string, projectName?: string, uuid?: string, exist?: boolean, direction?: string}> {
    const annotationGroups = await NodeUtils.findLokaliseGroups();
    
    const existingAnnotation = annotationGroups.find(group => 
      group.getPluginData('targetId') === textNode.id
    );
    
    if (existingAnnotation) {
      const keyName =
        existingAnnotation.getPluginData("keyName") ||
        (existingAnnotation.findOne(n => n.type === "TEXT" && n.name === "keyName") as TextNode)?.characters ||
        "";
      const projectName =
        existingAnnotation.getPluginData("projectName") ||
        (existingAnnotation.findOne(n => n.type === "TEXT" && n.name === "projectName") as TextNode)?.characters ||
        "";
      const existFromPluginData = existingAnnotation.getPluginData("exist");
      const rootInstance = getRootAnnotationInstance(existingAnnotation);
      const exist =
        existFromPluginData === "true" ||
        (existFromPluginData !== "false" && rootInstance ? getInstanceExistValue(rootInstance) : false) ||
        ((existingAnnotation.findOne(n => n.type === "TEXT" && String(n.name || "").includes("Exist")) as TextNode | null)?.visible ?? false);
      const uuid = existingAnnotation.getPluginData('uuid') || existingAnnotation.name.match(/-(\d+)$/)?.[1] || "";
      const direction = existingAnnotation.getPluginData("direction") || "top";
      
      return {
        isAnnotated: true,
        keyName,
        projectName,
        uuid,
        exist,
        direction
      };
    }
    
    return {isAnnotated: false};
  },

  async realignGroup(group: AnnotationNode): Promise<void> {
    const textNodeId = group.getPluginData('targetId');
    const textNode = textNodeId ? await figma.getNodeByIdAsync(textNodeId) as TextNode : null;
    if (!textNode) return;

    const gaps = PositionUtils.calculateGaps(textNode);
    const direction = group.getPluginData("direction") || "top";
    const dir = PositionUtils.determineDirection(gaps, direction);
    const positions = PositionUtils.calculatePositions(textNode, group.width, group.height);

    const parent = group.parent;
    if (!parent || !("appendChild" in parent)) return;
    const containerOrigin = NodeUtils.getContainerAbsoluteOrigin(parent as AnnotationContainer);
    group.x = positions[dir].x - containerOrigin.x;
    group.y = positions[dir].y - containerOrigin.y;

    const instance = getRootAnnotationInstance(group);
    if (instance) {
      setPointer(instance, directionToSide(dir));
    }
    console.log("[realignGroup] group", group.name, "dir", dir, "pos", group.x, group.y);
  },

  async getAllAnnotationData() {
    const groups = await NodeUtils.findLokaliseGroups();
    return await Promise.all(groups.map(async group => {
      const uuid = NodeUtils.getAnnotationUuid(group);
      const projectName =
        group.getPluginData("projectName") ||
        (group.findOne(n => n.type === "TEXT" && n.name === "projectName") as TextNode)?.characters ||
        "";
      const keyName =
        group.getPluginData("keyName") ||
        (group.findOne(n => n.type === "TEXT" && n.name === "keyName") as TextNode)?.characters ||
        "";
      const existFromPluginData = group.getPluginData("exist");
      const rootInstance = getRootAnnotationInstance(group);
      const exist =
        existFromPluginData === "true" ||
        (existFromPluginData !== "false" && rootInstance ? getInstanceExistValue(rootInstance) : false) ||
        ((group.findOne(n => n.type === "TEXT" && String(n.name || "").includes("Exist")) as TextNode | null)?.visible ?? false);
      
      const targetId = group.getPluginData('targetId');
      let content = "";
      if (targetId) {
        const textNode = await figma.getNodeByIdAsync(targetId);
        if (textNode && textNode.type === "TEXT") {
          content = textNode.characters;
        }
      }
      return { uuid, projectName, keyName, content, exist };
    }));
  }
};

// ==================== ANNOTATION CREATION ====================

const AnnotationCreator = {
  async createAnnotation(
    textNode: TextNode,
    key: string,
    project: string,
    direction: string = "top",
    exist: boolean = false
  ): Promise<void> {
    if (!isBound) {
      figma.notify("Please bind a Lokalise Annotation component first.");
      return;
    }

    const component = await getAnnotationComponent();
    if (!component) {
      figma.notify("Unable to find the bound Lokalise Annotation component.");
      return;
    }

    const uuid = Date.now().toString();
    textNode.name = `annotation-${uuid}`;

    const instance = component.createInstance();
    const placementContainer = NodeUtils.getPlacementContainer(textNode);
    placementContainer.appendChild(instance);
    await applyProperties(instance, {
      project,
      exist,
      keyName: key
    });

    const side = resolvePlacementSide(direction, textNode);
    const finalDirection = sideToDirection(side);
    setPointer(instance, side);

    instance.name = `lokaliseAnnotation-${uuid}`;
    instance.setPluginData("targetId", textNode.id);
    instance.setPluginData("uuid", uuid);
    instance.setPluginData("direction", finalDirection);
    instance.setPluginData("keyName", key);
    instance.setPluginData("projectName", project);
    instance.setPluginData("exist", String(Boolean(exist)));
    instance.setPluginData("annotationType", "component");
    instance.setPluginData("componentKey", component.key);
    AnnotationIndexUtils.set(uuid, instance.id);

    const positions = PositionUtils.calculatePositions(textNode, instance.width, instance.height);
    const posDir = finalDirection;
    const containerOrigin = NodeUtils.getContainerAbsoluteOrigin(placementContainer);
    instance.x = positions[posDir].x - containerOrigin.x;
    instance.y = positions[posDir].y - containerOrigin.y;
    
    figma.currentPage.selection = [textNode];
    figma.notify('✅ Annotation added! Select more text to add again.');
  },

  createProjectFrame(project: string): FrameNode {
    const projectFrame = figma.createFrame();
    projectFrame.name = "project";
    projectFrame.layoutMode = "HORIZONTAL";
    projectFrame.primaryAxisSizingMode = "AUTO";
    projectFrame.counterAxisSizingMode = "AUTO";
    projectFrame.paddingLeft = projectFrame.paddingRight = 4;
    projectFrame.paddingTop = projectFrame.paddingBottom = 2;
    projectFrame.cornerRadius = 1;
    projectFrame.fills = [{ type: "SOLID", color: { r: 0.114, g: 0.306, b: 0.847 } }];
    projectFrame.primaryAxisAlignItems = "MIN";
    projectFrame.counterAxisAlignItems = "MIN";
    
    const projectText = figma.createText();
    projectText.name = "projectName";
    projectText.fontName = { family: "DM Mono", style: "Medium" };
    projectText.fontSize = 10;
    projectText.characters = project;
    projectText.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
    projectFrame.appendChild(projectText);
    
    return projectFrame;
  },

  createKeyContentFrame(key: string, content: string): FrameNode {
    const keyContentFrame = figma.createFrame();
    keyContentFrame.name = "key-content";
    keyContentFrame.layoutMode = "VERTICAL";
    keyContentFrame.primaryAxisSizingMode = "AUTO";
    keyContentFrame.counterAxisSizingMode = "AUTO";
    keyContentFrame.itemSpacing = 2;
    keyContentFrame.primaryAxisAlignItems = "MIN";
    keyContentFrame.counterAxisAlignItems = "MIN";
    
    const keyName = figma.createText();
    keyName.name = "keyName";
    keyName.fontName = { family: "DM Mono", style: "Medium" };
    keyName.fontSize = 12;
    keyName.characters = key;
    keyName.fills = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }];
    
    const contentText = figma.createText();
    contentText.name = "content";
    contentText.fontName = { family: "DM Mono", style: "Medium" };
    contentText.fontSize = 12;
    contentText.characters = content;
    contentText.fills = [{ type: "SOLID", color: { r: 0.5, g: 0.5, b: 0.5 } }];
    contentText.visible = false;
    
    keyContentFrame.appendChild(keyName);
    keyContentFrame.appendChild(contentText);
    
    return keyContentFrame;
  },

  createLabelFrame(projectFrame: FrameNode, keyContentFrame: FrameNode): FrameNode {
    const labelFrame = figma.createFrame();
    labelFrame.layoutMode = "HORIZONTAL";
    labelFrame.primaryAxisSizingMode = "AUTO";
    labelFrame.counterAxisSizingMode = "AUTO";
    labelFrame.paddingLeft = labelFrame.paddingRight = 8;
    labelFrame.paddingTop = labelFrame.paddingBottom = 6;
    labelFrame.cornerRadius = 2;
    labelFrame.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
    labelFrame.strokes = [{ type: "SOLID", color: { r: 0.114, g: 0.306, b: 0.847 } }];
    labelFrame.strokeWeight = 2;
    labelFrame.primaryAxisAlignItems = "CENTER";
    labelFrame.counterAxisAlignItems = "MIN";
    labelFrame.itemSpacing = 8;
    labelFrame.appendChild(projectFrame);
    labelFrame.appendChild(keyContentFrame);
    
    return labelFrame;
  },

  createAnnotationStructure(direction: string, gaps: any, labelFrame: FrameNode) {
    const circle = figma.createEllipse();
    circle.resize(6, 6);
    circle.fills = [{ type: 'SOLID', color: { r: 0.114, g: 0.306, b: 0.847 } }];
    circle.strokes = [];
    
    const labelPadding = 60;
    let lineLength = 60;
    
    const groupFrame = figma.createFrame();
    groupFrame.name = "text-naming-card";
    groupFrame.primaryAxisSizingMode = "AUTO";
    groupFrame.counterAxisSizingMode = "AUTO";
    groupFrame.itemSpacing = 0;
    groupFrame.fills = [];
    groupFrame.primaryAxisAlignItems = "CENTER";
    groupFrame.counterAxisAlignItems = "CENTER";

    const vector = figma.createVector();
    
    if (direction === "right") {
      groupFrame.layoutMode = "HORIZONTAL";
      lineLength = Math.max(gaps.right + labelPadding, 60);
      vector.resize(lineLength, 2);
      vector.vectorPaths = [{ data: `M 0 1 L ${lineLength} 1`, windingRule: "NONZERO" }];
      groupFrame.primaryAxisAlignItems = "MIN";
      groupFrame.appendChild(circle);
      groupFrame.appendChild(vector);
      groupFrame.appendChild(labelFrame);
    } else if (direction === "left") {
      groupFrame.layoutMode = "HORIZONTAL";
      lineLength = Math.max(gaps.left + labelPadding, 60);
      vector.resize(lineLength, 2);
      vector.vectorPaths = [{ data: `M ${lineLength} 1 L 0 1`, windingRule: "NONZERO" }];
      groupFrame.primaryAxisAlignItems = "MAX";
      groupFrame.appendChild(labelFrame);
      groupFrame.appendChild(vector);
      groupFrame.appendChild(circle);
    } else if (direction === "top") {
      groupFrame.layoutMode = "VERTICAL";
      lineLength = Math.max(gaps.top + labelPadding, 60);
      vector.resize(2, lineLength);
      vector.vectorPaths = [{ data: `M 1 0 L 1 ${lineLength}`, windingRule: "NONZERO" }];
      groupFrame.primaryAxisAlignItems = "CENTER";
      groupFrame.appendChild(labelFrame);
      groupFrame.appendChild(vector);
      groupFrame.appendChild(circle);
    } else {
      groupFrame.layoutMode = "VERTICAL";
      lineLength = Math.max(gaps.bottom + labelPadding, 60);
      vector.resize(2, lineLength);
      vector.vectorPaths = [{ data: `M 1 ${lineLength} L 1 0`, windingRule: "NONZERO" }];
      groupFrame.primaryAxisAlignItems = "CENTER";
      groupFrame.appendChild(circle);
      groupFrame.appendChild(vector);
      groupFrame.appendChild(labelFrame);
    }
    
    vector.strokeWeight = 2;
    vector.strokes = [{ type: 'SOLID', color: { r: 0.114, g: 0.306, b: 0.847 } }];
    vector.strokeCap = "NONE";
    vector.dashPattern = [4, 4];
    
    return { groupFrame, circle, vector };
  }
};

// ==================== COMMAND HANDLERS ====================

const CommandHandlers = {
  async handleAnnotateLokalise() {
    console.log("[annotate-lokalise] Start");

    await initBindingState();
    const projectOptions = await getBoundProjectOptions();
    postBindingInitState(projectOptions);

    const sendCurrentTextContent = async () => {
      postSelectionState();
      const sel = figma.currentPage.selection;
      if (sel.length === 1 && sel[0].type === "TEXT") {
        const textNode = sel[0] as TextNode;
        const content = textNode.characters;
        const annotationInfo = await AnnotationService.isTextNodeAnnotated(textNode);
        
        console.log("[annotate-lokalise] sendCurrentTextContent", content, "annotationInfo:", annotationInfo);
        figma.ui.postMessage({ 
          type: "content-result", 
          content, 
          ...annotationInfo
        });
      } else {
        figma.ui.postMessage({ type: "content-result", content: null, isAnnotated: false });
      }
    };

    await sendCurrentTextContent();
    figma.on("selectionchange", sendCurrentTextContent);
    figma.ui.postMessage({ type: "project-list", projects: projectOptions });
    console.log("[annotate-lokalise] Send project-list", projectOptions);
  },

  async handleGetLokaliseList() {
    console.log("[get-lokalise-list] Start");
    
    const data = await AnnotationService.getAllAnnotationData();
    console.log("[get-lokalise-list] Send lokalise-data", data);
    figma.ui.postMessage({ type: "lokalise-data", data });

    const projects = await getBoundProjectOptions();
    console.log("[get-lokalise-list] Send project-list", projects);
    figma.ui.postMessage({ type: "project-list", projects });
  },

  async handleRealign() {
    console.log("[realign] Start");
    
    const groups = await NodeUtils.findLokaliseGroups();
    
    let realignCount = 0, removedCount = 0;
    
    for (const group of groups) {
      const uuid = NodeUtils.getAnnotationUuid(group);
      const textNode = await figma.getNodeByIdAsync(group.getPluginData('targetId')) as TextNode | null;
      if (!textNode) {
        group.remove(); 
        if (uuid) AnnotationIndexUtils.remove(uuid);
        removedCount++; 
        continue;
      }
      
      await AnnotationService.realignGroup(group);
      realignCount++;
    }
    
    figma.closePlugin(`Re-aligned ${realignCount} annotations, removed ${removedCount} invalid annotations.`);
  }
};

// ==================== MESSAGE HANDLERS ====================

const MessageHandlers = {
  async handleGlobalMessages(msg: any) {
    if (msg.type === "save-projects") {
      // Deprecated: project values are now sourced from the bound component.
      figma.ui.postMessage({ type: "save-success" });
      figma.notify("Project list is now auto-synced from bound component.");
      console.log("[onmessage] Ignored save-projects; now auto-synced from bound component.");
      return true;
    }
    
    if (msg.type === "get-projects") {
      await initBindingState();
      const projects = await getBoundProjectOptions();
      figma.ui.postMessage({ type: "project-list", projects });
      console.log("[onmessage] Sent project-list:", projects);
      return true;
    }

    if (msg.type === "bind-component") {
      await handleBindComponentFlow();
      return true;
    }

    if (msg.type === "create-bind-component") {
      await handleCreateBindComponentFlow();
      return true;
    }

    if (msg.type === "unbind-component") {
      await handleUnbindComponentFlow();
      return true;
    }

    if (msg.type === "save-language-settings") {
      await StorageUtils.saveLanguageSettings(msg.languageSettings);
      figma.ui.postMessage({ type: "save-success" });
      figma.notify("Save successful!");
      console.log("[onmessage] Saved language settings:", msg.languageSettings);
      return true;
    }

    if (msg.type === "get-language-settings") {
      const languageSettings = await StorageUtils.getLanguageSettings();
      figma.ui.postMessage({ type: "language-settings", languageSettings });
      console.log("[onmessage] Sent language-settings", languageSettings);
      return true;
    }
    
    return false;
  },

  async handleAnnotateMessages(msg: any) {
    if (msg.type === "create-shapes") {
      if (!isBound) {
        figma.notify("Please bind a Lokalise Annotation component first.");
        const options = await getBoundProjectOptions();
        postBindingInitState(options);
        return;
      }

      const { key, project } = msg;
      const exist = Boolean(msg.exist);
      const sel = figma.currentPage.selection;
      if (!(sel.length === 1 && sel[0].type === "TEXT")) {
        figma.notify('Please select a single text node.');
        console.log("[create-shapes] Invalid selection", sel);
        return;
      }
      
      const node = sel[0] as TextNode;
      const direction = msg.direction || "top";
      
      await AnnotationCreator.createAnnotation(node, key, project, direction, exist);
      
      const boundProjects = await getBoundProjectOptions();
      figma.ui.postMessage({ type: "project-list", projects: boundProjects });
      console.log("[create-shapes] Created annotation for", { key, project, exist, direction });
      return;
    }

    if (msg.type === 'cancel') {
      figma.closePlugin();
      return;
    }

    if (msg.type === "update-annotation") {
      if (!isBound) {
        figma.notify("Please bind a Lokalise Annotation component first.");
        return;
      }

      const { uuid, key, project } = msg;
      const exist = Boolean(msg.exist);
      const group = await NodeUtils.findAnnotationByUuid(uuid);
      if (group) {
        const newDirection = msg.direction || "top";

        const instance = getRootAnnotationInstance(group);
        if (instance) {
          await applyProperties(instance, {
            project,
            exist,
            keyName: key
          });
          const targetNodeId = group.getPluginData("targetId");
          const targetNode = targetNodeId ? await figma.getNodeByIdAsync(targetNodeId) : null;
          if (targetNode && targetNode.type === "TEXT") {
            setPointer(instance, resolvePlacementSide(newDirection, targetNode));
          }
          group.setPluginData("direction", newDirection);
          group.setPluginData("projectName", project);
          group.setPluginData("keyName", key);
          group.setPluginData("exist", String(Boolean(exist)));
          await AnnotationService.realignGroup(group);
          figma.notify("Updated annotation successfully!");
          console.log("[update-annotation] Updated bound component annotation", { key, project, exist, uuid, direction: newDirection });
        } else {
          const currentDirection = group.getPluginData("direction") || "top";
          if (currentDirection !== newDirection) {
            const textNodeId = group.getPluginData("targetId");
            const textNode = textNodeId ? await figma.getNodeByIdAsync(textNodeId) as TextNode : null;
            if (textNode) {
              AnnotationIndexUtils.remove(uuid);
              group.remove();
              figma.currentPage.selection = [textNode];
              await AnnotationCreator.createAnnotation(textNode, key, project, newDirection, exist);
              figma.notify("Updated annotation with new positioning!");
              console.log("[update-annotation] Recreated annotation with new direction", { key, project, exist, uuid, direction: newDirection });
            }
          } else {
            await figma.loadFontAsync({ family: "DM Mono", style: "Medium" });
            (group.findOne(n => n.name === "projectName") as TextNode).characters = project;
            (group.findOne(n => n.name === "keyName") as TextNode).characters = key;
            const existText = group.findOne(n => n.type === "TEXT" && String(n.name || "").includes("Exist")) as TextNode | null;
            if (existText) existText.visible = exist;
            group.setPluginData("exist", String(Boolean(exist)));
            await AnnotationService.realignGroup(group);
            figma.notify("Updated annotation successfully!");
            console.log("[update-annotation] Updated annotation text only", { key, project, exist, uuid });
          }
        }
      } else {
        figma.notify('Cannot find the annotation to update.');
      }
      return;
    }
  },

  async handleListMessages(msg: any) {
    if (msg.type === "close-plugin") {
      figma.closePlugin();
      return;
    }

    if (msg.type === "update-row") {
      const applyRowUpdate = async (group: AnnotationNode) => {
        const instance = getRootAnnotationInstance(group);
        if (instance) {
          await applyProperties(instance, {
            project: msg.projectName,
            exist: false,
            keyName: msg.keyName
          });
          group.setPluginData("projectName", msg.projectName);
          group.setPluginData("keyName", msg.keyName);
        } else {
          await figma.loadFontAsync({ family: "DM Mono", style: "Medium" });
          (group.findOne(n => n.name === "projectName") as TextNode).characters = msg.projectName;
          (group.findOne(n => n.name === "keyName") as TextNode).characters = msg.keyName;
        }
        await AnnotationService.realignGroup(group);
      };

      if (msg.applyToSameKey) {
        const groups = await NodeUtils.findLokaliseGroups();
        const oldProjectName = String(msg.oldProjectName || "");
        const oldKeyName = String(msg.oldKeyName || "");
        const matched = groups.filter((group) => {
          const projectName =
            group.getPluginData("projectName") ||
            (group.findOne(n => n.type === "TEXT" && n.name === "projectName") as TextNode)?.characters ||
            "";
          const keyName =
            group.getPluginData("keyName") ||
            (group.findOne(n => n.type === "TEXT" && n.name === "keyName") as TextNode)?.characters ||
            "";
          return projectName === oldProjectName && keyName === oldKeyName;
        });

        const targets = matched.length > 0
          ? matched
          : [await NodeUtils.findAnnotationByUuid(msg.uuid)].filter(Boolean) as AnnotationNode[];
        for (const group of targets) {
          await applyRowUpdate(group);
        }
      } else {
        const group = await NodeUtils.findAnnotationByUuid(msg.uuid);
        if (group) {
          await applyRowUpdate(group);
        }
      }
      
      const data = await AnnotationService.getAllAnnotationData();
      figma.ui.postMessage({ type: "lokalise-data-updated", data });
      console.log("[get-lokalise-list] Updated row", msg.uuid, msg.projectName, msg.keyName);
      return;
    }

    if (msg.type === "locate-row") {
      const group = await NodeUtils.findAnnotationByUuid(msg.uuid);
      if (group) {
        figma.currentPage.selection = [group];
        figma.viewport.scrollAndZoomIntoView([group]);
        console.log("[get-lokalise-list] Located row", msg.uuid);
      }
      return;
    }

    if (msg.type === "delete-row") {
      const group = await NodeUtils.findAnnotationByUuid(msg.uuid);
      if (group) {
        AnnotationIndexUtils.remove(msg.uuid);
        group.remove();
      }
      
      const data = await AnnotationService.getAllAnnotationData();
      figma.ui.postMessage({ type: "lokalise-data-updated", data });
      console.log("[get-lokalise-list] Deleted row", msg.uuid);
      return;
    }
  }
};

// ==================== MAIN EXECUTION ====================

(async () => {
  if (figma.command) {
    UIManager.showByCommand(figma.command);
  }

  await initBindingState();

  // Handle specific commands
  if (figma.command === "annotate-lokalise") {
    await CommandHandlers.handleAnnotateLokalise();
  } else if (figma.command === "get-lokalise-list") {
    await CommandHandlers.handleGetLokaliseList();
  } else if (figma.command === "realign") {
    await CommandHandlers.handleRealign();
  }

  // Global message handler
  figma.ui.onmessage = async msg => {
    console.log("[onmessage] Received msg", msg, "command:", figma.command);

    // Handle global messages first
    const handled = await MessageHandlers.handleGlobalMessages(msg);
    if (handled) return;

    // Handle command-specific messages
    if (figma.command === "annotate-lokalise") {
      await MessageHandlers.handleAnnotateMessages(msg);
    } else if (figma.command === "get-lokalise-list") {
      await MessageHandlers.handleListMessages(msg);
    }
  };
})();
