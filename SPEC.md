# Figma Lokalise Annotation Plugin — Product Spec

> Version: 2.1
> Last updated: 2026-04-03

## 概覽

本 Figma Plugin 讓設計師能在 Figma 設計稿中直接標記本地化 Key，將 Text node 與 Lokalise 翻譯 Key 建立連結，並支援匯出 CSV 供翻譯工作流使用。

---

## User Stories

---

### US-01：綁定 Annotation 元件

**As a** 設計師，
**I want to** 將一個 Figma Component 綁定為 Annotation 使用的模板，
**so that** Plugin 知道要用哪個元件來渲染 Annotation 並取得可用的 Project 清單。

#### Acceptance Criteria

- 使用者可選擇已存在的 Component Set / Component / Component Instance 進行綁定
- 使用者可讓 Plugin 自動建立預設元件後綁定
- 綁定成功後主畫面顯示 Key 輸入區
- 未綁定前主畫面顯示 Bind View，隱藏 Annotation 建立功能

#### UI

- **Bind View**（未綁定狀態）
  - 文字說明：請先選擇一個 Component
  - `Bind` 按鈕：選取 Figma 元件後啟用，點擊執行綁定
  - `Create & Bind` 按鈕：自動建立預設元件後綁定
- **Settings View** — Bound Component 區塊
  - 顯示已綁定元件名稱
  - `Unbind` 按鈕

#### Plugin Message API

| 方向 | Message type | Payload |
|------|-------------|---------|
| UI → Plugin | `bind-component` | — |
| UI → Plugin | `create-bind-component` | — |
| UI → Plugin | `unbind-component` | — |
| Plugin → UI | `bind-success` | `{ projectOptions, boundComponentName, boundComponentKey, hasSelection }` |
| Plugin → UI | `unbind-success` | `{ hasSelection }` |

#### 程式邏輯

1. `bind-component`：讀取目前 Figma 選取的節點，驗證為 ComponentSet / Component / ComponentInstance
2. 從元件中提取 `projectName` 屬性的所有可選值作為 `projectOptions`
   - 優先查找名為 `projectName` 的屬性
   - 若無，遞迴掃描巢狀 instance 的屬性
3. 將以下資料存入 `figma.clientStorage`：
   - `annotationComponentKey`、`annotationComponentName`、`annotationComponentSet`
   - `annotationComponentNodeId`、`annotationComponentSetNodeId`
   - `annotationProjectOptions`
4. `create-bind-component`：呼叫 `handleCreateBindComponentFlow()`，建立預設的 "Lokalise Annotation 2.0" ComponentSet，包含：
   - 4 種 pointer 方向 variant（Top / Bottom / Left / Right）
   - Project name 文字屬性
   - Key name 文字屬性
   - Exist 指示器屬性
5. `unbind-component`：清除所有 `clientStorage` 中的綁定資料

---

### US-02：建立 Annotation

**As a** 設計師，
**I want to** 在 Figma 中選取一個 Text node 後，輸入 Lokalise Key 並建立 Annotation，
**so that** 設計稿上能清楚標示哪些文字需要本地化。

#### Acceptance Criteria

- 必須先選取一個 Text node 才能建立
- Key 名稱只允許英數字、`-`、`_`、`.`
- 需選擇所屬 Project
- 需選擇 pointer 方向（上/下/左/右）
- 可標記為新 Key 或已存在 Key
- Ctrl/Cmd+Enter 可快速建立
- 建立後 Annotation 元件顯示在 Figma 畫布上

#### UI

- **Content preview**：顯示選取 Text node 的文字內容
- **Key input**：文字輸入欄位，含即時格式驗證
- **Project radio group**：從綁定元件自動取得的 Project 清單
- **Entry type toggle**：New Key / Existing Key 切換
- **Direction picker**：3×3 grid，中心空白，四方向可選（↑↓←→）
- **Create 按鈕**：驗證通過後啟用，點擊送出

#### Plugin Message API

