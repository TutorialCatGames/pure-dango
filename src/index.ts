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
    npx esbuild src/index.ts --bundle --platform=node --target=node18 --outfile=dist/PureDango.cjs --format=cjs --define:PACKAGE_NAME='"pure-dango"' --define:PACKAGE_VERSION='"0.9.1"' --define:PACKAGE_DESCRIPTION='"A simple programming language built in JavaScript"'
    npx pkg dist/PureDango.cjs --targets node18-win-x64 --output dist/PureDangoLauncher.exe
    
    test .cjs with:
    cd Documents/pure-dango 
    node dist/PureDango.cjs run test.pds

    test .exe with: 
    cd dist
    PureDangoLauncher.exe run ../test.pds
*/

process.title = "Pure Dango";

// declaring
declare const PACKAGE_NAME:          string | undefined;
declare const PACKAGE_VERSION:       string | undefined;
declare const PACKAGE_DESCRIPTION:   string | undefined;

// imports
import fs        from "fs";
import path      from "path";
import readline  from "readline";
import {Decimal} from "decimal.js";

import {parser}           from  "./core/parser.js";
import {tokenizer}        from  "./core/tokenizer.ts";
import {interpret, Scope} from  "./core/interpreter.ts";
import {buildBytecode}    from  "./core/compiler.js";

import * as utils from "./core/utils.ts";
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

// types
type Token =
{
    type:     string
    value?:   string
    row:      number
    column:   number
}

type BaseNode =
{
    type:      string
    row?:      number
    column?:   number
}

type NodeType =
| "Literal"
| "StringLiteral"
| "VariableReference"
| "UnaryExpression"
| "PostfixUnaryExpression"
| "BinaryExpression"
| "LogicalExpression"
| "FunctionCall"
| "Assignment"
| "NewAssignment"
| "NewDeclaration"
| "IfStatement"
| "ForStatement"
| "FunctionDeclaration"
| "FunctionExpression"
| "WhileStatement"
| "ReturnStatement"
| "ImportStatement"

type Literal = BaseNode &
{
    type:       NodeType
    value:      any
}

type VariableReference = BaseNode &
{
    type:       NodeType
    value:      string
}

type UnaryExpression =  BaseNode &
{
    type:       NodeType
    value:      string
    argument:   BodyNode[]
}
 
type BinaryExpression = BaseNode &
{
    type:       NodeType
    operator:   string
    left:       BodyNode
    right:      BodyNode
}

type FunctionCall = BaseNode &
{
    type:   NodeType
    name:   string
    args:   BodyNode[]
}

type Assignment = BaseNode &
{
    type:     NodeType
    name:     string
    value?:   BodyNode
}

type IfStatement = BaseNode &
{
    type:         NodeType
    condition:    BodyNode
    body:         BodyNode[]
    else:         BodyNode[] | null
}

type ForStatement = BaseNode &
{
    type:         NodeType
    initial:      BodyNode
    condition:    BodyNode
    update:       BodyNode
    body:         BodyNode[]
}

type WhileStatement = BaseNode &
{
    type:         NodeType
    condition:    BodyNode
    body:         BodyNode[]
}

type FunctionNode = BaseNode &
{
    type:         NodeType
    name:         null | string
    parameters:   string[]
    body:         BodyNode[]
    origin:       null | string
}

type ReturnStatement = BaseNode &
{
    type:       NodeType
    argument:   BodyNode | null
}

type ImportStatement = BaseNode &
{
    type:     NodeType
    path:     string
}

type BodyNode = 
| Literal
| VariableReference
| UnaryExpression
| BinaryExpression
| FunctionCall
| Assignment
| IfStatement
| ForStatement
| WhileStatement
| FunctionNode
| ReturnStatement
| ImportStatement

type Program =
{
    type:   "Program"
    body:   BodyNode[]
}

type ProgramOutput =
{
    scopes    : Scope
    stack     : (number | Decimal | bigint | string | null | undefined)[];
}

function pause(code: number = 0)
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

    let filename: string;
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

    const filePath: string = path.resolve(process.cwd(), filename);
    if (!fs.existsSync(filePath))
    {
        console.error(`File not found: ${filename}`);
        pause(1);
        return;
    }

    // greeting (might change later)
    console.log(`Welcome to ${packageJson.name} v${packageJson.version}`);
    console.log(`${packageJson.description} \n`);

    const cache:              string =   process.env.LOCALAPPDATA || process.cwd();
    const pureDangoDirectory: string =   path.join(cache, "pure-dango"); // get the normal path
    const cacheFolder:        string =   path.join(pureDangoDirectory, ".pdbccache"); // if the filepath is "C:/user/Documents/pure-dango" it will be: "C:/user/Documents/pure-dango/.pdbccache"

    if (!fs.existsSync(cacheFolder)) fs.mkdirSync(cacheFolder, {recursive: true}); // makes a file with the path of cacheFolder

    try
    {
        const FILE =       fs.readFileSync(filePath, "utf-8"); // Read the file given by the user
        const srcMTime =   fs.statSync(filePath).mtimeMs; 
        
        let BYTECODE : Array<string | number> | null = loadBytecode(cacheFolder, filename);

        if (!BYTECODE)
        {
            const TOKENS : Token[]       =   await run(tokenizer, state, FILE);
            const AST    : Program       =   await run(parser, state, TOKENS);
            BYTECODE                     =   await run(buildBytecode, state, AST); //console.log("Full bytecode:", JSON.stringify(BYTECODE, null, 2));
            const OUTPUT : ProgramOutput =   await run(interpret, state, BYTECODE, path.dirname(path.resolve(filePath)))
            //console.dir(OUTPUT, {depth: null, colors: false});

            saveBytecode(cacheFolder, BYTECODE as Array<string | number>, filename, srcMTime); //run(printResults, state, {TOKENS, AST, BYTECODE, INTERPRETEDCODE});
        }

        else await run(interpret, state, BYTECODE, path.dirname(path.resolve(filePath))); // console.dir(await run(interpret, state, BYTECODE, path.dirname(path.resolve(filePath))), {depth: null, colors: false});
        console.log(`\n Pure dango program finished after: ${state.time.toFixed(3)} milliseconds...`);
    }

    catch (error: unknown)
    {
        if (error instanceof Error)
        {
            console.error(error);
            console.error(`${error.name}: ${error.message}`);
        }
        pause(1);
    }
})()