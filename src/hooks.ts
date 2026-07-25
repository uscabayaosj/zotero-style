import { config } from "../package.json";
import { getString, initLocale } from "./modules/locale";
import Views from "./modules/views"; 
import Events from "./modules/events";
import AddonItem from "./modules/item";
import { registerPrefsScripts, registerPrefs } from "./modules/prefs";
import LocalStorage from "./modules/localStorage";

async function onStartup() {
  Zotero.logError("LOOM: Zotero Style startup beginning...")
  ztoolkit.log("LOOM: Zotero Style startup beginning...")
  registerPrefs();
  // Register the callback in Zotero as an item observer
  const notifierID = Zotero.Notifier.registerObserver(
    { notify: onNotify },
    ["tab"]
  );
  ztoolkit.ProgressWindow.setIconURI(
    "default",
    `chrome://${config.addonRef}/content/icons/favicon.png`
  );
  // Unregister callback when the window closes (important to avoid a memory leak)
  window.addEventListener(
    "unload",
    (e: Event) => {
      Zotero.Notifier.unregisterObserver(notifierID);
    },
    false
  );
  
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);
  initLocale();
  // 初始化储存位置
  let storage
  const storageIn = Zotero.Prefs.get(`${config.addonRef}.storage.in`) as string
  Zotero.logError(`LOOM: storage.in = "${storageIn}"`)
  if (storageIn == "note") {
    Zotero._AddonItemGlobal = Zotero._AddonItemGlobal || new AddonItem()
    const addonItem = Zotero._AddonItemGlobal
    if (!addonItem.item) { await addonItem.init() }
    storage = addonItem
  } else if (storageIn == "file"){
    storage = new LocalStorage(
      Zotero.Prefs.get(`${config.addonRef}.storage.filename`) as string
    )
    await storage.lock;
  } else {
    return 
  }
  ztoolkit.log(storage)

  const events = new Events(storage)
  events.onInit()
  
  const views = new Views(storage)
  // 为用户默认打开显示所有标签，若要显示分类下，需要手动关闭
  const tasks = [
    views.createGraphView(),
    views.renderTitleColumn(),
    views.createTagsColumn(),
    views.createTextTagsColumn(),
    views.createProgressColumn(),
    views.createIFColumn(),
    views.createPublicationTagsColumn(),
    views.createRatingColumn(),
    views.initItemSelectListener(),
    views.addNumberToCollectionTree(),
    views.renderCreatorColumn(),
    views.renderPublicationColumn(),
    // LOOM integration
    views.createLoomStatusColumn(),
    views.createObsidianExportMenu(),
  ]
  try {
    await Promise.all(tasks);
    Zotero.logError("LOOM: all tasks completed (columns, graph, etc.)")
  } catch (e) {
    ztoolkit.log("ERROR", e)
    Zotero.logError("LOOM: tasks failed: " + e)
  }
  await views.registerSwitchColumnsViewUI();
  await views.initTags();
  // LOOM: create view presets and patch anthro journal data (safely)
  try {
    views.createLoomViewPresets()
  } catch (e) {
    ztoolkit.log("LOOM: view presets init error", e)
  }
  try {
    await views.patchAnthroPublicationTags()
  } catch (e) {
    ztoolkit.log("LOOM: anthro publication tags init error", e)
  }
  try {
    ZoteroPane.itemsView.tree._columns._updateVirtualizedTable()
    ztoolkit.ItemTree.refresh()
  } catch { }
  await views.registerCommands()
  // Confirm LOOM features loaded
  ztoolkit.log("LOOM: all features initialized")
  new ztoolkit.ProgressWindow(config.addonName)
    .createLine({ text: "📦 Zotero Style LOOM loaded — 9 features active", type: "success" })
    .show()

}

function onShutdown(): void {
  try {
    ztoolkit.log("zotero style onShutdown")
    ztoolkit.unregisterAll()
    ztoolkit.UI.unregisterAll()
    ztoolkit.ItemTree.unregisterAll()
    
    // 移除创建的按钮
    document.querySelector("#zotero-style-show-hide-graph-view")?.remove();
    // 恢复嵌套标签
    (document.querySelector(".tag-selector") as HTMLDivElement).style.display = ""
  } catch (e) {
    console.log("ERROR onShutdown", e)
  } finally {
    addon.data.alive = false;
    delete Zotero.ZoteroStyle;
  }
}

async function onNotify(
  event: string,
  type: string,
  ids: Array<string>,
  extraData: { [key: string]: any }
) {
  // You can add your code to the corresponding notify type
  ztoolkit.log("notify", event, type, ids, extraData);
  if (
    event == "select" &&
    type == "tab" &&
    extraData[ids[0]].type == "reader"
  ) {
    window.setTimeout(async () => {
      ztoolkit.log("select reader tab")
      let reader = await ztoolkit.Reader.getReader();
      Zotero.ZoteroStyle.data.views.modifyAnnotationColors(reader);
    })
  } else if (
    event == "select" &&
    type == "tab" &&
    extraData[ids[0]].type == "library"
  ) {
    // ZoteroPane.itemsView.tree._columns._updateVirtualizedTable()
  } else {
    return;
  }
}

async function onPrefsEvent(type: string, data: { [key: string]: any }) {
  switch (type) {
    case "load":
      registerPrefsScripts(data.window);
      break;
    default:
      return;
  }
}

export default {
  onStartup,
  onShutdown,
  onNotify,
  onPrefsEvent
};
