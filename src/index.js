#!/usr/bin/env node

/*
    pure-dango v0.9.1.
    a programming language made for myself
*/

/*
    - dev stuff:
    to update pure-dango:
    (this is where i store pure-dango. Use your path to pure-dango)
    cd Documents/pure-dango
    npx esbuild src/index.js --bundle --platform=node --target=node18 --outfile=dist/PureDango.cjs --format=cjs --define:PACKAGE_NAME='"pure-dango"' --define:PACKAGE_VERSION='"0.9.1"' --define:PACKAGE_DESCRIPTION='"A simple programming language built in JavaScript"'
    npx pkg dist/PureDango.cjs --targets node18-win-x64 --output dist/PureDangoLauncher.exe
    
    test .cjs with:
    cd Documents/pure-dango 
    node dist/PureDango.cjs run test.pds

    test .exe with: 
    cd dist
    PureDangoLauncher.exe run ../test.pds
*/

process.title = "Pure Dango";

// imports
import fs from                 "fs";
import path from               "path";
import readline from           "readline";
import {Decimal} from          "decimal.js";

import {parser} from           "./core/parser.js";
import {tokenizer} from        "./core/tokenizer.js";
import {interpret} from        "./core/interpreter.js";
import {buildBytecode} from    "./core/compiler.js";

import * as utils from         "./core/utils.js";
const   
{
    run,
    printResults,
    saveBytecode,
    loadBytecode
} = utils;

Decimal.set({precision: 20});

// get all info
const packageJson =
{
    name:          typeof PACKAGE_NAME !== 'undefined' ? PACKAGE_NAME : 'pure-dango',
    version:       typeof PACKAGE_VERSION !== 'undefined' ? PACKAGE_VERSION : '0.9.1',
    description:   typeof PACKAGE_DESCRIPTION !== 'undefined' ? PACKAGE_DESCRIPTION : 'A simple programming language built in JavaScript'
};

function pause(code = 0)
{
    // creates a way to question the user
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    // questions the user
    rl.question("\nPress enter to exit...", () =>
    {
        rl.close();
        process.exit(code);
    })
}

(async function main()
{
    let state =
    {
        time: 0
    }

    const args = process.argv.slice(2);

    let filename;
    if (args[0] === "run")
    {
        filename = args[1];
    }

    else if (args[0])
    {
        filename = args[0];
    }

    else
    {
        console.error("Please provide a file to run (.pds)");
        pause(1);
        return;
    }


    if (!filename.endsWith(".pds")) 
    {   
        console.error(`file "${filename}" is not a (.pds) Pure Dango Script file`);
        pause(1);
        return;
    }

    const filePath = path.resolve(process.cwd(), filename);
    if (!fs.existsSync(filePath))
    {
        console.error(`File not found: ${filename}`);
        pause(1);
        return;
    }

    // greeting (might change later)
    console.log(`Welcome to ${packageJson.name} v${packageJson.version}`);
    console.log(`${packageJson.description} \n`);

    const cache =                 process.env.LOCALAPPDATA || process.cwd();
    const pureDangoDirectory =    path.join(cache, "pure-dango"); // get the normal path
    const cacheFolder =           path.join(pureDangoDirectory, ".pdbccache"); // if the filepath is "C:/user/Documents/pure-dango" it will be: "C:/user/Documents/pure-dango/.pdbccache"

    // create the folder if it doesnt exist
    if (!fs.existsSync(cacheFolder))
    {
        fs.mkdirSync(cacheFolder, {recursive: true}); // makes a file with the path of cacheFolder
    }

    try
    {
        const FILE =       fs.readFileSync(filePath, "utf-8"); // Read the file given by the user
        const srcMTime =   fs.statSync(filePath).mtimeMs; 
        
        let BYTECODE =     loadBytecode(cacheFolder, filename);

        if (!BYTECODE)
        {
            const TOKENS =            await run(tokenizer, state, FILE);
            const AST =               await run(parser, state, TOKENS);
            BYTECODE =                await run(buildBytecode, state, AST); //console.log("Full bytecode:", JSON.stringify(BYTECODE, null, 2));
            const INTERPRETEDCODE =   await run(interpret, state, BYTECODE);

            saveBytecode(cacheFolder, BYTECODE, filename, srcMTime); //run(printResults, state, {TOKENS, AST, BYTECODE, INTERPRETEDCODE});
        }

        else
        {
            const INTERPRETEDCODE =   await run(interpret, state, BYTECODE); //run(printResults, state, {INTERPRETEDCODE});
        }
        
        console.log(`\n Pure dango program finished after: ${state.time.toFixed(3)} milliseconds...`);
    }

    catch (error)
    {
        console.error(error);
        console.error(`${error.name}: ${error.message}`);
        pause(1);
    }
})()