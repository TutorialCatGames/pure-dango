import fs from "fs";
import path from "path";
import {fileURLToPath} from "url";
import {execSync} from "child_process";

const __filename =        fileURLToPath(import.meta.url);
const __dirname =         path.dirname(__filename);
const projectRoot =       path.join(__dirname, "../..");
const pkg =               JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), 'utf8'));

console.log("building");
execSync(`npx esbuild src/index.js --bundle --platform=node --target=node18 --outfile=dist/PureDango.cjs --format=cjs --define:PACKAGE_NAME='"${pkg.name}"' --define:PACKAGE_VERSION='"${pkg.version}"' --define:PACKAGE_DESCRIPTION='"${pkg.description}"'`, { stdio: 'inherit' });

console.log("packaging");
execSync('npx pkg dist/PureDango.cjs --targets node18-win-x64 --output dist/PureDangoLauncher.exe', { stdio: 'inherit' });