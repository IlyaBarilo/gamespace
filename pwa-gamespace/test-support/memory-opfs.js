export function memoryOpfs(t) {
  const files = new Map();
  const directories = new Set([""]);
  const hooks = {};
  const missing = () => new DOMException("Missing entry", "NotFoundError");
  const join = (parent, name) => parent ? `${parent}/${name}` : name;
  function directory(path = "") {
    return {
      kind: "directory",
      async getDirectoryHandle(name, { create = false } = {}) {
        const next = join(path, name);
        if (files.has(next)) throw new DOMException("File instead of directory", "TypeMismatchError");
        if (!directories.has(next)) {
          if (!create) throw missing();
          directories.add(next);
        }
        return directory(next);
      },
      async getFileHandle(name, { create = false } = {}) {
        const next = join(path, name);
        if (directories.has(next)) throw new DOMException("Directory instead of file", "TypeMismatchError");
        if (!files.has(next)) {
          if (!create) throw missing();
          files.set(next, new Blob([]));
        }
        return {
          kind: "file",
          async getFile() { hooks.read?.(next); return files.get(next); },
          async createWritable() {
            const chunks = [];
            return new WritableStream({
              async write(chunk) { await hooks.write?.(next, chunk); chunks.push(chunk); },
              async close() { await hooks.close?.(next); files.set(next, new Blob(chunks)); },
            });
          },
        };
      },
      async *entries() {
        hooks.list?.(path);
        const prefix = path ? `${path}/` : "";
        for (const next of [...directories, ...files.keys()]) {
          if (!next.startsWith(prefix)) continue;
          const name = next.slice(prefix.length);
          if (!name || name.includes("/")) continue;
          yield [name, directories.has(next) ? directory(next) : await this.getFileHandle(name)];
        }
      },
      async removeEntry(name) {
        const next = join(path, name);
        for (const file of files.keys()) if (file === next || file.startsWith(`${next}/`)) files.delete(file);
        for (const dir of directories) if (dir === next || dir.startsWith(`${next}/`)) directories.delete(dir);
      },
    };
  }
  const previous = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { storage: { getDirectory: async () => directory() } } });
  t.after(() => previous ? Object.defineProperty(globalThis, "navigator", previous) : delete globalThis.navigator);
  return {
    files, hooks,
    write(path, value) {
      const parts = path.split("/"); parts.pop();
      for (let i = 1; i <= parts.length; i++) directories.add(parts.slice(0, i).join("/"));
      files.set(path, new Blob([value]));
    },
    async read(path) { return files.get(path)?.text(); },
  };
}