| 方向 | Message type | Payload |
|------|-------------|---------|
| UI → Plugin | `create-shapes` | `{ key, project, direction, exist }` |
| Plugin → UI | `content-result` | `{ content, isAnnotated, keyName, projectName, uuid, exist, direction }` |
| Plugin → UI | `selection-state` | `{ hasSelection }` |

#### 程式邏輯

1. 接收 `create-shapes` 後，從 `figma.currentPage.selection` 取得目標 Text node
2. 呼叫 `figma.importComponentByKeyAsync(componentKey)` 匯入 Annotation 元件
3. **定位計算**：
   - 取得 Text node 的 absoluteTransform（x, y, width, height）
   - 計算 Text node 到父容器（Frame 或 Page）四個方向的距離
   - 根據請求的 direction 決定 Annotation 放置位置
   - connector line 長度 = max(gap * 0.4, 60px)
4. 建立 ComponentInstance，設定：
   - `projectName`、`keyName`、`exist` 屬性
   - pointer 方向 variant
5. 將以下資料以 `setPluginData` 存在 Annotation 節點上：
   - `uuid`（timestamp 產生）、`targetId`、`keyName`、`projectName`、`direction`、`exist`、`annotationType`、`componentKey`
6. 更新 Annotation index（UUID → Node ID 的映射表）

---

### US-03：更新 Annotation

**As a** 設計師，
**I want to** 選取已有 Annotation 的 Text node 後，修改 Key 名稱、Project 或 pointer 方向，
**so that** 設計稿的本地化標記能保持正確。

#### Acceptance Criteria

- 選取已標記的 Text node 時，UI 自動帶入現有設定值
- 可修改 Key、Project、Entry type、Direction
- 可選擇「套用到所有相同 Key」批次更新
- 更新後畫布上的 Annotation 立即反映變更

#### UI

- 選取已標記 Text node 後，按鈕顯示為 `Update`
- 所有欄位預填現有值
- **Apply to same key** checkbox（批次更新選項）

#### Plugin Message API

| 方向 | Message type | Payload |
|------|-------------|---------|
| UI → Plugin | `update-annotation` | `{ uuid, key, project, direction, exist }` |

#### 程式邏輯

1. 從 `content-result` 判斷 `isAnnotated === true` 時，UI 切換為 Update 模式
2. 接收 `update-annotation`：
   - 以 `uuid` 從 Annotation index 找到對應節點
   - 更新 ComponentInstance 的屬性（keyName、projectName、exist、direction variant）
   - 呼叫 realign 重新計算位置
3. 若勾選 `applyToSameKey`：掃描頁面中所有相同 `projectName + keyName` 的 Annotation，一一執行相同更新

---

### US-04：重新對齊 Annotation（Re-align）

**As a** 設計師，
**I want to** 在調整設計稿版面後，一鍵將所有 Annotation 重新定位到正確位置，
**so that** Annotation 始終對齊對應的 Text node。

#### Acceptance Criteria

- 執行 Re-align 後，所有 Annotation 移至其 target Text node 旁
- Annotation 已失去 target（Text node 被刪除）時，該 Annotation 自動刪除
- 可從 Plugin 選單執行（`realign` 命令）

#### Plugin Message API

此功能為直接執行的 plugin command，不涉及 UI message。

#### 程式邏輯

1. 掃描 `figma.currentPage` 上所有 `annotationType === "component"` 的節點
2. 對每個 Annotation 節點：
   - 讀取 `targetId`，呼叫 `figma.getNodeByIdAsync(targetId)` 取得目標 Text node
   - 若節點不存在，刪除該 Annotation
   - 若節點存在，重新執行定位計算（同 US-02 步驟 3），更新 x/y 座標與 pointer 方向 variant

---

### US-05：管理 Annotation 清單

**As a** 設計師，
**I want to** 在 Manage Keys 介面查看目前頁面的所有 Annotation，
**so that** 我能快速總覽所有本地化標記，找到並修正問題。

#### Acceptance Criteria

- 顯示所有 Annotation，列出 Project、Key 名稱、Text 內容
- 可依 Project 篩選
- 可依 Key 名稱搜尋
- 重複 Key（同 Project 下不同內容）顯示衝突警告
- 可點擊定位到對應 Annotation（Figma 畫布自動捲動並選取）

