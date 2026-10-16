chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
// Resume files and the gateway key are available only to extension pages.
chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(console.error);
