#!/usr/bin/env bun
import { $, Glob } from "bun";

const clone = async (repo, ref) => {
  const dir = (await $`mktemp -d`.quiet().text()).trim();
  const dispose = () => $`rm -rf ${dir}`.quiet().then(() => undefined);
  try {
    await $`git -C ${dir} init -q`.quiet();
    await $`git -C ${dir} remote add origin https://github.com/${repo}.git`.quiet();
    await $`git -C ${dir} fetch --depth 1 -q origin ${ref}`.quiet();
    await $`git -C ${dir} checkout -q FETCH_HEAD`.quiet();
    const sha = (await $`git -C ${dir} rev-parse HEAD`.quiet().text()).trim();
    return { dir, sha, [Symbol.asyncDispose]: dispose };
  } catch (e) {
    await dispose();
    throw e;
  }
};

try {
  const update = process.argv.includes("--update");
  const manifest = await Bun.file("manifest.json").json();
  const lockFile = Bun.file("manifest.lock.json");
  const lock = (await lockFile.exists()) ? await lockFile.json() : {};
  const excluded = (manifest.exclusions ?? []).map(p => new Glob(p));

  const targets = new Set(manifest.upstreams.flatMap(u => u.mappings.map(m => m.target)));
  await Promise.all([...targets].map(t => $`rm -rf ${t}`.quiet()));

  const entries = await Promise.all(manifest.upstreams.map(async u => {
    const key = `${u.repository}@${u.revision}`;
    const ref = update ? u.revision : (lock[key] ?? u.revision);
    await using snap = await clone(u.repository, ref);

    const lines = await Promise.all(u.mappings.map(async m => {
      const prefix = m.pattern.match(/^[^*?[{]*\//)?.[0] ?? "";
      const matches = /[*?[{]/.test(m.pattern)
        ? await Array.fromAsync(new Glob(m.pattern).scan({ cwd: snap.dir, onlyFiles: true }))
        : [m.pattern];

      if (m.as && matches.length > 1) {
        throw new Error(`"as" used with pattern matching ${matches.length} files: ${m.pattern}`);
      }

      const work = matches.filter(src => !excluded.some(g => g.match(src)));

      await Promise.all(work.map(async src => {
        const dst = `${m.target}/${m.as ?? src.slice(prefix.length)}`;
        const srcAbs = `${snap.dir}/${src}`;
        if (!/\.mdx?$/.test(src)) {
          await Bun.write(dst, Bun.file(srcAbs));
          return;
        }
        const raw = await Bun.file(srcAbs).text();
        const stripped = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
        await Bun.write(dst, `<!-- synced from ${u.repository} :: ${src} -->\n${stripped}`);
      }));

      const tally = `${work.length} file${work.length === 1 ? "" : "s"}`.padEnd(9);
      return `  ${tally} ${m.pattern} -> ${m.target}`;
    }));

    console.log([`${key} (${snap.sha.slice(0, 8)})`, ...lines, ""].join("\n"));
    return [key, snap.sha];
  }));

  const sorted = Object.fromEntries(entries.toSorted(([a], [b]) => a.localeCompare(b)));
  await Bun.write("manifest.lock.json", JSON.stringify(sorted, null, 2) + "\n");
} catch (e) {
  console.error(e);
  process.exit(1);
}
