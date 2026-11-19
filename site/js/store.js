// localStorage 래퍼. 키 접두사 ecl:v1: (data-model.md). 저장이 막혀도 메모리로 동작한다.
const PREFIX = "ecl:v1:";
export function createStore(backend = globalThis.localStorage) {
  const mem = new Map();
  const ok = (() => { try { backend.setItem(`${PREFIX}t`, "1"); backend.removeItem(`${PREFIX}t`); return true; } catch { return false; } })();
  return {
    get(key, fallback = null) {
      try { const v = ok ? backend.getItem(PREFIX + key) : mem.get(key); return v == null ? fallback : JSON.parse(v); }
      catch { return fallback; }
    },
    set(key, value) {
      const v = JSON.stringify(value);
      try { if (ok) backend.setItem(PREFIX + key, v); else mem.set(key, v); } catch { mem.set(key, v); }
    },
    push(key, value) { const a = this.get(key, []); a.push(value); this.set(key, a); return a; },
    clearAll() {
      try { if (ok) Object.keys(backend).filter((k) => k.startsWith(PREFIX)).forEach((k) => backend.removeItem(k)); } catch { /* 무시 */ }
      mem.clear();
    },
  };
}