#### UI

- **File URL settings bar**（sticky bar 最上方）：
  - 未設定時顯示黃色背景，提示貼上 Figma 檔案 URL 以啟用 Link 欄位
  - 已設定時顯示綠色背景，顯示已儲存狀態（可點擊重設）
  - 包含文字輸入欄位與 `Save` 按鈕
- **Sticky project chip bar**：各 Project 的篩選 chip，可拖拉捲動，`All` 為預設
- **Duplicate warning block**（紅色）：列出有衝突的 Key 名稱
- **Card list**：
  - 每張 card 顯示：Project label、item count、exist indicator、Key 名稱（monospace）、Text 內容預覽
  - Action buttons：Locate / Edit / Delete
- **FAB search input**：浮動搜尋欄，輸入過濾 Key 名稱
- **Export button**：浮動，點擊直接下載完整 CSV（含全部 Project）

#### Plugin Message API

| 方向 | Message type | Payload |
|------|-------------|---------|
| UI → Plugin | `get-lokalise-list` | — |
| Plugin → UI | `lokalise-data` | `{ data: AnnotationData[], fileName: string, storedFileKey: string }` |
| UI → Plugin | `locate-row` | `{ uuid }` |
| UI → Plugin | `save-figma-url` | `{ url: string }` |
| Plugin → UI | `save-figma-url-error` | — |

#### 程式邏輯

1. 接收 `get-lokalise-list`：
   - 掃描 `figma.currentPage` 找出所有 Annotation 節點
   - 讀取每個節點的 plugin data，組成 `AnnotationData[]`
   - 對每個 annotation，呼叫 `NodeUtils.getTopLevelNode()` 取得對應最上層 Frame，配合 `storedFileKey` 組出 `frameUrl`
   - 回傳給 UI，附帶 `fileName`（`figma.root.name`）與 `storedFileKey`
2. 接收 `save-figma-url`：
   - 以正規表達式解析 URL 中的 fileKey（`/figma\.com\/(?:design|file|proto)\/([a-zA-Z0-9]{10,})/`）
   - 成功則存入 `figma.root.setPluginData("storedFileKey", fileKey)`，重新回傳 `lokalise-data`
   - 失敗則回傳 `save-figma-url-error`
3. Duplicate 偵測：將 `data` 依 `projectName + keyName` 分組，相同 key 但 content 不同者標記為衝突
4. 接收 `locate-row`：
   - 從 index 找到 Annotation 節點
   - `figma.viewport.scrollAndZoomIntoView([node])`
   - `figma.currentPage.selection = [node]`

---

### US-06：編輯與刪除單筆 Annotation

**As a** 設計師，
**I want to** 在清單中直接編輯或刪除某個 Annotation，
**so that** 不需要在 Figma 畫布上手動找到並選取它。

#### Acceptance Criteria

- 點擊 Edit 可在 card 上展開行內編輯
- 可修改 Project 與 Key 名稱
- 可選擇「套用到所有相同 Key」
- 刪除前不需確認（即時生效）
- 操作後清單自動刷新

#### UI

- **Edit mode（行內）**：
  - Project dropdown
  - Key 輸入欄位（含格式驗證）
  - `Save` 按鈕
  - 錯誤訊息區（格式不符時顯示）
- **Delete button**：trash icon，點擊即刪除

#### Plugin Message API

| 方向 | Message type | Payload |
|------|-------------|---------|
| UI → Plugin | `update-row` | `{ uuid, oldProjectName, oldKeyName, projectName, keyName, applyToSameKey }` |
| UI → Plugin | `delete-row` | `{ uuid }` |
| Plugin → UI | `lokalise-data-updated` | `{ data: AnnotationData[] }` |

#### 程式邏輯

1. 接收 `update-row`：
   - 從 index 找到 Annotation 節點
   - 更新 plugin data 與 ComponentInstance 屬性
   - 若 `applyToSameKey === true`，以 `oldProjectName + oldKeyName` 批次更新
   - 完成後重新掃描回傳 `lokalise-data-updated`
