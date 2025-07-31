// create by shouldwang
// with vibe coding

function showUIByCommand(command: string) {
  console.log("[showUIByCommand] command:", command);
  if (command === "annotate-lokalise") {
    figma.showUI(__uiFiles__.main, { width: 400, height: 600 });
  } else if (command === "get-lokalise-list") {
    figma.showUI(__uiFiles__.secondary, { width: 960, height: 480 });
  } else if (command === "project-setting") {
    figma.showUI(__uiFiles__.projectSetting, { width: 400, height: 280 });
  }
}

// Utility: find or cache the "📝 Annotations" main group on the current page
async function getMainGroup(): Promise<GroupNode | null> {
  const cachedId = figma.currentPage.getPluginData("mainGroupId");
  if (cachedId) {
    try {
      const node = await figma.getNodeByIdAsync(cachedId);
      if (node.type === "GROUP" && node.name === "📝 Annotations") {
        return node as GroupNode;
      }
    } catch {
      // invalid cache
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
}

// Utility: get the outermost frame ancestor of a node
function getOutermostFrame(node: SceneNode): FrameNode | null {
  let current: BaseNode | null = node;
  let outermost: FrameNode | null = null;
  while (current && current.parent && current.parent.type !== "PAGE") {
    if (current.parent.type === "FRAME") {
      outermost = current.parent as FrameNode;
    }
    current = current.parent as BaseNode;
  }
  return outermost;
}

(async () => {
  if (figma.command) {
    showUIByCommand(figma.command);
  }

  // === annotate-lokalise: send current selected text and project list ===
  if (figma.command === "annotate-lokalise") {
    console.log("[annotate-lokalise] Start");
    const selection = figma.currentPage.selection;
    if (selection.length !== 1 || selection[0].type !== "TEXT") {
      console.log("[annotate-lokalise] Invalid selection", selection);
      figma.closePlugin('Please select a single text node to annotate.');
      return;
    }

    function sendCurrentTextContent() {
      const sel = figma.currentPage.selection;
      const content = sel.length === 1 && sel[0].type === "TEXT"
        ? (sel[0] as TextNode).characters
        : null;
      console.log("[annotate-lokalise] sendCurrentTextContent", content);
      figma.ui.postMessage({ type: "content-result", content });
    }

    sendCurrentTextContent();
    figma.on("selectionchange", sendCurrentTextContent);

    // Send project list to UI
    (async () => {
      const storedProjects = (await figma.clientStorage.getAsync("lokaliseProjects")) || [];
      console.log("[annotate-lokalise] Send project-list", storedProjects);
      figma.ui.postMessage({ type: "project-list", projects: storedProjects });
    })();
  }

  // === get-lokalise-list: send all annotation data ===
  let findLokaliseGroups: (() => Promise<GroupNode[]>) | undefined;
  let realignGroup: ((group: GroupNode) => Promise<void>) | undefined;
  if (figma.command === "get-lokalise-list") {
    console.log("[get-lokalise-list] Start");
    findLokaliseGroups = async function() {
      const mainGroup = await getMainGroup();
      if (!mainGroup) return [];
      return mainGroup.children.filter(
        node => node.type === "GROUP" && /^lokaliseAnnotation-\d+$/.test(node.name)
      ) as GroupNode[];
    };
    realignGroup = async function(group: GroupNode) {
      const textNodeId = group.getPluginData('targetId');
      const textNode = textNodeId ? await figma.getNodeByIdAsync(textNodeId) as TextNode : null;
      if (!textNode) return;
      const frame = group.findOne(n => n.type === "FRAME" && n.name === "text-naming-card") as FrameNode;
      if (!frame) return;
      const t = textNode.absoluteTransform;
      const x = t[0][2], y = t[1][2];
      const w = textNode.width, h = textNode.height;
      const outer = getOutermostFrame(textNode);
      const leftBound = outer ? outer.absoluteTransform[0][2] : 0;
      const rightBound = outer ? leftBound + outer.width : figma.currentPage.width;
      const topBound = outer ? outer.absoluteTransform[1][2] : 0;
      const bottomBound = outer ? topBound + outer.height : figma.currentPage.height;
      const gaps = {
        left: x - leftBound,
        right: rightBound - (x + w),
        top: y - topBound,
        bottom: bottomBound - (y + h)
      };
      const direction = group.getPluginData("direction") || "auto";
      let dir: string;
      if (direction === "auto") {
        dir = (Object.entries(gaps).sort((a, b) => a[1] - b[1])[0][0]) as string;
      } else {
        dir = direction;
      }
      const positions: any = {
        right: { x: x + w, y: y + h / 2 - frame.height / 2 },
        left: { x: x - frame.width, y: y + h / 2 - frame.height / 2 },
        top: { x: x + w / 2 - frame.width / 2, y: y - frame.height },
        bottom: { x: x + w / 2 - frame.width / 2, y: y + h }
      };
      group.x = positions[dir].x;
      group.y = positions[dir].y;
      console.log("[realignGroup] group", group.name, "dir", dir, "pos", group.x, group.y);
    };

    (async () => {
      const groups = await findLokaliseGroups!();
      // 這裡改成 async 取得最新 text node 內容
      const data = await Promise.all(groups.map(async group => {
        const uuid = group.name.match(/-(\d+)$/)?.[1] || "";
        const projectName = (group.findOne(n => n.type === "TEXT" && n.name === "projectName") as TextNode).characters;
        const keyName = (group.findOne(n => n.type === "TEXT" && n.name === "keyName") as TextNode).characters;
        // 取得最新的 text node 內容
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
      console.log("[get-lokalise-list] Send lokalise-data", data);
      figma.ui.postMessage({ type: "lokalise-data", data });

      // Also send project list to get-list UI
      const storedProjects = (await figma.clientStorage.getAsync("lokaliseProjects")) || [];
      console.log("[get-lokalise-list] Send project-list", storedProjects);
      figma.ui.postMessage({ type: "project-list", projects: storedProjects });
    })();
  }

  // === realign: realign all annotations ===
  if (figma.command === "realign") {
    console.log("[realign] Start");
    function calcGaps(node: TextNode) {
      const t = node.absoluteTransform;
      const x = t[0][2], y = t[1][2];
      const outer = getOutermostFrame(node);
      const leftBound = outer ? outer.absoluteTransform[0][2] : 0;
      const rightBound = outer ? leftBound + outer.width : figma.currentPage.width;
      return {
        left: x - leftBound,
        right: rightBound - (x + node.width),
        top: y - (outer ? outer.absoluteTransform[1][2] : 0),
        bottom: (outer ? outer.absoluteTransform[1][2] + outer.height : figma.currentPage.height) - (y + node.height)
      };
    }

    const mainGroup = await getMainGroup();
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
      const uuid = group.getPluginData('uuid') || group.name.match(/-(\d+)$/)?.[1] || "";
      const textNode = await figma.getNodeByIdAsync(group.getPluginData('targetId')) as TextNode | null;
      if (!textNode) {
        group.remove(); removedCount++; continue;
      }
      const gaps = calcGaps(textNode);
      // 這裡修正：優先用 group 的 direction
      const direction = group.getPluginData("direction") || "auto";
      let dir: string;
      if (direction === "auto") {
        dir = (Object.entries(gaps).sort((a,b)=>a[1]-b[1])[0][0]) as string;
      } else {
        dir = direction;
      }
      const frame = group.findOne(n => n.type === "FRAME" && n.name === "text-naming-card") as FrameNode;
      const t = textNode.absoluteTransform;
      const x = t[0][2], y = t[1][2];
      const w = textNode.width, h = textNode.height;
      const positions: any = {
        right: { x: x + w, y: y + h/2 - frame.height/2 },
        left:  { x: x - frame.width, y: y + h/2 - frame.height/2 },
        top:   { x: x + w/2 - frame.width/2, y: y - frame.height },
        bottom:{ x: x + w/2 - frame.width/2, y: y + h }
      };
      group.x = positions[dir].x;
      group.y = positions[dir].y;
      realignCount++;
      console.log("[realign] group", group.name, "dir", dir, "pos", group.x, group.y);
    }
    figma.closePlugin(`Re-aligned ${realignCount} annotations, removed ${removedCount} invalid annotations.`);
  }

  // === Global onmessage handler ===
  figma.ui.onmessage = async msg => {
    console.log("[onmessage] Received msg", msg, "command:", figma.command);

    // --- Project Setting save/load ---
    if (msg.type === "save-projects") {
      // Support comma separated string or array
      let arr: string[] = [];
      if (Array.isArray(msg.projects)) {
        arr = msg.projects.map((s: string) => s.trim()).filter(Boolean);
      } else if (typeof msg.projects === "string") {
        arr = msg.projects.split(",").map((s: string) => s.trim()).filter(Boolean);
      }
      await figma.clientStorage.setAsync("lokaliseProjects", arr);
      figma.ui.postMessage({ type: "save-success" });
      figma.notify("Save successful!");
      console.log("[onmessage] Saved projects:", arr);
      return;
    }
    if (msg.type === "get-projects") {
      const projects = await figma.clientStorage.getAsync("lokaliseProjects") || [];
      figma.ui.postMessage({ type: "project-list", projects });
      console.log("[onmessage] Sent project-list:", projects);
      return;
    }

    // --- annotate-lokalise ---
    if (figma.command === "annotate-lokalise") {
      if (msg.type === "create-shapes") {
        const { key, project } = msg;
        const sel = figma.currentPage.selection;
        if (!(sel.length === 1 && sel[0].type === "TEXT")) {
          figma.notify('Please select a single text node.');
          console.log("[create-shapes] Invalid selection", sel);
          return;
        }
        const node = sel[0] as TextNode;
        await figma.loadFontAsync({ family: "DM Mono", style: "Medium" });

        const uuid = Date.now().toString();
        node.name = `annotation-${uuid}`;

        // --- Create project frame ---
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

        // --- Create key-content frame ---
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
        contentText.characters = node.characters;
        contentText.fills = [{ type: "SOLID", color: { r: 0.5, g: 0.5, b: 0.5 } }];
        contentText.visible = false;
        keyContentFrame.appendChild(keyName);
        keyContentFrame.appendChild(contentText);

        // --- Create labelFrame ---
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

        // --- Calculate gap and direction ---
        const abs = node.absoluteTransform;
        const x = abs[0][2], y = abs[1][2];
        const outerFrame = getOutermostFrame(node);
        const frameLeft = outerFrame ? outerFrame.absoluteTransform[0][2] : 0;
        const frameRight = outerFrame ? frameLeft + outerFrame.width : figma.currentPage.width;
        const gapLeft = x - frameLeft;
        const gapRight = frameRight - (x + node.width);
        const gapTop = y - (outerFrame ? outerFrame.absoluteTransform[1][2] : 0);
        const gapBottom = (outerFrame ? outerFrame.absoluteTransform[1][2] + outerFrame.height : figma.currentPage.height) - (y + node.height);
        // 取得 direction，預設 "auto"，UI 可傳入 msg.direction
        const direction = msg.direction || "auto";
        let minDir: string;
        if (direction === "auto") {
          const gaps = [
            { dir: "left", value: gapLeft },
            { dir: "right", value: gapRight },
            { dir: "top", value: gapTop },
            { dir: "bottom", value: gapBottom }
          ];
          gaps.sort((a, b) => a.value - b.value);
          minDir = gaps[0].dir as string;
        } else {
          minDir = direction;
        }

        const circle = figma.createEllipse();
        circle.resize(6, 6);
        circle.fills = [{ type: 'SOLID', color: { r: 0.114, g: 0.306, b: 0.847 } }];
        circle.strokes = [];
        const labelPadding = 60;
        let lineLength = 60;
        let groupFrame = figma.createFrame();
        groupFrame.name = "text-naming-card";
        groupFrame.primaryAxisSizingMode = "AUTO";
        groupFrame.counterAxisSizingMode = "AUTO";
        groupFrame.itemSpacing = 0;
        groupFrame.fills = [];
        groupFrame.primaryAxisAlignItems = "CENTER";
        groupFrame.counterAxisAlignItems = "CENTER";

        // Fix vectorPaths syntax
        const vector = figma.createVector();
        if (minDir === "right") {
          groupFrame.layoutMode = "HORIZONTAL";
          lineLength = Math.max(gapRight + labelPadding, 60);
          vector.resize(lineLength, 2);
          vector.vectorPaths = [{ data: `M 0 1 L ${lineLength} 1`, windingRule: "NONZERO" }];
        } else if (minDir === "left") {
          groupFrame.layoutMode = "HORIZONTAL";
          lineLength = Math.max(gapLeft + labelPadding, 60);
          vector.resize(lineLength, 2);
          vector.vectorPaths = [{ data: `M ${lineLength} 1 L 0 1`, windingRule: "NONZERO" }];
        } else if (minDir === "top") {
          groupFrame.layoutMode = "VERTICAL";
          lineLength = Math.max(gapTop + labelPadding, 60);
          vector.resize(2, lineLength);
          vector.vectorPaths = [{ data: `M 1 0 L 1 ${lineLength}`, windingRule: "NONZERO" }];
        } else {
          groupFrame.layoutMode = "VERTICAL";
          lineLength = Math.max(gapBottom + labelPadding, 60);
          vector.resize(2, lineLength);
          vector.vectorPaths = [{ data: `M 1 ${lineLength} L 1 0`, windingRule: "NONZERO" }];
        }
        vector.strokeWeight = 2;
        vector.strokes = [{ type: 'SOLID', color: { r: 0.114, g: 0.306, b: 0.847 } }];
        vector.strokeCap = "NONE";
        vector.dashPattern = [4, 4];

        if (minDir === "right") {
          groupFrame.primaryAxisAlignItems = "MIN";
          groupFrame.appendChild(circle);
          groupFrame.appendChild(vector);
          groupFrame.appendChild(labelFrame);
        } else if (minDir === "left") {
          groupFrame.primaryAxisAlignItems = "MAX";
          groupFrame.appendChild(labelFrame);
          groupFrame.appendChild(vector);
          groupFrame.appendChild(circle);
        } else if (minDir === "top") {
          groupFrame.primaryAxisAlignItems = "CENTER";
          groupFrame.appendChild(labelFrame);
          groupFrame.appendChild(vector);
          groupFrame.appendChild(circle);
        } else {
          groupFrame.primaryAxisAlignItems = "CENTER";
          groupFrame.appendChild(circle);
          groupFrame.appendChild(vector);
          groupFrame.appendChild(labelFrame);
        }

        // Positioning
        const groupXMap: any = {
          right: x + node.width,
          left: x - groupFrame.width,
          top: x + node.width / 2 - groupFrame.width / 2,
          bottom: x + node.width / 2 - groupFrame.width / 2
        };
        const groupYMap: any = {
          right: y + node.height / 2 - groupFrame.height / 2,
          left: y + node.height / 2 - groupFrame.height / 2,
          top: y - groupFrame.height,
          bottom: y + node.height
        };
        groupFrame.x = 0; groupFrame.y = 0;
        const wrapper = figma.group([groupFrame], figma.currentPage);
        wrapper.name = `lokaliseAnnotation-${uuid}`;
        wrapper.x = groupXMap[minDir];
        wrapper.y = groupYMap[minDir];
        wrapper.locked = true;
        wrapper.setPluginData("targetId", node.id);
        wrapper.setPluginData("uuid", uuid);
        wrapper.setPluginData("direction", direction); // <--- 新增這行，記錄方向

        // --- Find or create "📝 Annotations" main group ---
        let mainGroup = await getMainGroup();
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
        figma.currentPage.selection = [node, wrapper];
        figma.notify('Added annotation successfully! You can add more annotations by selecting text nodes and running the plugin again.');
        // Send latest project list to UI
        const storedProjects = (await figma.clientStorage.getAsync("lokaliseProjects")) || [];
        figma.ui.postMessage({ type: "project-list", projects: storedProjects });
        console.log("[create-shapes] Created annotation for", { key, project, uuid });
      }
      if (msg.type === 'cancel') {
        figma.closePlugin();
      }
    }

    // --- get-lokalise-list ---
    else if (figma.command === "get-lokalise-list") {
      if (!findLokaliseGroups) return;
      if (msg.type === "close-plugin") {
        figma.closePlugin();
      }
      if (msg.type === "update-row") {
        const mainGroup = await getMainGroup();
        if (!mainGroup) return;
        const group = mainGroup.children.find(g => g.name.endsWith(`-${msg.uuid}`)) as GroupNode;
        if (group) {
          await figma.loadFontAsync({ family: "DM Mono", style: "Medium" });
          (group.findOne(n => n.name === "projectName") as TextNode).characters = msg.projectName;
          (group.findOne(n => n.name === "keyName") as TextNode).characters = msg.keyName;
          if (realignGroup) await realignGroup(group);
        }
        const groups = await findLokaliseGroups();
        const data = await Promise.all(groups.map(async group => {
          const uuid = group.name.match(/-(\d+)$/)?.[1] || "";
          const projectName = (group.findOne(n => n.type === "TEXT" && n.name === "projectName") as TextNode).characters;
          const keyName = (group.findOne(n => n.type === "TEXT" && n.name === "keyName") as TextNode).characters;
          // 取得最新的 text node 內容
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
        figma.ui.postMessage({ type: "lokalise-data-updated", data });
        console.log("[get-lokalise-list] Updated row", msg.uuid, msg.projectName, msg.keyName);
      }
      if (msg.type === "locate-row") {
        const mainGroup = await getMainGroup();
        if (!mainGroup) return;
        const group = mainGroup.children.find(g => g.name.endsWith(`-${msg.uuid}`));
        if (group) {
          figma.currentPage.selection = [group];
          figma.viewport.scrollAndZoomIntoView([group]);
          console.log("[get-lokalise-list] Located row", msg.uuid);
        }
      }
      if (msg.type === "delete-row") {
        const mainGroup = await getMainGroup();
        if (!mainGroup) return;
        const group = mainGroup.children.find(g => g.name.endsWith(`-${msg.uuid}`)) as GroupNode;
        if (group) group.remove();
        const groups = await findLokaliseGroups();
        const data = await Promise.all(groups.map(async group => {
          const uuid = group.name.match(/-(\d+)$/)?.[1] || "";
          const projectName = (group.findOne(n => n.type === "TEXT" && n.name === "projectName") as TextNode).characters;
          const keyName = (group.findOne(n => n.type === "TEXT" && n.name === "keyName") as TextNode).characters;
          // 取得最新的 text node 內容
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
        figma.ui.postMessage({ type: "lokalise-data-updated", data });
        console.log("[get-lokalise-list] Deleted row", msg.uuid);
      }
    }

    // --- project-setting ---
    else if (figma.command === "project-setting") {
      if (msg.type === "close-plugin") {
        figma.closePlugin();
      }
      // 其餘儲存/讀取已在全域分發處理
    }
  };
})();
