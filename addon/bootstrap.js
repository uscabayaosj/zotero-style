/* Minimal Zotero 7 bootstrap for zotero-style-loom */
var chromeHandle;

function install(data, reason) { }

async function startup({ id, version, resourceURI, rootURI }, reason) {
  try {
    Components.utils.reportError("LOOM: bootstrap startup() called! id=" + id);

    // In Zotero 7, we don't need the complex waitForZotero pattern
    // Zotero is already available

    // String 'rootURI' introduced in Zotero 7
    if (!rootURI) {
      rootURI = resourceURI.spec;
    }

    if (Zotero.platformMajorVersion >= 102) {
      var aomStartup = Components.classes[
        "@mozilla.org/addons/addon-manager-startup;1"
      ].getService(Components.interfaces.amIAddonManagerStartup);
      var ioService = Components.classes["@mozilla.org/network/io-service;1"]
        .getService(Components.interfaces.nsIIOService);
      var manifestURI = ioService.newURI(rootURI + "manifest.json");
      chromeHandle = aomStartup.registerChrome(manifestURI, [
        ["content", "__addonRef__", rootURI + "chrome/content/"],
        ["locale", "__addonRef__", "en-US", rootURI + "chrome/locale/en-US/"],
        ["locale", "__addonRef__", "zh-CN", rootURI + "chrome/locale/zh-CN/"],
      ]);
    } else {
      setDefaultPrefs(rootURI);
    }

    // Global variables for plugin code
    const ctx = {
      rootURI,
    };
    ctx._globalThis = ctx;

    // Use Components.classes for script loader
    var scriptLoader = Components.classes["@mozilla.org/moz/jssubscript-loader;1"]
      .getService(Components.interfaces.mozIJSSubScriptLoader);
    scriptLoader.loadSubScript(
      `${rootURI}/chrome/content/scripts/index.js`,
      ctx
    );
  } catch(e) {
    Components.utils.reportError("LOOM bootstrap error: " + e + " " + e.stack);
    throw e;
  }
}

function shutdown({ id, version, resourceURI, rootURI }, reason) {
  if (reason === APP_SHUTDOWN) {
    return;
  }
  if (typeof Zotero === "undefined") {
    Zotero = Components.classes["@zotero.org/Zotero;1"].getService(
      Components.interfaces.nsISupports
    ).wrappedJSObject;
  }
  Zotero.__addonInstance__.hooks.onShutdown();

  Cc["@mozilla.org/intl/stringbundle;1"]
    .getService(Components.interfaces.nsIStringBundleService)
    .flushBundles();

  Cu.unload(`${rootURI}/chrome/content/scripts/index.js`);

  if (chromeHandle) {
    chromeHandle.destruct();
    chromeHandle = null;
  }
}

function uninstall(data, reason) { }

// Loads default preferences from defaults/preferences/prefs.js in Zotero 6
function setDefaultPrefs(rootURI) {
  var branch = Services.prefs.getDefaultBranch("");
  var obj = {
    pref(pref, value) {
      try {
        switch (typeof value) {
          case "boolean":
            branch.setBoolPref(pref, value);
            break;
          case "string":
            branch.setStringPref(pref, value);
            break;
          case "number":
            branch.setIntPref(pref, value);
            break;
          default:
            Zotero.logError(`Invalid type '${typeof value}' for pref '${pref}'`);
        }
      } catch {}
    },
  };
  Zotero.getMainWindow().console.log(rootURI + "prefs.js");
  Services.scriptloader.loadSubScript(rootURI + "prefs.js", obj);
}