2. 接收 `delete-row`：
   - 找到 Annotation 節點後呼叫 `.remove()`
   - 從 index 移除對應條目
   - 回傳更新後的清單

---

### US-07：匯出 CSV

**As a** 設計師，
**I want to** 將所有 Annotation 匯出為 CSV，
**so that** 翻譯人員可以直接使用該檔案進行翻譯作業。

#### Acceptance Criteria

- 點擊 Export 直接下載包含全部 Project 的單一 CSV
- CSV 格式：第一列為 header（Key、Link、Project + 各語言 code），後續每列一個 Key
- 語言欄位的 header 來自 Language Settings
- 已存在的 Key（`exist === true`）與新 Key 都包含在內
- CSV 使用 UTF-8 BOM 編碼，確保 Excel 正確顯示中文
- 檔名使用 Figma 檔案根節點名稱（`figma.root.name`）

#### UI

- **Export button**（浮動在清單右下角）
- 點擊直接下載 CSV，不再顯示下拉選單

#### CSV 格式

```
Key,Link,Project,en,ja,zh_TW,en_US,zh_CN
button.submit,https://www.figma.com/design/xxx?node-id=1-2,MyProject,Submit,,,
page.title,,MyProject,Home Page,,,
```

- `Link` 欄位：若已設定 Figma 檔案 URL，填入對應最上層 Frame 的 Figma 直連網址；否則留空
- `Link` 欄位排在 `Key` 之後、`Project` 之前

#### 程式邏輯（全在 UI/前端執行）

1. 從 Plugin 取得的 `AnnotationData[]`（已含 `frameUrl`）讀取資料
2. 讀取 `languageSettings`（`baseLanguage` + `supportedLanguages`）
3. 組合 header row：`Key, Link, Project, {baseLanguage.code}, {supportedLanguages.map(l => l.code)}`
4. 每筆 annotation 產生一 row：`keyName, frameUrl, projectName, content, (空欄 × supported language 數量)`
5. 加上 UTF-8 BOM（`\uFEFF`），建立 Blob，觸發 `<a>` download
6. 檔名：`{fileName}.csv`（`fileName` 來自 Plugin 回傳的 `figma.root.name`）

---

### US-08：設定語言

**As a** 設計師，
**I want to** 設定 Base Language 與 Supported Languages，
**so that** 匯出的 CSV 包含正確的語言欄位。

#### Acceptance Criteria

- 可從 200+ 語言選項選擇 Base Language（單選）
- 可從同一清單選擇多個 Supported Languages（多選）
- 設定跨 Figma 檔案持久化
- 預設值：Base = English (en)，Supported = Japanese、Traditional Chinese、English US、Simplified Chinese

#### UI（Settings View）

- **Base Language dropdown**：
  - 顯示目前選取語言
  - 點擊展開可搜尋的下拉清單
  - 鍵盤方向鍵導覽，Enter 確認
- **Supported Languages multi-select**：
  - 可搜尋的下拉清單
  - 已選取項目顯示為 chip，可個別移除
- **Save button**

#### Plugin Message API

| 方向 | Message type | Payload |
|------|-------------|---------|
| UI → Plugin | `save-language-settings` | `{ languageSettings: { baseLanguage, supportedLanguages } }` |
| UI → Plugin | `get-language-settings` | — |
| Plugin → UI | `language-settings` | `{ languageSettings }` |

#### 程式邏輯

```typescript
interface LanguageSettings {
  baseLanguage: { code: string; name: string }
  supportedLanguages: Array<{ code: string; name: string }>
}
```

1. `save-language-settings`：呼叫 `figma.clientStorage.setAsync("languageSettings", settings)`
2. `get-language-settings`：呼叫 `figma.clientStorage.getAsync("languageSettings")`，未設定時回傳預設值

---

### US-09：初始化狀態載入

**As a** 設計師，
**I want to** 開啟 Plugin 時自動載入先前的設定，
**so that** 不需要每次重新綁定元件或設定語言。

#### Acceptance Criteria

