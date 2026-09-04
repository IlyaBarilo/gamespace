// Wrap only this decoder's OPFS backend and handles, never browser prototypes.
export function instrumentSevenZip(sevenZip, statistics) {
  const opfs = sevenZip.OPFS;
  const prepareDirectory = opfs.prepareDir;
  opfs.prepareDir = function (path) {
    return statistics.async("directory", () => prepareDirectory.call(this, path));
  };
  const prepareFile = opfs.prepareFile;
  const wrapped = new WeakSet();
  opfs.prepareFile = async function (path) {
    await statistics.async("open", () => prepareFile.call(this, path));
    const handle = this.fileHandles.get(path);
    if (!handle || wrapped.has(handle)) return;
    const proxy = {
      read: (...args) => handle.read(...args),
      write: (...args) => statistics.sync("write", () => handle.write(...args), (bytes) => bytes),
      flush: (...args) => statistics.sync("flush", () => handle.flush(...args)),
      close: (...args) => {
        const result = statistics.sync("close", () => handle.close(...args));
        statistics.files++;
        return result;
      },
    };
    wrapped.add(proxy);
    this.fileHandles.set(path, proxy);
  };
}
