// A deliberately minimal fake DOM — just enough surface area for
// js/ui/components.js's el() helper and the view functions in
// js/ui/views.js to run without throwing on missing DOM APIs. This is
// NOT a rendering-correctness tool (it doesn't lay anything out or
// check visual output) — its only job is to actually CALL the render
// functions so a real runtime bug (undefined function, bad import,
// wrong property name) surfaces as a thrown error, which `node --check`
// (syntax-only) can never catch.

class FakeClassList {
  constructor(el) { this.el = el; this.set = new Set(); }
  add(...names) { names.forEach((n) => this.set.add(n)); this._sync(); }
  remove(...names) { names.forEach((n) => this.set.delete(n)); this._sync(); }
  toggle(name) { this.set.has(name) ? this.set.delete(name) : this.set.add(name); this._sync(); }
  contains(name) { return this.set.has(name); }
  _sync() { this.el._className = [...this.set].join(" "); }
}

class FakeNode {
  constructor(tag) {
    this.tagName = (tag || "").toUpperCase();
    this.children = [];
    this.parentNode = null;
    this._attrs = {};
    this._className = "";
    this._innerHTML = "";
    this._listeners = {};
    this.style = {};
    this.dataset = {};
    this.disabled = false;
    this._value = "";
    this.textContent = "";
  }
  get value() { return this._value; }
  set value(v) { this._value = v; this._valueExplicitlySet = true; }
  get className() { return this._className; }
  set className(v) { this._className = v; }
  get classList() { if (!this._classList) this._classList = new FakeClassList(this); return this._classList; }
  setAttribute(k, v) {
    this._attrs[k] = v;
    if (k === "data-trade-id" || k.startsWith("data-")) this.dataset[toCamel(k.slice(5))] = v;
  }
  getAttribute(k) { return this._attrs[k] ?? null; }
  addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }
  removeEventListener() {}
  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    // Mimic real <select> behavior: the browser auto-selects the first
    // <option> the moment one exists, so a script that reads select.value
    // right after populating it (a common pattern in this app) gets a
    // real value instead of "". Only auto-set until something explicit
    // sets .value itself.
    if (this.tagName === "SELECT" && child.tagName === "OPTION" && !this._valueExplicitlySet) {
      this.value = child._attrs?.value ?? child.textContent ?? "";
    }
    return child;
  }
  remove() {
    if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((c) => c !== this);
  }
  replaceWith(node) {
    if (this.parentNode) {
      const idx = this.parentNode.children.indexOf(this);
      if (idx !== -1) this.parentNode.children[idx] = node;
    }
  }
  get innerHTML() { return this._innerHTML; }
  set innerHTML(v) {
    this._innerHTML = v;
    if (v === "") this.children = [];
  }
  querySelectorAll() { return []; }
  querySelector() { return null; }
  scrollIntoView() {}
  focus() {}
  click() { (this._listeners.click || []).forEach((fn) => fn({ target: this })); }
}

function toCamel(s) { return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase()); }

class FakeTextNode {
  constructor(text) { this.textContent = text; this.nodeType = 3; }
}

const fakeBody = new FakeNode("body");

globalThis.document = {
  createElement: (tag) => new FakeNode(tag),
  createTextNode: (text) => new FakeTextNode(text),
  body: fakeBody,
  getElementById: () => new FakeNode("div"),
};

globalThis.window = globalThis.window || {};
globalThis.window.location = globalThis.window.location || { hash: "", reload: () => {} };
globalThis.localStorage = globalThis.localStorage || {
  _data: {},
  getItem(k) { return this._data[k] ?? null; },
  setItem(k, v) { this._data[k] = String(v); },
  removeItem(k) { delete this._data[k]; },
};

export function newRoot() {
  return new FakeNode("div");
}