- 開啟 Plugin 時自動判斷是否已綁定元件
- 若已綁定，直接進入 Main View
- 若未綁定，顯示 Bind View
- 若目前有選取 Text node，顯示其內容；若已標記，帶入現有值

#### Plugin Message API

| 方向 | Message type | Payload |
|------|-------------|---------|
| Plugin → UI | `init-state` | `{ isBound, hasSelection, projectOptions, boundComponentName, boundComponentKey }` |

#### 程式邏輯

1. Plugin 啟動時（`figma.showUI()`）：
   - 從 `figma.clientStorage` 讀取所有持久化設定
   - 從 `figma.currentPage.selection` 讀取目前選取狀態
   - 組合 `init-state` 回傳給 UI
2. `figma.on("selectionchange", ...)` 監聽選取變化：
   - 若選取節點為 Text node，讀取其內容與 plugin data
   - 發送 `content-result`（包含是否已標記、現有 Key 等）
   - 若無選取，發送 `selection-state: { hasSelection: false }`

---

## 資料模型

### AnnotationData

```typescript
interface AnnotationData {
  uuid: string         // timestamp 產生的唯一識別碼
  projectName: string  // Lokalise project 名稱
  keyName: string      // Localization key
  content: string      // 對應 Text node 的文字內容
  exist: boolean       // true = 已存在的 Key，false = 新 Key
  frameUrl: string     // 對應最上層 Frame 的 Figma 直連網址（未設定 fileKey 時為空字串）
}
```

### AnnotationNodePluginData（存在 Figma 節點上）

| Key | Type | 說明 |
|-----|------|------|
| `uuid` | string | 唯一識別碼 |
| `targetId` | string | 目標 Text node 的 Figma Node ID |
| `keyName` | string | Localization key |
| `projectName` | string | 所屬 Project |
| `direction` | `"top"｜"bottom"｜"left"｜"right"` | Pointer 方向 |
| `exist` | `"true"｜"false"` | 是否已存在 |
| `annotationType` | `"component"` | 識別為 Annotation 節點用 |
| `componentKey` | string | 使用的元件 key |

### ClientStorage Keys（`figma.clientStorage`，跨檔案持久化）

| Key | 說明 |
|-----|------|
| `annotationComponentKey` | 綁定元件的 component key |
| `annotationComponentName` | 元件顯示名稱 |
| `annotationComponentSet` | 元件 set key |
| `annotationComponentNodeId` | 元件的 Figma Node ID |
| `annotationComponentSetNodeId` | 元件 Set 的 Node ID |
| `annotationProjectOptions` | 快取的 Project 選項 |
| `languageSettings` | 語言設定 |

### Root Plugin Data（`figma.root.getPluginData / setPluginData`，per-file 持久化）

| Key | 說明 |
|-----|------|
| `storedFileKey` | 使用者貼入的 Figma 檔案 URL 所解析出的 fileKey，用於組合 Frame 直連網址 |

---

## Plugin Commands

| Command ID | 顯示名稱 | 說明 |
|-----------|---------|------|
| `annotate-lokalise` | ✍️ Annotate Keys | 開啟 Annotation 建立/更新 UI |
| `get-lokalise-list` | 📋 Manage Keys | 開啟 Annotation 清單管理 UI |
| `realign` | 🔄 Re-align Annotations | 重新對齊所有 Annotation（無 UI） |

---

## Key 驗證規則

- 正規表達式：`/^[A-Za-z0-9\-\_\.]+$/`
- 允許：英文字母（大小寫）、數字、`-`、`_`、`.`
- 不允許：空白、特殊符號、中文

---

## Annotation 定位演算法

```
1. 取得 Text node 的 absoluteTransform → (x, y, w, h)
2. 計算到父容器邊界的距離：
   - gapTop    = text.y - parent.y
   - gapBottom = (parent.y + parent.h) - (text.y + text.h)
   - gapLeft   = text.x - parent.x
   - gapRight  = (parent.x + parent.w) - (text.x + text.w)
3. 依 direction 決定 line 長度 = max(gapX * 0.4, 60)
4. 計算 annotation 的絕對座標
5. 轉換為相對於父容器的座標後設定
```
