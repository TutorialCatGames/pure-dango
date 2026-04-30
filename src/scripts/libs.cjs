const {readdirSync} = require("fs");
const {resolve}     = require("path");
const {execSync}    = require("child_process");

console.log('testing all files from "src/runtime/libs"')

// get all files from src/runtime/libs that end with pds
const libs  = resolve(__dirname, "../runtime/libs");
const files = readdirSync(libs).filter(file => file.endsWith(".pds"));

for (const file of files)
{
    const filePath = resolve(libs, file);
    try
    {
        execSync(`npx tsx "${resolve(__dirname, "../index.ts")}" run "${filePath}"`, {stdio: "inherit"});
    }
    catch(error)
    {
        console.log(`FAILED: \n ${error}`);
        process.exit(1);
    }
}