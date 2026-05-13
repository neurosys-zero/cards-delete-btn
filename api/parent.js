"use strict";

/**
 * Cards View Delete Button — Experiment API (parent process)
 *
 * Injects a delete button into each message card in Thunderbird's Cards View
 * (about:3pane). Uses folder.deleteMessages() directly so that:
 *   - The current selection is not changed after deletion
 *   - The action is registered with Thunderbird's undo manager (Ctrl+Z)
 *
 * Tested on Thunderbird 115–148.
 */

var { ExtensionCommon } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionCommon.sys.mjs"
);

this.cardsDelete = class extends ExtensionCommon.ExtensionAPI {
  getAPI(context) {

    // -------------------------------------------------------------------------
    // Styles injected into about:3pane
    // -------------------------------------------------------------------------

    // Visibility (show on hover) is handled in JS via inline styles so it
    // can't be defeated by anything in TB's CSS cascade. The rules here
    // are purely visual.
    const BUTTON_CSS = `
      .cards-delete-btn {
        position: absolute;
        right: 80px;
        bottom: 8px;
        width: 20px;
        height: 20px;
        align-items: center;
        justify-content: center;
        background: transparent;
        border: none;
        border-radius: 3px;
        cursor: pointer;
        color: #888;
        line-height: 1;
        z-index: 100;
        padding: 0;
        box-sizing: border-box;
      }

      .cards-delete-btn:hover {
        background: rgba(204, 51, 51, 0.15);
        color: #cc3333;
      }
    `;

    // -------------------------------------------------------------------------
    // Delete a specific message by its view index
    // -------------------------------------------------------------------------

    function deleteMessage(row, innerWin, attempt = 0) {
      const rowIndex = typeof row.index === "number" ? row.index : -1;
      if (rowIndex < 0) {
        return;
      }

      // gDBView is briefly unavailable while a folder is loading. Retry a
      // couple of times so a click during folder switch is not silently
      // dropped (the original failure mode the README flagged).
      const view = innerWin.gDBView;
      if (!view) {
        if (attempt < 2) {
          innerWin.setTimeout(
            () => deleteMessage(row, innerWin, attempt + 1),
            attempt === 0 ? 200 : 500
          );
        }
        return;
      }

      const msgHdr = view.getMsgHdrAt(rowIndex);
      if (!msgHdr) {
        return;
      }

      // Pass msgWindow so the deletion is recorded by Thunderbird's undo manager
      const topWin = innerWin.browsingContext?.top?.window ?? innerWin;
      const msgWindow = topWin.msgWindow ?? null;

      msgHdr.folder.deleteMessages(
        [msgHdr],
        msgWindow,
        false, // deleteStorage — false = move to Trash
        false, // isMove
        null,  // copyListener
        true   // allowUndo — registers with undo manager for Ctrl+Z support
      );
    }

    // -------------------------------------------------------------------------
    // Attach a delete button to a single thread-card element
    // -------------------------------------------------------------------------

    function attachButton(row, innerWin) {
      // The button is positioned absolutely inside .card-container, which
      // already has position:relative in Thunderbird's own stylesheet.
      const container = row.querySelector(".card-container") ?? row;
      if (innerWin.getComputedStyle(container).position === "static") {
        container.style.position = "relative";
      }

      const doc = innerWin.document;
      const btn = doc.createElement("button");
      btn.className = "cards-delete-btn";
      btn.title = "Move to Trash (Ctrl+Z to undo)";
      btn.setAttribute("aria-label", "Move to Trash");

      // Hidden by default — inline style so it overrides any CSS the
      // cascade might apply.
      btn.style.display = "none";

      // Inline SVG trash icon. Uses stroke="currentColor" so the existing
      // CSS color and hover rules continue to apply with no change.
      const svgNS = "http://www.w3.org/2000/svg";
      const svg = doc.createElementNS(svgNS, "svg");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("width", "14");
      svg.setAttribute("height", "14");
      svg.setAttribute("fill", "none");
      svg.setAttribute("stroke", "currentColor");
      svg.setAttribute("stroke-width", "2");
      svg.setAttribute("stroke-linecap", "round");
      svg.setAttribute("stroke-linejoin", "round");
      svg.setAttribute("aria-hidden", "true");
      const paths = [
        ["polyline", { points: "3 6 5 6 21 6" }],
        ["path", { d: "M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" }],
        ["path", { d: "M10 11v6" }],
        ["path", { d: "M14 11v6" }],
        ["path", { d: "M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" }],
      ];
      for (const [tag, attrs] of paths) {
        const el = doc.createElementNS(svgNS, tag);
        for (const [k, v] of Object.entries(attrs)) {
          el.setAttribute(k, v);
        }
        svg.appendChild(el);
      }
      btn.appendChild(svg);

      // Show on row hover / keyboard focus.
      const show = () => { btn.style.display = "inline-flex"; };
      const hide = () => { btn.style.display = "none"; };
      row.addEventListener("mouseenter", show);
      row.addEventListener("mouseleave", hide);
      btn.addEventListener("focus", show);
      btn.addEventListener("blur", hide);

      // Capture-phase listeners intercept both mouse and keyboard activation
      // before the card's own handler would change the selection.
      const activate = (event) => {
        event.stopPropagation();
        event.preventDefault();
        deleteMessage(row, innerWin);
      };
      btn.addEventListener("click", activate, /* capture */ true);
      btn.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          activate(event);
        }
      }, /* capture */ true);

      container.appendChild(btn);
    }

    // -------------------------------------------------------------------------
    // Scan the document for unprocessed thread-card elements
    // -------------------------------------------------------------------------

    function processCards(innerWin) {
      innerWin.document
        .querySelectorAll("[is='thread-card']:not([data-cdb-done])")
        .forEach(row => {
          row.setAttribute("data-cdb-done", "1");
          attachButton(row, innerWin);
        });
    }

    // -------------------------------------------------------------------------
    // Inject styles and button logic into about:3pane
    // -------------------------------------------------------------------------

    function injectInto3Pane(innerWin) {
      if (!innerWin) {
        return;
      }
      const doc = innerWin.document;

      // Always refresh the stylesheet so a reinstall (without restarting
      // Thunderbird) picks up CSS changes from the new version.
      doc.getElementById("cards-delete-btn-css")?.remove();
      const style = doc.createElement("style");
      style.id = "cards-delete-btn-css";
      style.textContent = BUTTON_CSS;
      (doc.head ?? doc.documentElement).appendChild(style);

      // Wipe any buttons/markers left behind by a previous version of
      // this extension so the new code can re-attach with up-to-date
      // event handlers and styles.
      doc.querySelectorAll(".cards-delete-btn").forEach(b => b.remove());
      doc.querySelectorAll("[data-cdb-done]")
        .forEach(r => r.removeAttribute("data-cdb-done"));
      innerWin.console?.log?.("[cards-delete-btn] 1.0.4 active");

      // The observer only needs to be bound once per window.
      const firstTime = !innerWin._cardsDeleteInjected;
      innerWin._cardsDeleteInjected = true;

      // Process cards already in the DOM (always — we just cleared them).
      processCards(innerWin);

      if (!firstTime) {
        return;
      }

      // Coalesce bursts of mutations (the virtual list churns nodes on
      // every scroll) into one scan per frame.
      let scanScheduled = false;
      const scheduleScan = () => {
        if (scanScheduled) {
          return;
        }
        scanScheduled = true;
        innerWin.requestAnimationFrame(() => {
          scanScheduled = false;
          processCards(innerWin);
        });
      };

      // Process cards added later (virtual list recycles rows while scrolling)
      new innerWin.MutationObserver(scheduleScan)
        .observe(doc.documentElement, { childList: true, subtree: true });
    }

    // -------------------------------------------------------------------------
    // Find and watch the about:3pane browser frame inside a mail:3pane window
    // -------------------------------------------------------------------------

    function watchMailWindow(outerWin) {
      if (!outerWin) {
        return;
      }
      const doc = outerWin.document;

      function tryInject() {
        doc.querySelectorAll("browser, iframe").forEach(frame => {
          try {
            const cw = frame.contentWindow;
            if (cw?.location?.href?.startsWith("about:3pane")) {
              injectInto3Pane(cw);
            }
          } catch (_) {
            // Cross-origin or not-yet-loaded frame — ignore
          }
        });
      }

      // Always re-scan so a reinstall refreshes the injected stylesheet.
      tryInject();

      // Listeners only need to be bound once per window.
      if (outerWin._cardsDeleteWatching) {
        return;
      }
      outerWin._cardsDeleteWatching = true;

      // Re-try when new frames are added (e.g. new tab opened)
      new outerWin.MutationObserver(tryInject)
        .observe(doc.documentElement, { childList: true, subtree: true });

      // Re-try when a tab is selected — give the about:3pane frame a
      // moment to attach before scanning.
      doc.getElementById("tabmail")
        ?.addEventListener("select", () => outerWin.setTimeout(tryInject, 300));
    }

    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------

    return {
      cardsDelete: {
        async inject() {
          const { ExtensionSupport } = ChromeUtils.importESModule(
            "resource:///modules/ExtensionSupport.sys.mjs"
          );

          // Inject into windows that are already open
          const openWindows = Services.wm.getEnumerator("mail:3pane");
          while (openWindows.hasMoreElements()) {
            watchMailWindow(openWindows.getNext());
          }

          // Inject into windows opened after the extension loads
          ExtensionSupport.registerWindowListener("cardsDeleteBtn", {
            onLoadWindow(win) {
              if (win.document?.documentElement?.getAttribute("windowtype") === "mail:3pane") {
                watchMailWindow(win);
              }
            },
          });

          // Clean up when the extension is disabled or uninstalled
          context.callOnClose({
            close() {
              ExtensionSupport.unregisterWindowListener("cardsDeleteBtn");
            },
          });
        },
      },
    };
  }
};
