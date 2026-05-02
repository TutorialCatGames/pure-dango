import fs              from "fs";
import path            from "path";
import {fileURLToPath} from "url";
import {execSync}      from "child_process";
import os              from "os";

const __filename =  fileURLToPath(import.meta.url);
const __dirname =   path.dirname(__filename);
const projectRoot = path.join(__dirname, "../..");
const pkg =         JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));

const skipExe = process.env.SKIP_EXE === "true";

console.log("building");
execSync(`npx esbuild src/index.ts --bundle --platform=node --target=node22 --outfile=dist/PureDango.cjs --format=cjs --define:PACKAGE_NAME='"${pkg.name}"' --define:PACKAGE_VERSION='"${pkg.version}"' --define:PACKAGE_DESCRIPTION='"${pkg.description}"'`, {stdio: "inherit"});

if (skipExe) 
{
    console.log("Skipping executable packaging (development mode)");
    console.log("Build complete!");
    process.exit(0);
}

console.log("packaging");

const targets = pkg.pkg?.targets || ["node22-win-x64"];

const platform = os.platform();
const buildAll = process.env.BUILD_ALL === "true";

if (buildAll)
{
    const targetString = targets.join(",");
    console.log(`Building for all platforms: ${targetString}`);
    
    execSync(`npx @yao-pkg/pkg dist/PureDango.cjs --targets ${targetString}`, {stdio: "inherit"});
    
    const distDir = path.join(projectRoot, "dist");
    
    if (fs.existsSync(path.join(distDir, "PureDango-macos-x64")))
        fs.renameSync(path.join(distDir, "PureDango-macos-x64"), path.join(distDir, "PureDangoLauncher-macos"));
    
    if (fs.existsSync(path.join(distDir, "PureDango-macos-arm64")))
        fs.renameSync(path.join(distDir, "PureDango-macos-arm64"), path.join(distDir, "PureDangoLauncher-macos-arm64"));

    if (fs.existsSync(path.join(distDir, "PureDango-linux-x64")))
        fs.renameSync(path.join(distDir, "PureDango-linux-x64"), path.join(distDir, "PureDangoLauncher-linux"));
    
    if (fs.existsSync(path.join(distDir, "PureDango-linux-arm64")))
        fs.renameSync(path.join(distDir, "PureDango-linux-arm64"), path.join(distDir, "PureDangoLauncher-linux-arm64"));
    
    if (fs.existsSync(path.join(distDir, "PureDango-win-x64.exe")))
        fs.renameSync(path.join(distDir, "PureDango-win-x64.exe"), path.join(distDir, "PureDangoLauncher.exe"));
}
else 
{
    let target;
    let outputName;
    
    if (platform === "win32") 
    {
        target = targets.find(t => t.includes("win")) || "node22-win-x64";
        outputName = "PureDangoLauncher.exe";
    } 
    else if (platform === "darwin") 
    {
        const arch = os.arch();
        if (arch === "arm64")
            target = targets.find(t => t.includes("macos-arm64")) || "node22-macos-arm64";
        else
            target = targets.find(t => t.includes("macos-x64")) || "node22-macos-x64";
        outputName = "PureDangoLauncher-macos";
    } 
    else if (platform === "linux") 
    {
        const arch = os.arch();
        if (arch === "arm64" || arch === "aarch64")
            target = targets.find(t => t.includes("linux-arm64")) || "node22-linux-arm64";
        else
            target = targets.find(t => t.includes("linux-x64")) || "node22-linux-x64";
    
        outputName = "PureDangoLauncher-linux";
    } 
    else 
    {
        console.error(`Unsupported platform: ${platform}`);
        process.exit(1);
    }
    
    console.log(`Building for current platform: ${target}`);
    execSync(`npx @yao-pkg/pkg dist/PureDango.cjs --targets ${target} --output dist/${outputName}`, {stdio: "inherit"});
}

console.log("Fixing line endings for shell scripts...");
const shellScript = path.join(projectRoot, "bin/pure-dango.sh");
if (fs.existsSync(shellScript)) 
{
    let content = fs.readFileSync(shellScript, 'utf8');
    content = content.replace(/\r\n/g, '\n');
    fs.writeFileSync(shellScript, content, 'utf8');
}

console.log("Build complete!");