#!/usr/bin/env node

// pure-dango v0.9.1.
// a programming language made for precision and myself


// TODO: Document

// note for myself: 
// tokenizer: tokens 
// parser: syntax errors 
// compiler: bytecode converter interpreter: 
// runtime errors


process.title = "pure-dango";

// imports
import fs        from "fs";
import path      from "path";
import readline  from "readline";
import {execSync} from "child_process";

import {parser}                    from  "./core/parser/main";
import {tokenizer}                 from  "./core/tokenizer/tokenizer";
import {interpret, Scope, initGMP} from  "./core/interpreter";
import {buildBytecode}             from  "./core/compiler";

import * as utils from "./core/utils";
const   
{
    run,
    saveBytecode,
    loadBytecode
} = utils;

// get all info
const packageJson =
{
    name:        typeof PACKAGE_NAME        !== "undefined" ? PACKAGE_NAME        : "pure-dango",
    version:     typeof PACKAGE_VERSION     !== "undefined" ? PACKAGE_VERSION     : "1.4.0",
    description: typeof PACKAGE_DESCRIPTION !== "undefined" ? PACKAGE_DESCRIPTION : "A simple programming language built in JavaScript"
};

type ASTOutput =
{
    scopes    : Scope
    stack     : (number | bigint | string | null | undefined)[];
}

function pause(code: number = 0)
{
    // creates a way to question the user
    const rl = readline.createInterface(
        {
            input  : process.stdin,
            output : process.stdout
        }
    );

    // questions the user
    rl.question(
        "\nPress enter to exit...", () =>
        {
            rl.close();
            process.exit(code);
        }
    );
}

process.on(
    "warning", (warning) => 
    {
        if (warning.name === 'ExperimentalWarning' && warning.message.includes('Fetch API'))
            return;
        console.warn(warning);
    }
);

(async function main()
{
    if (process.platform === "win32")
    {
        try 
        { 
            execSync("reg add HKCU\\Console /v VirtualTerminalLevel /t REG_DWORD /d 1 /f", {stdio: "ignore"}); 
        }
        catch {}
    }   

    process.on(
        "uncaughtException", () =>
        {
            process.stdout.write("\x1B[?25h");
            process.exit(1);
        }
    );
    process.on("exit", () => process.stdout.write("\x1B[?25h"));
    process.on(
        "SIGINT", () => 
        { 
            process.stdout.write("\x1B[?25h"); 
            process.exit(); 
        }
    );

    let state : {time : number, position : number} = 
    {
        time     : 0,
        position : 0
    }

    const args = process.argv.slice(2); 

    let filename: string;
    if (args[0] === "run") 
        filename = args[1];
    else if (args[0]) 
        filename = args[0];
    else
    {
        console.error("please provide a file to run (.pds)");
        pause(1);
        return;
    }

    if (!filename.endsWith(".pds")) 
    {   
        console.error(`file "${filename}" is not a (.pds) Pure Dango Script file`);
        pause(1);
        return;
    }

    const filePath: string = path.resolve(process.cwd(), filename);
    if (!fs.existsSync(filePath))
    {
        console.error(`file not found: ${filename}`);
        pause(1);
        return;
    }

    // greeting (might change later)
    console.log(`Welcome to ${packageJson.name} v${packageJson.version}`);
    console.log(`${packageJson.description} \n`);

    const cache = process.env.LOCALAPPDATA  // Windows
           || process.env.XDG_CACHE_HOME    // Linux (proper)
           || path.join(process.env.HOME || process.cwd(), ".cache"); // Linux fallback

    const pureDangoDirectory : string = path.join(cache, "pure-dango"); // get the normal path
    const cacheFolder        : string = path.join(pureDangoDirectory, ".pdbccache"); // if the filepath is "C:/user/Documents/pure-dango" it will be: "C:/user/Documents/pure-dango/.pdbccache"

    if (!fs.existsSync(cacheFolder)) 
        fs.mkdirSync(cacheFolder, {recursive: true}); // makes a file with the path of cacheFolder

    try
    {
        const FILE =       fs.readFileSync(filePath, "utf-8"); // Read the file given by the user
        const srcMTime =   fs.statSync(filePath).mtimeMs; 
        
        await initGMP();

        let BYTECODE : Array<string | number> | null = loadBytecode(cacheFolder, filename);

        if (!BYTECODE)
        {
            const TOKENS    : BaseToken[] =  await run(tokenizer, state, FILE);
            const PARSED    : AST         =  await run(parser, state, TOKENS);
            BYTECODE                      =  await run(buildBytecode, state, PARSED, filePath);
            const OUTPUT : ASTOutput      =  await run(interpret, state, BYTECODE, path.dirname(path.resolve(filePath)), filePath);

            saveBytecode(cacheFolder, BYTECODE as Array<string | number>, filename, srcMTime);
        }

        else 
            await run(interpret, state, BYTECODE, path.dirname(path.resolve(filePath)), filePath);

        console.log(`\nPure dango program exited after: ${state.time.toFixed(3)} milliseconds...`);
    }

    catch (error : unknown)
    {
        console.error(error);
        console.error(`\n${(error as Error).message}`);
        console.log(`Pure dango program exited after: ${state.time.toFixed(3)} milliseconds...`);
    }
})()