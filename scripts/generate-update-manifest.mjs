import { createHash } from "node:crypto";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDirectory = resolve(fileURLToPath(new URL("..", import.meta.url)));
const releaseDirectory = resolve(rootDirectory, "release");
const packageJson = JSON.parse(await readFile(resolve(rootDirectory, "package.json"), "utf8"));
const version = String(packageJson.version || "").trim();

if (!version) throw new Error("package.json 缺少版本号，无法生成更新元数据");

const releaseFiles = await readdir(releaseDirectory, { withFileTypes: true });
const installer = releaseFiles.find((entry) => (
  entry.isFile()
  && entry.name.endsWith(".exe")
  && !entry.name.endsWith(".__uninstaller.exe")
  && entry.name.includes(`Setup ${version}.exe`)
));

if (!installer) {
  throw new Error(`未找到 v${version} 的 NSIS 安装包；请先执行 electron-builder --win nsis --x64`);
}

const installerPath = resolve(releaseDirectory, installer.name);
const [contents, details] = await Promise.all([readFile(installerPath), stat(installerPath)]);
const sha512 = createHash("sha512").update(contents).digest("base64");
const yamlString = (value) => JSON.stringify(String(value));
const manifest = [
  `version: ${yamlString(version)}`,
  "files:",
  `  - url: ${yamlString(installer.name)}`,
  `    sha512: ${yamlString(sha512)}`,
  `    size: ${details.size}`,
  `path: ${yamlString(installer.name)}`,
  `sha512: ${yamlString(sha512)}`,
  `releaseDate: ${yamlString(details.mtime.toISOString())}`,
  "",
].join("\n");

const manifestPath = resolve(releaseDirectory, "latest.yml");
await writeFile(manifestPath, manifest, "utf8");
console.log(`Built release/${"latest.yml"} for ${installer.name}`);
