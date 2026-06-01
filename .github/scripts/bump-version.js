#!/usr/bin/env bun
// Single source of truth for the plugin version across every per-ecosystem
// manifest. The version lives at different JSON paths depending on the file,
// so this script owns that map rather than scattering jq expressions across
// the release workflows.
//
// Usage:
//   bun .github/scripts/bump-version.js --check            # verify all files agree, print version
//   bun .github/scripts/bump-version.js patch|minor|major  # bump and write to every file
//   bun .github/scripts/bump-version.js exact 1.2.3        # set an explicit version

import { readFileSync, writeFileSync } from "node:fs";

// Each entry: a file and the dot-paths inside it that hold the version.
// A file may carry the version in more than one place (marketplace manifests
// repeat it under .metadata and per-plugin).
const TARGETS = [
  { file: "plugin.json", paths: ["version"] },
  { file: ".claude-plugin/plugin.json", paths: ["version"] },
  { file: ".claude-plugin/marketplace.json", paths: ["version"] },
  { file: ".cursor-plugin/plugin.json", paths: ["version"] },
  {
    file: ".cursor-plugin/marketplace.json",
    paths: ["metadata.version", "plugins.0.version"],
  },
  { file: ".codex-plugin/plugin.json", paths: ["version"] },
  {
    file: ".github/plugin/marketplace.json",
    paths: ["metadata.version", "plugins.0.version"],
  },
];

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

function getPath(obj, path) {
  return path.split(".").reduce((node, key) => node?.[key], obj);
}

function bumpSemver(version, kind) {
  const match = SEMVER.exec(version);
  if (!match) throw new Error(`"${version}" is not a valid MAJOR.MINOR.PATCH version`);
  let [, major, minor, patch] = match.map(Number);
  if (kind === "major") return `${major + 1}.0.0`;
  if (kind === "minor") return `${major}.${minor + 1}.0`;
  if (kind === "patch") return `${major}.${minor}.${patch + 1}`;
  throw new Error(`unknown bump kind "${kind}"`);
}

// Read every version occurrence and confirm they all agree. Returns the
// single shared version, or throws listing every mismatch.
function readCurrentVersion() {
  const found = [];
  for (const { file, paths } of TARGETS) {
    const json = JSON.parse(readFileSync(file, "utf8"));
    for (const path of paths) {
      const value = getPath(json, path);
      if (value === undefined) throw new Error(`${file}: missing version at "${path}"`);
      found.push({ file, path, value });
    }
  }

  const versions = new Set(found.map((f) => f.value));
  if (versions.size !== 1) {
    const lines = found.map((f) => `  ${f.file} (${f.path}): ${f.value}`).join("\n");
    throw new Error(`plugin version mismatch detected:\n${lines}`);
  }
  return found[0].value;
}

// Write via a targeted string replace rather than re-serializing the parsed
// JSON. Re-serializing would normalize indentation (the manifests mix 2- and
// 4-space styles) and produce huge noise diffs. Every version occurrence in
// these manifests shares the same current value, so replacing the exact
// `"version": "<current>"` token bumps them all while leaving formatting,
// key order, and trailing newlines untouched.
function writeVersion(current, target) {
  const token = (v) => new RegExp(`("version"\\s*:\\s*")${v.replace(/\./g, "\\.")}(")`, "g");
  for (const { file } of TARGETS) {
    const before = readFileSync(file, "utf8");
    const after = before.replace(token(current), `$1${target}$2`);
    if (after === before) throw new Error(`${file}: no "version": "${current}" token found to replace`);
    writeFileSync(file, after);
  }
}

// GitHub Actions consumes step outputs via the $GITHUB_OUTPUT file.
function emitOutput(key, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (file) writeFileSync(file, `${key}=${value}\n`, { flag: "a" });
}

function main() {
  const [command, arg] = process.argv.slice(2);

  if (!command) {
    console.error("usage: bump-version.js --check | patch | minor | major | exact <version>");
    process.exit(2);
  }

  const current = readCurrentVersion();

  if (command === "--check") {
    console.log(current);
    emitOutput("version", current);
    return;
  }

  let target;
  if (command === "exact") {
    if (!arg) throw new Error("exact requires a version argument, e.g. exact 1.2.3");
    if (!SEMVER.test(arg)) throw new Error(`"${arg}" is not a valid MAJOR.MINOR.PATCH version`);
    target = arg;
  } else if (command === "major" || command === "minor" || command === "patch") {
    target = bumpSemver(current, command);
  } else {
    throw new Error(`unknown command "${command}"`);
  }

  if (target === current) throw new Error(`target version equals current (${current}); nothing to bump`);

  writeVersion(current, target);
  console.log(`bumped ${current} -> ${target}`);
  emitOutput("current_version", current);
  emitOutput("target_version", target);
  emitOutput("branch_name", `bump/v${target}`);
}

try {
  main();
} catch (err) {
  console.error(`::error::${err.message}`);
  process.exit(1);
}
