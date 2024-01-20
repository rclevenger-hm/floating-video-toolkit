(function (root) {
  "use strict";
  // Track only properties we own; preserve unrelated inline styles and changes
  // made by the player after our last write.
  function createStyleLedger() {
    const records = new Map();
    function set(element, property, value, priority = "") {
      let props = records.get(element);
      if (!props) records.set(element, props = new Map());
      let rec = props.get(property);
      if (!rec) props.set(property, rec = {value:element.style.getPropertyValue(property), priority:element.style.getPropertyPriority(property)});
      element.style.setProperty(property, value, priority);
      rec.last = element.style.getPropertyValue(property);
      rec.lastPriority = element.style.getPropertyPriority(property);
    }
    function restore(element) {
      const props = records.get(element);
      if (!props) return;
      for (const [property, rec] of props) {
        if (element.style.getPropertyValue(property) !== rec.last || element.style.getPropertyPriority(property) !== rec.lastPriority) continue;
        if (rec.value) element.style.setProperty(property, rec.value, rec.priority);
        else element.style.removeProperty(property);
      }
      records.delete(element);
    }
    function restoreAll() { for (const element of records.keys()) restore(element); }
    function restoreExcept(keep) { for (const element of records.keys()) if (element !== keep) restore(element); }
    return {set, restore, restoreAll, restoreExcept};
  }
  root.FloatingVideoState = {createStyleLedger};
  if (typeof module !== "undefined") module.exports = root.FloatingVideoState;
})(globalThis);
