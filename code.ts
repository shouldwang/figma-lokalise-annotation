// create by shouldwang
// with vibe coding

// ==================== UTILITIES ====================

// UI Management
const UIManager = {
  showByCommand(command: string) {
    console.log("[showUIByCommand] command:", command);
    if (command === "annotate-lokalise") {
      figma.showUI(__uiFiles__.main, { width: 400, height: 600 });
    } else if (command === "get-lokalise-list") {
      figma.showUI(__uiFiles__.secondary, { width: 400, height: 600 });
    } else if (command === "project-setting") {
      figma.showUI(__uiFiles__.projectSetting, { width: 400, height: 600 });
    }
  }
};

// Node utilities
const NodeUtils = {
  // Find or cache the "📝 Annotations" main group on the current page
  async getMainGroup(): Promise<GroupNode | null> {
    const cachedId = figma.currentPage.getPluginData("mainGroupId");
    if (cachedId) {
      try {
        const node = await figma.getNodeByIdAsync(cachedId);
        if (node.type === "GROUP" && node.name === "📝 Annotations") {
          return node as GroupNode;
        }
      } catch {
        console.log("[getMainGroup] Invalid cached mainGroupId:", cachedId);
      }
    }
    for (const node of figma.currentPage.children) {
      if (node.type === "GROUP" && node.name === "📝 Annotations") {
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

  // Find all lokalise annotation groups
  async findLokaliseGroups(): Promise<GroupNode[]> {
    const mainGroup = await this.getMainGroup();
    if (!mainGroup) return [];
    return mainGroup.children.filter(
      node => node.type === "GROUP" && /^lokaliseAnnotation-\d+$/.test(node.name)
    ) as GroupNode[];
  }
};

// Storage utilities
const StorageUtils = {
  async getProjects(): Promise<string[]> {
    return (await figma.clientStorage.getAsync("lokaliseProjects")) || [];
  },

  async saveProjects(projects: string[] | string): Promise<void> {
    let arr: string[] = [];
    if (Array.isArray(projects)) {
      arr = projects.map((s: string) => s.trim()).filter(Boolean);
    } else if (typeof projects === "string") {
      arr = projects.split(",").map((s: string) => s.trim()).filter(Boolean);
    }
    await figma.clientStorage.setAsync("lokaliseProjects", arr);
  }
};

// Position calculation utilities
const PositionUtils = {
  calculateGaps(textNode: TextNode) {
    const t = textNode.absoluteTransform;
    const x = t[0][2], y = t[1][2];
    const w = textNode.width, h = textNode.height;
    const outer = NodeUtils.getOutermostFrame(textNode);
    const leftBound = outer ? outer.absoluteTransform[0][2] : 0;
    const rightBound = outer ? leftBound + outer.width : figma.currentPage.width;
    const topBound = outer ? outer.absoluteTransform[1][2] : 0;
    const bottomBound = outer ? topBound + outer.height : figma.currentPage.height;
    
    return {
      left: x - leftBound,
      right: rightBound - (x + w),
      top: y - topBound,
      bottom: bottomBound - (y + h)
    };
  },

  determineDirection(gaps: any, requestedDirection: string = "auto"): string {
    if (requestedDirection === "auto") {
      return (Object.entries(gaps).sort((a, b) => (a[1] as number) - (b[1] as number))[0][0]) as string;
    }
    return requestedDirection;
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

// ==================== ANNOTATION SERVICES ====================

const AnnotationService = {
  async isTextNodeAnnotated(textNode: TextNode): Promise<{isAnnotated: boolean, keyName?: string, projectName?: string, uuid?: string}> {
    const mainGroup = await NodeUtils.getMainGroup();
    if (!mainGroup) return {isAnnotated: false};
    
    const annotationGroups = mainGroup.children.filter(
      node => node.type === "GROUP" && /^lokaliseAnnotation-\d+$/.test(node.name)
    ) as GroupNode[];
    
    const existingAnnotation = annotationGroups.find(group => 
      group.getPluginData('targetId') === textNode.id
    );
    
    if (existingAnnotation) {
      const keyName = (existingAnnotation.findOne(n => n.type === "TEXT" && n.name === "keyName") as TextNode)?.characters || "";
      const projectName = (existingAnnotation.findOne(n => n.type === "TEXT" && n.name === "projectName") as TextNode)?.characters || "";
      const uuid = existingAnnotation.getPluginData('uuid') || existingAnnotation.name.match(/-(\d+)$/)?.[1] || "";
      
      return {
        isAnnotated: true,
        keyName,
        projectName,
        uuid
      };
    }
    
    return {isAnnotated: false};
  },

  async realignGroup(group: GroupNode): Promise<void> {
    const textNodeId = group.getPluginData('targetId');
    const textNode = textNodeId ? await figma.getNodeByIdAsync(textNodeId) as TextNode : null;
    if (!textNode) return;
    
    const frame = group.findOne(n => n.type === "FRAME" && n.name === "text-naming-card") as FrameNode;
    if (!frame) return;
    
    const gaps = PositionUtils.calculateGaps(textNode);
    const direction = group.getPluginData("direction") || "auto";
    const dir = PositionUtils.determineDirection(gaps, direction);
    const positions = PositionUtils.calculatePositions(textNode, frame.width, frame.height);
    
    group.x = positions[dir].x;
    group.y = positions[dir].y;
    console.log("[realignGroup] group", group.name, "dir", dir, "pos", group.x, group.y);
  },

  async getAllAnnotationData() {
    const groups = await NodeUtils.findLokaliseGroups();
    return await Promise.all(groups.map(async group => {
      const uuid = group.name.match(/-(\d+)$/)?.[1] || "";
      const projectName = (group.findOne(n => n.type === "TEXT" && n.name === "projectName") as TextNode).characters;
      const keyName = (group.findOne(n => n.type === "TEXT" && n.name === "keyName") as TextNode).characters;
      
      const targetId = group.getPluginData('targetId');
      let content = "";
      if (targetId) {
        const textNode = await figma.getNodeByIdAsync(targetId);
        if (textNode && textNode.type === "TEXT") {
          content = textNode.characters;
        }
      }
      return { uuid, projectName, keyName, content };
    }));
  }
};

// ==================== ANNOTATION CREATION ====================

const AnnotationCreator = {
  async createAnnotation(textNode: TextNode, key: string, project: string, direction: string = "auto"): Promise<void> {
    await figma.loadFontAsync({ family: "DM Mono", style: "Medium" });

    const uuid = Date.now().toString();
    textNode.name = `annotation-${uuid}`;

    // Create components
    const projectFrame = this.createProjectFrame(project);
    const keyContentFrame = this.createKeyContentFrame(key, textNode.characters);
    const labelFrame = this.createLabelFrame(projectFrame, keyContentFrame);
    
    // Calculate positioning
    const gaps = PositionUtils.calculateGaps(textNode);
    const minDir = PositionUtils.determineDirection(gaps, direction);
    
    // Create annotation structure
    const { groupFrame, circle, vector } = this.createAnnotationStructure(minDir, gaps, labelFrame);
    
    // Position and finalize
    const wrapper = figma.group([groupFrame], figma.currentPage);
    wrapper.name = `lokaliseAnnotation-${uuid}`;
    wrapper.locked = true;
    wrapper.setPluginData("targetId", textNode.id);
    wrapper.setPluginData("uuid", uuid);
    wrapper.setPluginData("direction", direction);

    // Position the wrapper
    const positions = PositionUtils.calculatePositions(textNode, groupFrame.width, groupFrame.height);
    wrapper.x = positions[minDir].x;
    wrapper.y = positions[minDir].y;

    // Add to main group
    await this.addToMainGroup(wrapper);
    
    figma.currentPage.selection = [textNode, wrapper];
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
  },

  async addToMainGroup(wrapper: GroupNode): Promise<void> {
    let mainGroup = await NodeUtils.getMainGroup();
    if (!mainGroup) {
      mainGroup = figma.group([wrapper], figma.currentPage);
      mainGroup.name = "📝 Annotations";
      mainGroup.locked = true;
      figma.currentPage.setPluginData("mainGroupId", mainGroup.id);
    } else {
      mainGroup.locked = false;
      mainGroup.appendChild(wrapper);
      mainGroup.locked = true;
    }
    figma.currentPage.appendChild(mainGroup);
  }
};

// ==================== COMMAND HANDLERS ====================

const CommandHandlers = {
  async handleAnnotateLokalise() {
    console.log("[annotate-lokalise] Start");
    const selection = figma.currentPage.selection;
    if (selection.length !== 1 || selection[0].type !== "TEXT") {
      console.log("[annotate-lokalise] Invalid selection", selection);
      figma.closePlugin('Please select a single text node to annotate.');
      return;
    }

    const sendCurrentTextContent = async () => {
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

    sendCurrentTextContent();
    figma.on("selectionchange", sendCurrentTextContent);

    const storedProjects = await StorageUtils.getProjects();
    console.log("[annotate-lokalise] Send project-list", storedProjects);
    figma.ui.postMessage({ type: "project-list", projects: storedProjects });
  },

  async handleGetLokaliseList() {
    console.log("[get-lokalise-list] Start");
    
    const data = await AnnotationService.getAllAnnotationData();
    console.log("[get-lokalise-list] Send lokalise-data", data);
    figma.ui.postMessage({ type: "lokalise-data", data });

    const storedProjects = await StorageUtils.getProjects();
    console.log("[get-lokalise-list] Send project-list", storedProjects);
    figma.ui.postMessage({ type: "project-list", projects: storedProjects });
  },

  async handleRealign() {
    console.log("[realign] Start");
    
    const mainGroup = await NodeUtils.getMainGroup();
    if (!mainGroup) {
      console.log("[realign] No main group found");
      figma.closePlugin("Can't find the main group for annotations.");
      return;
    }
    
    const groups = mainGroup.children.filter(
      node => node.type === "GROUP" && /^lokaliseAnnotation-\d+$/.test(node.name)
    ) as GroupNode[];
    
    let realignCount = 0, removedCount = 0;
    
    for (const group of groups) {
      const textNode = await figma.getNodeByIdAsync(group.getPluginData('targetId')) as TextNode | null;
      if (!textNode) {
        group.remove(); 
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
      await StorageUtils.saveProjects(msg.projects);
      figma.ui.postMessage({ type: "save-success" });
      figma.notify("Save successful!");
      console.log("[onmessage] Saved projects:", msg.projects);
      return true;
    }
    
    if (msg.type === "get-projects") {
      const projects = await StorageUtils.getProjects();
      figma.ui.postMessage({ type: "project-list", projects });
      console.log("[onmessage] Sent project-list:", projects);
      return true;
    }
    
    return false;
  },

  async handleAnnotateMessages(msg: any) {
    if (msg.type === "create-shapes") {
      const { key, project } = msg;
      const sel = figma.currentPage.selection;
      if (!(sel.length === 1 && sel[0].type === "TEXT")) {
        figma.notify('Please select a single text node.');
        console.log("[create-shapes] Invalid selection", sel);
        return;
      }
      
      const node = sel[0] as TextNode;
      const direction = msg.direction || "auto";
      
      await AnnotationCreator.createAnnotation(node, key, project, direction);
      
      const storedProjects = await StorageUtils.getProjects();
      figma.ui.postMessage({ type: "project-list", projects: storedProjects });
      console.log("[create-shapes] Created annotation for", { key, project, direction });
      return;
    }

    if (msg.type === 'cancel') {
      figma.closePlugin();
      return;
    }

    if (msg.type === "update-annotation") {
      const { uuid, key, project } = msg;
      const mainGroup = await NodeUtils.getMainGroup();
      if (!mainGroup) return;
      
      const group = mainGroup.children.find(g => g.name.endsWith(`-${uuid}`)) as GroupNode;
      if (group) {
        const currentDirection = group.getPluginData("direction") || "auto";
        const newDirection = msg.direction || "auto";
        
        if (currentDirection !== newDirection) {
          // Direction changed - recreate annotation
          const textNodeId = group.getPluginData('targetId');
          const textNode = textNodeId ? await figma.getNodeByIdAsync(textNodeId) as TextNode : null;
          
          if (textNode) {
            group.remove();
            figma.currentPage.selection = [textNode];
            await AnnotationCreator.createAnnotation(textNode, key, project, newDirection);
            figma.notify('Updated annotation with new positioning!');
            console.log("[update-annotation] Recreated annotation with new direction", { key, project, uuid, direction: newDirection });
          }
        } else {
          // Direction unchanged - update text and realign
          await figma.loadFontAsync({ family: "DM Mono", style: "Medium" });
          
          (group.findOne(n => n.name === "projectName") as TextNode).characters = project;
          (group.findOne(n => n.name === "keyName") as TextNode).characters = key;
          
          await AnnotationService.realignGroup(group);
          
          figma.notify('Updated annotation successfully!');
          console.log("[update-annotation] Updated annotation text only", { key, project, uuid });
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
      const mainGroup = await NodeUtils.getMainGroup();
      if (!mainGroup) return;
      
      const group = mainGroup.children.find(g => g.name.endsWith(`-${msg.uuid}`)) as GroupNode;
      if (group) {
        await figma.loadFontAsync({ family: "DM Mono", style: "Medium" });
        (group.findOne(n => n.name === "projectName") as TextNode).characters = msg.projectName;
        (group.findOne(n => n.name === "keyName") as TextNode).characters = msg.keyName;
        await AnnotationService.realignGroup(group);
      }
      
      const data = await AnnotationService.getAllAnnotationData();
      figma.ui.postMessage({ type: "lokalise-data-updated", data });
      console.log("[get-lokalise-list] Updated row", msg.uuid, msg.projectName, msg.keyName);
      return;
    }

    if (msg.type === "locate-row") {
      const mainGroup = await NodeUtils.getMainGroup();
      if (!mainGroup) return;
      
      const group = mainGroup.children.find(g => g.name.endsWith(`-${msg.uuid}`));
      if (group) {
        figma.currentPage.selection = [group];
        figma.viewport.scrollAndZoomIntoView([group]);
        console.log("[get-lokalise-list] Located row", msg.uuid);
      }
      return;
    }

    if (msg.type === "delete-row") {
      const mainGroup = await NodeUtils.getMainGroup();
      if (!mainGroup) return;
      
      const group = mainGroup.children.find(g => g.name.endsWith(`-${msg.uuid}`)) as GroupNode;
      if (group) group.remove();
      
      const data = await AnnotationService.getAllAnnotationData();
      figma.ui.postMessage({ type: "lokalise-data-updated", data });
      console.log("[get-lokalise-list] Deleted row", msg.uuid);
      return;
    }
  },

  async handleProjectSettingMessages(msg: any) {
    if (msg.type === "close-plugin") {
      figma.closePlugin();
      return;
    }
  }
};

// ==================== MAIN EXECUTION ====================

(async () => {
  if (figma.command) {
    UIManager.showByCommand(figma.command);
  }

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
    } else if (figma.command === "project-setting") {
      await MessageHandlers.handleProjectSettingMessages(msg);
    }
  };
})();
              