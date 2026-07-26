/* Copyright 2012 Will Shanks.
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

if (typeof Zotero == "undefined") {
  var Zotero;
}

var chromeHandle;

// In Zotero 6, bootstrap methods are called before Zotero is initialized, and using include.js
// to get the Zotero XPCOM service would risk breaking Zotero startup. Instead, wait for the main
// Zotero window to open and get the Zotero object from there.
//
// In Zotero 7, bootstrap methods are not called until Zotero is initialized, and the 'Zotero' is
// automatically made available.
async function waitForZotero() {
  try {
    if (typeof Zotero != "undefined") {
      await Zotero.initializationPromise;
    }

    // In Zotero 7, use Zotero.getMainWindow() instead of ChromeUtils.import
    // which has been removed in newer Firefox versions
    var windows, Services;
    try {
      // First try the global Services (available in Zotero 7)
      Services = globalThis.Services || window.Services;
      if (!Services || !Services.wm) throw new Error("Services not available");
    } catch(e) {
      // Fallback: minimal Services via Components
      Services = {
        wm: Components.classes["@mozilla.org/appshell/window-mediator;1"]
          .getService(Components.interfaces.nsIWindowMediator)
      };
    }

    var windows = Services.wm.getEnumerator("navigator:browser");
  var found = false;
  while (windows.hasMoreElements()) {
    let win = windows.getNext();
    if (win.Zotero) {
      Zotero = win.Zotero;
      found = true;
      break;
    }
  }
  if (!found) {
    await new Promise((resolve) => {
      var listener = {
        onOpenWindow: function (aWindow) {
          // Wait for the window to finish loading
          let domWindow = aWindow
            .QueryInterface(Ci.nsIInterfaceRequestor)
            .getInterface(Ci.nsIDOMWindowInternal || Ci.nsIDOMWindow);
          domWindow.addEventListener(
            "load",
            function () {
              domWindow.removeEventListener("load", arguments.callee, false);
              if (domWindow.Zotero) {
                Services.wm.removeListener(listener);
                Zotero = domWindow.Zotero;
                resolve();
              }
            },
            false
          );
        },
      };
      Services.wm.addListener(listener);
    });
  }
  await Zotero.initializationPromise;
  } catch(e) {
    // log the error that killed startup
    try { Components.utils.reportError("LOOM bootstrap error: " + e + " " + e.stack); } catch(_){}
    alert("LOOM bootstrap error: " + e);
    throw e;
  }
}

function install(data, reason) { }

async function startup({ id, version, resourceURI, rootURI }, reason) {
  alert("LOOM: bootstrap startup() called! id=" + id)
  await waitForZotero();
  Zotero.logError(`LOOM bootstrap: startup called, id=${id}, rootURI=${rootURI}`)

  // String 'rootURI' introduced in Zotero 7
  if (!rootURI) {
    rootURI = resourceURI.spec;
  }

  if (Zotero.platformMajorVersion >= 102) {
    var aomStartup = Components.classes[
      "@mozilla.org/addons/addon-manager-startup;1"
    ].getService(Components.interfaces.amIAddonManagerStartup);
    // Use Components.classes for IO service (bypasses ChromeUtils.import deprecation)
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

  // Use Components.classes for script loader (bypasses ChromeUtils.import deprecation)
  var scriptLoader = Components.classes["@mozilla.org/moz/jssubscript-loader;1"]
    .getService(Components.interfaces.mozIJSSubScriptLoader);
  scriptLoader.loadSubScript(
    `${rootURI}/chrome/content/scripts/index.js`,
    ctx
  );
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