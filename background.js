"use strict";

/**
 * Cards View Delete Button — background script
 *
 * Calls the Experiment API to inject the delete button into all open and
 * future mail:3pane windows. inject() is idempotent, so calling it once
 * at script load (top-level) in addition to the runtime startup/install
 * events is safe and covers the case where the user re-enables the
 * extension without restarting Thunderbird.
 */

async function init() {
  await browser.cardsDelete.inject();
}

init();
browser.runtime.onStartup.addListener(init);
browser.runtime.onInstalled.addListener(init);
