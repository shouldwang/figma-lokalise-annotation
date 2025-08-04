"use strict";
// create by shouldwang
// with vibe coding
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
// ==================== UTILITIES ====================
// UI Management
const UIManager = {
    showByCommand(command) {
        console.log("[showUIByCommand] command:", command);
        if (command === "annotate-lokalise") {
            figma.showUI(__uiFiles__.main, { width: 400, height: 640 });
        }
        else if (command === "get-lokalise-list") {
            figma.showUI(__uiFiles__.secondary, { width: 400, height: 640 });
        }
        else if (command === "project-setting") {
            figma.showUI(__uiFiles__.projectSetting, { width: 400, height: 640 });
        }
    }
};
// Node utilities
const NodeUtils = {
    // Find or cache the "📝 Annotations" main group on the current page
    getMainGroup() {
        return __awaiter(this, void 0, void 0, function* () {
            const cachedId = figma.currentPage.getPluginData("mainGroupId");
            if (cachedId) {
                try {
                    const node = yield figma.getNodeByIdAsync(cachedId);
                    if (node.type === "GROUP" && node.name === "📝 Annotations") {
                        return node;
                    }
                }
                catch (_a) {
                    console.log("[getMainGroup] Invalid cached mainGroupId:", cachedId);
                }
            }
            for (const node of figma.currentPage.children) {
                if (node.type === "GROUP" && node.name === "📝 Annotations") {
                    figma.currentPage.setPluginData("mainGroupId", node.id);
                    return node;
                }
            }
            return null;
        });
    },
    // Get the outermost frame ancestor of a node
    getOutermostFrame(node) {
        let current = node;
        let outermost = null;
        while (current && current.parent && current.parent.type !== "PAGE") {
            if (current.parent.type === "FRAME") {
                outermost = current.parent;
            }
            current = current.parent;
        }
        return outermost;
    },
    // Find all lokalise annotation groups
    findLokaliseGroups() {
        return __awaiter(this, void 0, void 0, function* () {
            const mainGroup = yield this.getMainGroup();
            if (!mainGroup)
                return [];
            return mainGroup.children.filter(node => node.type === "GROUP" && /^lokaliseAnnotation-\d+$/.test(node.name));
        });
    }
};
// Storage utilities
const StorageUtils = {
    getProjects() {
        return __awaiter(this, void 0, void 0, function* () {
            return (yield figma.clientStorage.getAsync("lokaliseProjects")) || [];
        });
    },
    saveProjects(projects) {
        return __awaiter(this, void 0, void 0, function* () {
            let arr = [];
            if (Array.isArray(projects)) {
                arr = projects.map((s) => s.trim()).filter(Boolean);
            }
            else if (typeof projects === "string") {
                arr = projects.split(",").map((s) => s.trim()).filter(Boolean);
            }
            yield figma.clientStorage.setAsync("lokaliseProjects", arr);
        });
    },
    getLanguageSettings() {
        return __awaiter(this, void 0, void 0, function* () {
            return (yield figma.clientStorage.getAsync("languageSettings")) || {
                baseLanguage: { code: 'en', name: 'English' },
                supportedLanguages: []
            };
        });
    },
    saveLanguageSettings(languageSettings) {
        return __awaiter(this, void 0, void 0, function* () {
            yield figma.clientStorage.setAsync("languageSettings", languageSettings);
        });
    }
};
// Position calculation utilities
const PositionUtils = {
    calculateGaps(textNode) {
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
    determineDirection(gaps, requestedDirection = "auto") {
        if (requestedDirection === "auto") {
            return (Object.entries(gaps).sort((a, b) => a[1] - b[1])[0][0]);
        }
        return requestedDirection;
    },
    calculatePositions(textNode, frameWidth, frameHeight) {
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
    isTextNodeAnnotated(textNode) {
        var _a, _b, _c;
        return __awaiter(this, void 0, void 0, function* () {
            const mainGroup = yield NodeUtils.getMainGroup();
            if (!mainGroup)
                return { isAnnotated: false };
            const annotationGroups = mainGroup.children.filter(node => node.type === "GROUP" && /^lokaliseAnnotation-\d+$/.test(node.name));
            const existingAnnotation = annotationGroups.find(group => group.getPluginData('targetId') === textNode.id);
            if (existingAnnotation) {
                const keyName = ((_a = existingAnnotation.findOne(n => n.type === "TEXT" && n.name === "keyName")) === null || _a === void 0 ? void 0 : _a.characters) || "";
                const projectName = ((_b = existingAnnotation.findOne(n => n.type === "TEXT" && n.name === "projectName")) === null || _b === void 0 ? void 0 : _b.characters) || "";
                const uuid = existingAnnotation.getPluginData('uuid') || ((_c = existingAnnotation.name.match(/-(\d+)$/)) === null || _c === void 0 ? void 0 : _c[1]) || "";
                return {
                    isAnnotated: true,
                    keyName,
                    projectName,
                    uuid
                };
            }
            return { isAnnotated: false };
        });
    },
    realignGroup(group) {
        return __awaiter(this, void 0, void 0, function* () {
            const textNodeId = group.getPluginData('targetId');
            const textNode = textNodeId ? yield figma.getNodeByIdAsync(textNodeId) : null;
            if (!textNode)
                return;
            const frame = group.findOne(n => n.type === "FRAME" && n.name === "text-naming-card");
            if (!frame)
                return;
            const gaps = PositionUtils.calculateGaps(textNode);
            const direction = group.getPluginData("direction") || "auto";
            const dir = PositionUtils.determineDirection(gaps, direction);
            const positions = PositionUtils.calculatePositions(textNode, frame.width, frame.height);
            group.x = positions[dir].x;
            group.y = positions[dir].y;
            console.log("[realignGroup] group", group.name, "dir", dir, "pos", group.x, group.y);
        });
    },
    getAllAnnotationData() {
        return __awaiter(this, void 0, void 0, function* () {
            const groups = yield NodeUtils.findLokaliseGroups();
            return yield Promise.all(groups.map((group) => __awaiter(this, void 0, void 0, function* () {
                var _a;
                const uuid = ((_a = group.name.match(/-(\d+)$/)) === null || _a === void 0 ? void 0 : _a[1]) || "";
                const projectName = group.findOne(n => n.type === "TEXT" && n.name === "projectName").characters;
                const keyName = group.findOne(n => n.type === "TEXT" && n.name === "keyName").characters;
                const targetId = group.getPluginData('targetId');
                let content = "";
                if (targetId) {
                    const textNode = yield figma.getNodeByIdAsync(targetId);
                    if (textNode && textNode.type === "TEXT") {
                        content = textNode.characters;
                    }
                }
                return { uuid, projectName, keyName, content };
            })));
        });
    }
};
// ==================== ANNOTATION CREATION ====================
const AnnotationCreator = {
    createAnnotation(textNode, key, project, direction = "auto") {
        return __awaiter(this, void 0, void 0, function* () {
            yield figma.loadFontAsync({ family: "DM Mono", style: "Medium" });
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
            yield this.addToMainGroup(wrapper);
            figma.currentPage.selection = [textNode, wrapper];
            figma.notify('✅ Annotation added! Select more text to add again.');
        });
    },
    createProjectFrame(project) {
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
    createKeyContentFrame(key, content) {
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
    createLabelFrame(projectFrame, keyContentFrame) {
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
    createAnnotationStructure(direction, gaps, labelFrame) {
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
        }
        else if (direction === "left") {
            groupFrame.layoutMode = "HORIZONTAL";
            lineLength = Math.max(gaps.left + labelPadding, 60);
            vector.resize(lineLength, 2);
            vector.vectorPaths = [{ data: `M ${lineLength} 1 L 0 1`, windingRule: "NONZERO" }];
            groupFrame.primaryAxisAlignItems = "MAX";
            groupFrame.appendChild(labelFrame);
            groupFrame.appendChild(vector);
            groupFrame.appendChild(circle);
        }
        else if (direction === "top") {
            groupFrame.layoutMode = "VERTICAL";
            lineLength = Math.max(gaps.top + labelPadding, 60);
            vector.resize(2, lineLength);
            vector.vectorPaths = [{ data: `M 1 0 L 1 ${lineLength}`, windingRule: "NONZERO" }];
            groupFrame.primaryAxisAlignItems = "CENTER";
            groupFrame.appendChild(labelFrame);
            groupFrame.appendChild(vector);
            groupFrame.appendChild(circle);
        }
        else {
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
    addToMainGroup(wrapper) {
        return __awaiter(this, void 0, void 0, function* () {
            let mainGroup = yield NodeUtils.getMainGroup();
            if (!mainGroup) {
                mainGroup = figma.group([wrapper], figma.currentPage);
                mainGroup.name = "📝 Annotations";
                mainGroup.locked = true;
                figma.currentPage.setPluginData("mainGroupId", mainGroup.id);
            }
            else {
                mainGroup.locked = false;
                mainGroup.appendChild(wrapper);
                mainGroup.locked = true;
            }
            figma.currentPage.appendChild(mainGroup);
        });
    }
};
// ==================== COMMAND HANDLERS ====================
const CommandHandlers = {
    handleAnnotateLokalise() {
        return __awaiter(this, void 0, void 0, function* () {
            console.log("[annotate-lokalise] Start");
            const selection = figma.currentPage.selection;
            if (selection.length !== 1 || selection[0].type !== "TEXT") {
                console.log("[annotate-lokalise] Invalid selection", selection);
                figma.closePlugin('Please select a single text node to annotate.');
                return;
            }
            const sendCurrentTextContent = () => __awaiter(this, void 0, void 0, function* () {
                const sel = figma.currentPage.selection;
                if (sel.length === 1 && sel[0].type === "TEXT") {
                    const textNode = sel[0];
                    const content = textNode.characters;
                    const annotationInfo = yield AnnotationService.isTextNodeAnnotated(textNode);
                    console.log("[annotate-lokalise] sendCurrentTextContent", content, "annotationInfo:", annotationInfo);
                    figma.ui.postMessage(Object.assign({ type: "content-result", content }, annotationInfo));
                }
                else {
                    figma.ui.postMessage({ type: "content-result", content: null, isAnnotated: false });
                }
            });
            sendCurrentTextContent();
            figma.on("selectionchange", sendCurrentTextContent);
            const storedProjects = yield StorageUtils.getProjects();
            console.log("[annotate-lokalise] Send project-list", storedProjects);
            figma.ui.postMessage({ type: "project-list", projects: storedProjects });
        });
    },
    handleGetLokaliseList() {
        return __awaiter(this, void 0, void 0, function* () {
            console.log("[get-lokalise-list] Start");
            const data = yield AnnotationService.getAllAnnotationData();
            console.log("[get-lokalise-list] Send lokalise-data", data);
            figma.ui.postMessage({ type: "lokalise-data", data });
            const storedProjects = yield StorageUtils.getProjects();
            console.log("[get-lokalise-list] Send project-list", storedProjects);
            figma.ui.postMessage({ type: "project-list", projects: storedProjects });
        });
    },
    handleRealign() {
        return __awaiter(this, void 0, void 0, function* () {
            console.log("[realign] Start");
            const mainGroup = yield NodeUtils.getMainGroup();
            if (!mainGroup) {
                console.log("[realign] No main group found");
                figma.closePlugin("Can't find the main group for annotations.");
                return;
            }
            const groups = mainGroup.children.filter(node => node.type === "GROUP" && /^lokaliseAnnotation-\d+$/.test(node.name));
            let realignCount = 0, removedCount = 0;
            for (const group of groups) {
                const textNode = yield figma.getNodeByIdAsync(group.getPluginData('targetId'));
                if (!textNode) {
                    group.remove();
                    removedCount++;
                    continue;
                }
                yield AnnotationService.realignGroup(group);
                realignCount++;
            }
            figma.closePlugin(`Re-aligned ${realignCount} annotations, removed ${removedCount} invalid annotations.`);
        });
    }
};
// ==================== MESSAGE HANDLERS ====================
const MessageHandlers = {
    handleGlobalMessages(msg) {
        return __awaiter(this, void 0, void 0, function* () {
            if (msg.type === "save-projects") {
                yield StorageUtils.saveProjects(msg.projects);
                figma.ui.postMessage({ type: "save-success" });
                figma.notify("Save successful!");
                console.log("[onmessage] Saved projects:", msg.projects);
                return true;
            }
            if (msg.type === "get-projects") {
                const projects = yield StorageUtils.getProjects();
                figma.ui.postMessage({ type: "project-list", projects });
                console.log("[onmessage] Sent project-list:", projects);
                return true;
            }
            if (msg.type === "save-language-settings") {
                yield StorageUtils.saveLanguageSettings(msg.languageSettings);
                console.log("[onmessage] Saved language settings:", msg.languageSettings);
                return true;
            }
            if (msg.type === "get-language-settings") {
                const languageSettings = yield StorageUtils.getLanguageSettings();
                figma.ui.postMessage({ type: "language-settings", languageSettings });
                console.log("[onmessage] Sent language-settings", languageSettings);
                return true;
            }
            return false;
        });
    },
    handleAnnotateMessages(msg) {
        return __awaiter(this, void 0, void 0, function* () {
            if (msg.type === "create-shapes") {
                const { key, project } = msg;
                const sel = figma.currentPage.selection;
                if (!(sel.length === 1 && sel[0].type === "TEXT")) {
                    figma.notify('Please select a single text node.');
                    console.log("[create-shapes] Invalid selection", sel);
                    return;
                }
                const node = sel[0];
                const direction = msg.direction || "auto";
                yield AnnotationCreator.createAnnotation(node, key, project, direction);
                const storedProjects = yield StorageUtils.getProjects();
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
                const mainGroup = yield NodeUtils.getMainGroup();
                if (!mainGroup)
                    return;
                const group = mainGroup.children.find(g => g.name.endsWith(`-${uuid}`));
                if (group) {
                    const currentDirection = group.getPluginData("direction") || "auto";
                    const newDirection = msg.direction || "auto";
                    if (currentDirection !== newDirection) {
                        // Direction changed - recreate annotation
                        const textNodeId = group.getPluginData('targetId');
                        const textNode = textNodeId ? yield figma.getNodeByIdAsync(textNodeId) : null;
                        if (textNode) {
                            group.remove();
                            figma.currentPage.selection = [textNode];
                            yield AnnotationCreator.createAnnotation(textNode, key, project, newDirection);
                            figma.notify('Updated annotation with new positioning!');
                            console.log("[update-annotation] Recreated annotation with new direction", { key, project, uuid, direction: newDirection });
                        }
                    }
                    else {
                        // Direction unchanged - update text and realign
                        yield figma.loadFontAsync({ family: "DM Mono", style: "Medium" });
                        group.findOne(n => n.name === "projectName").characters = project;
                        group.findOne(n => n.name === "keyName").characters = key;
                        yield AnnotationService.realignGroup(group);
                        figma.notify('Updated annotation successfully!');
                        console.log("[update-annotation] Updated annotation text only", { key, project, uuid });
                    }
                }
                else {
                    figma.notify('Cannot find the annotation to update.');
                }
                return;
            }
        });
    },
    handleListMessages(msg) {
        return __awaiter(this, void 0, void 0, function* () {
            if (msg.type === "close-plugin") {
                figma.closePlugin();
                return;
            }
            if (msg.type === "update-row") {
                const mainGroup = yield NodeUtils.getMainGroup();
                if (!mainGroup)
                    return;
                const group = mainGroup.children.find(g => g.name.endsWith(`-${msg.uuid}`));
                if (group) {
                    yield figma.loadFontAsync({ family: "DM Mono", style: "Medium" });
                    group.findOne(n => n.name === "projectName").characters = msg.projectName;
                    group.findOne(n => n.name === "keyName").characters = msg.keyName;
                    yield AnnotationService.realignGroup(group);
                }
                const data = yield AnnotationService.getAllAnnotationData();
                figma.ui.postMessage({ type: "lokalise-data-updated", data });
                console.log("[get-lokalise-list] Updated row", msg.uuid, msg.projectName, msg.keyName);
                return;
            }
            if (msg.type === "locate-row") {
                const mainGroup = yield NodeUtils.getMainGroup();
                if (!mainGroup)
                    return;
                const group = mainGroup.children.find(g => g.name.endsWith(`-${msg.uuid}`));
                if (group) {
                    figma.currentPage.selection = [group];
                    figma.viewport.scrollAndZoomIntoView([group]);
                    console.log("[get-lokalise-list] Located row", msg.uuid);
                }
                return;
            }
            if (msg.type === "delete-row") {
                const mainGroup = yield NodeUtils.getMainGroup();
                if (!mainGroup)
                    return;
                const group = mainGroup.children.find(g => g.name.endsWith(`-${msg.uuid}`));
                if (group)
                    group.remove();
                const data = yield AnnotationService.getAllAnnotationData();
                figma.ui.postMessage({ type: "lokalise-data-updated", data });
                console.log("[get-lokalise-list] Deleted row", msg.uuid);
                return;
            }
        });
    },
    handleProjectSettingMessages(msg) {
        return __awaiter(this, void 0, void 0, function* () {
            if (msg.type === "close-plugin") {
                figma.closePlugin();
                return;
            }
        });
    }
};
// ==================== MAIN EXECUTION ====================
(() => __awaiter(void 0, void 0, void 0, function* () {
    if (figma.command) {
        UIManager.showByCommand(figma.command);
    }
    // Handle specific commands
    if (figma.command === "annotate-lokalise") {
        yield CommandHandlers.handleAnnotateLokalise();
    }
    else if (figma.command === "get-lokalise-list") {
        yield CommandHandlers.handleGetLokaliseList();
    }
    else if (figma.command === "realign") {
        yield CommandHandlers.handleRealign();
    }
    // Global message handler
    figma.ui.onmessage = (msg) => __awaiter(void 0, void 0, void 0, function* () {
        console.log("[onmessage] Received msg", msg, "command:", figma.command);
        // Handle global messages first
        const handled = yield MessageHandlers.handleGlobalMessages(msg);
        if (handled)
            return;
        // Handle command-specific messages
        if (figma.command === "annotate-lokalise") {
            yield MessageHandlers.handleAnnotateMessages(msg);
        }
        else if (figma.command === "get-lokalise-list") {
            yield MessageHandlers.handleListMessages(msg);
        }
        else if (figma.command === "project-setting") {
            yield MessageHandlers.handleProjectSettingMessages(msg);
        }
    });
}))();
