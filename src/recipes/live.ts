// What a composed preview runs so that the canvas can show it as a page, the same for every stack.
// The canvas runs a page in a frame as tall as the page, at the width of the device it shows, so the
// page has to say how tall it is, and a 100vh section must not be as tall as the frame. A recipe that
// `composes` puts this in its composed page, in the page's own script or as LIVE_SCRIPT in a script
// element, with its sections in SECTION_ATTRIBUTE markers inside one data-roughbook-variant root.
import { SECTION_ATTRIBUTE } from './context.js';

/**
 * Plain JavaScript, a function that starts it and returns what stops it. The canvas says the device's
 * height with { roughbook: "viewport", height }, and every window height the page's styles name is
 * set from it. The page says how tall it is and where each section starts with { roughbook: "size" },
 * and { roughbook: "painted" } once. A browser holds back rendering in a frame it is not drawing, so
 * these go by the clock as well. Outside a frame it does nothing.
 */
export const LIVE_FUNCTION = `function roughbookLive() {
  if (window.parent === window) return function () {};
  var WINDOW_HEIGHT = /(\\d*\\.?\\d+)[dsl]?vh\\b/g;
  var post = function (message) { window.parent.postMessage(message, "*"); };
  var written = new WeakMap();
  var percent = 0;
  var lockStyle = function (style) {
    var kept = written.get(style) || new Map();
    written.set(style, kept);
    for (var index = 0; index < style.length; index++) {
      var name = style.item(index);
      var value = style.getPropertyValue(name);
      if (value.search(WINDOW_HEIGHT) >= 0) kept.set(name, value);
    }
    kept.forEach(function (value, name) {
      var fixed = value.replace(WINDOW_HEIGHT, function (_match, amount) { return Number(amount) * percent + "px"; });
      style.setProperty(name, fixed, style.getPropertyPriority(name));
    });
  };
  var lockRules = function (rules) {
    Array.from(rules).forEach(function (rule) {
      if (rule.style) lockStyle(rule.style);
      if (rule.cssRules) lockRules(rule.cssRules);
    });
  };
  var lock = function () {
    if (!percent) return;
    Array.from(document.styleSheets).forEach(function (sheet) {
      try {
        lockRules(sheet.cssRules);
      } catch (error) {
        // A stylesheet from another site cannot be read.
      }
    });
    document.querySelectorAll("[style*='vh']").forEach(function (element) { lockStyle(element.style); });
  };
  var rootOf = function () { return document.querySelector("[data-roughbook-variant]"); };
  var measure = function () {
    var root = rootOf();
    if (!root) return;
    var sections = [];
    document.querySelectorAll("[${SECTION_ATTRIBUTE}]").forEach(function (section) {
      // A section may open with a style or a script, which has no box to measure.
      var first = Array.from(section.children).find(function (child) {
        var box = child.getBoundingClientRect();
        return box.width > 0 || box.height > 0;
      });
      var component = (section.getAttribute("${SECTION_ATTRIBUTE}") || "").split("/")[1];
      if (first && component) sections.push({ component: component, top: Math.round(first.getBoundingClientRect().top + window.scrollY) });
    });
    // The app's own layout can go on past the sections, with its footer.
    var bottom = root.getBoundingClientRect().bottom;
    Array.from(document.body.children).forEach(function (child) {
      if (/^(SCRIPT|STYLE|LINK|TEMPLATE)$/.test(child.tagName) || getComputedStyle(child).position === "fixed") return;
      bottom = Math.max(bottom, child.getBoundingClientRect().bottom);
    });
    var margin = parseFloat(getComputedStyle(document.body).marginBottom) || 0;
    post({ roughbook: "size", height: Math.ceil(bottom + window.scrollY + margin), sections: sections });
  };
  var hear = function (event) {
    if (event.source !== window.parent || !event.data || event.data.roughbook !== "viewport") return;
    var height = Number(event.data.height);
    if (!(height > 0)) return;
    percent = height / 100;
    lock();
    measure();
  };
  var escape = function (event) {
    if (event.key === "Escape") post({ roughbook: "escape" });
  };
  var waiting = 0;
  var watched = null;
  var sized = new ResizeObserver(function () { later(); });
  var later = function () {
    var root = rootOf();
    if (root && root !== watched) {
      watched = root;
      sized.observe(root);
    }
    clearTimeout(waiting);
    waiting = setTimeout(function () {
      lock();
      measure();
    }, 100);
  };
  var changed = new MutationObserver(later);
  changed.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("message", hear);
  window.addEventListener("keydown", escape);
  later();
  var clock = [300, 1000, 2500, 5000].map(function (wait) { return setTimeout(measure, wait); });
  var painted = setTimeout(function () {
    var fonts = document.fonts ? document.fonts.ready : Promise.resolve();
    fonts.then(function () { post({ roughbook: "painted" }); });
  }, 300);
  return function () {
    window.removeEventListener("message", hear);
    window.removeEventListener("keydown", escape);
    sized.disconnect();
    changed.disconnect();
    clock.forEach(clearTimeout);
    clearTimeout(painted);
    clearTimeout(waiting);
  };
}`;

/** The same for a script element, which starts it straight away. */
export const LIVE_SCRIPT = `(${LIVE_FUNCTION})();`;
