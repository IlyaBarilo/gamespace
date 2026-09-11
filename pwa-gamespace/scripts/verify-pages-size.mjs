import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Keep a margin below GitHub Pages' 1 GB published-site limit.
export const MAX_PAGES_BYTES = 900_000_000;

export async function measurePagesSize(directory, limit = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error("Некорректный предел размера Pages.");
  if (!(await lstat(directory)).isDirectory()) throw new Error("Ожидался каталог готового сайта Pages.");
  let bytes = 0, files = 0;
  const pending = [directory];
  while (pending.length) {
    const current = pending.pop();
    for (const name of await readdir(current)) {
      const file = path.join(current, name);
      const info = await lstat(file);
      if (info.isDirectory()) pending.push(file);
      else if (info.isFile()) {
        bytes += info.size;
        files++;
        if (bytes > limit) throw new Error(`Размер Pages превышает предел ${limit} байт: уже ${bytes} байт. Публикация остановлена.`);
      } else throw new Error(`Неподдерживаемый объект в Pages: ${file}`);
    }
  }
  if (!files) throw new Error("Каталог Pages пуст.");
  return { bytes, files, limit };
}

export async function verifyPagesSize(directory, limit = MAX_PAGES_BYTES) {
  return measurePagesSize(directory, limit);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw new Error("Укажите каталог готового сайта Pages.");
    const { bytes, files, limit } = await verifyPagesSize(process.argv[2]);
    console.log(`Размер Pages: ${bytes} байт, файлов ${files}, предел ${limit} байт.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
