/* Stub de DOM mínimo, compartilhado pelos testes.
   Não é um browser: serve para detectar erro de CARGA e chamar funções
   puras. Não substitui teste em aparelho — detecta a classe de bug que
   mais dói aqui: o silencioso, que quebra a página inteira sem avisar. */
const vm = require('vm');
const fs = require('fs');

function mkEl(id) {
  const el = {
    id, style: {}, value: '', textContent: '', innerHTML: '', disabled: false,
    checked: false, dataset: {}, children: [], _listeners: {},
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      toggle(c, f) { f === undefined ? (this._s.has(c) ? this._s.delete(c) : this._s.add(c)) : (f ? this._s.add(c) : this._s.delete(c)); },
      contains(c) { return this._s.has(c); },
    },
    appendChild(c) { this.children.push(c); return c; },
    removeChild() {}, insertBefore() {}, remove() {},
    addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); },
    removeEventListener() {},
    dispatch(t, ev) { (this._listeners[t] || []).forEach(f => f(ev || { target: this, preventDefault(){}, stopPropagation(){} })); },
    setAttribute(k, v) { this['_attr_' + k] = v; }, getAttribute(k) { return this['_attr_' + k] ?? null; },
    removeAttribute() {}, querySelector() { return mkEl('q'); }, querySelectorAll() { return []; },
    closest() { return null; }, focus() {}, blur() {}, select() {}, setSelectionRange() {},
    scrollIntoView() {}, click() { this.dispatch('click'); },
  };
  return el;
}

function makeContext(pathname) {
  const els = new Map();
  const store = {};
  const ctx = {
    console,
    document: {
      getElementById(id) { if (!els.has(id)) els.set(id, mkEl(id)); return els.get(id); },
      querySelector() { return mkEl('q'); },
      querySelectorAll() { return []; },
      createElement(t) { return mkEl(t); },
      createTextNode(t) { return { textContent: t }; },
      addEventListener(t, fn) { (this._l = this._l || {}), (this._l[t] = this._l[t] || []).push(fn); },
      body: mkEl('body'), head: mkEl('head'), documentElement: mkEl('html'),
      cookie: '', readyState: 'complete', title: '',
      _fire(t) { ((this._l || {})[t] || []).forEach(f => f()); },
    },
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; }, clear() { for (const k in store) delete store[k]; },
    },
    navigator: { onLine: true, userAgent: 'test', clipboard: null, share: undefined },
    fetch: () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, json: () => Promise.resolve([]), text: () => Promise.resolve('') }),
    crypto: require('crypto').webcrypto,
    setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
    alert() {}, prompt() { return null; }, confirm() { return false; },
    indexedDB: undefined, btoa: s => Buffer.from(s, 'binary').toString('base64'),
    atob: s => Buffer.from(s, 'base64').toString('binary'),
    Promise, Date, Math, JSON, parseFloat, parseInt, isFinite, isNaN, RegExp, Error,
    String, Number, Object, Array, Boolean, Map, Set, Intl, URL, URLSearchParams,
    encodeURIComponent, decodeURIComponent, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer,
    _els: els,
  };
  ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx;
  ctx.window.scrollTo = () => {}; ctx.scrollTo = () => {};
  /* window.addEventListener faltava no stub — páginas que registram
     handler global de erro quebravam no teste, não no browser. */
  ctx._winListeners = {};
  ctx.addEventListener = (t, fn) => { (ctx._winListeners[t] = ctx._winListeners[t] || []).push(fn); };
  ctx.removeEventListener = () => {};
  ctx.dispatchWindow = (t, ev) => (ctx._winListeners[t] || []).forEach(fn => fn(ev || {}));
  ctx.window.matchMedia = () => ({ matches: false, addListener() {}, addEventListener() {} });
  ctx.window.location = { href: '', origin: 'http://localhost', search: '', hash: '',
    pathname: pathname || '/', replace() {}, reload() {}, assign() {} };
  ctx.location = ctx.window.location;
  ctx.sessionStorage = ctx.localStorage;
  ctx.window.open = () => null;
  vm.createContext(ctx);
  return ctx;
}

function inlineScripts(html) {
  const out = [];
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
  let m; while ((m = re.exec(html))) out.push(m[1]);
  return out;
}

module.exports = { makeContext, inlineScripts, mkEl, vm, fs };
