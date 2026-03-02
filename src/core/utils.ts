import fs from "fs";
import path from "path";
import {utilsErrors} from "../runtime/errors.ts";
import Decimal from "decimal.js";

type RuntimeState =
{
    time:   number
}
type Bytecode = Array<string | number>;
type CacheFolder = string;

// stdlib
export const errorLengthCheck = (maxLength: number, list: any[], name: string) : void =>
{
    let plural = maxLength === 1 ? "argument": "arguments";
    if (list.length > maxLength) throw new utilsErrors.FunctionArgumentError(name, maxLength, plural);
}

export const bigIntPow = (base: bigint, exponent: bigint) : bigint =>
{
    if (exponent < 0n) throw new utilsErrors.NegativeExponentError(exponent);
    if (exponent === 0n && base === 0n) throw new EvalError(`0n raised to 0n can't be evaluated`);
    if (exponent === 0n) return 1n;

    let result = 1n;
    while (exponent > 0n)
    {
        if ((exponent & 1n) === 1n) result *= base;   // use exponentiation by squaring. "(exponent & 1) === 1n" checks if the exponent is an odd number
        base *= base;
        exponent >>= 1n;                              // integer division operator
    }
    
    return result;
}

export const format = (item: any) : string =>
{
    if (item === null || item === undefined) return "null";
    if (item instanceof Decimal)             return item.toString();
    if (Array.isArray(item))                 return "[" + item.map(format).join(", ") + "]";
    if (typeof item === "object")            return item.origin ?? "[object]";
    return removeQuotes(item.toString());
}

export const joinStrings = (list: any[]) : string =>
{
    return list.reduce((joined, item) => joined + format(item), "");
}

// index
export const run = async (functionToRun: Function, state: RuntimeState, ...args: any[]) : Promise<any> =>
{
    const start = performance.now();
    const output = await functionToRun(...args);
    const end = performance.now();
    const duration = end - start;

    state.time += duration;

    return output;
}

const printResult = (name: string, value: any) : void =>
{
    console.log(`${name}:`);
    console.dir(value, {depth: null, colors: true});
    console.log("\n");
}

export const printResults = (results: object) : void =>
{
    for (const [name, value] of Object.entries(results)) if (value !== null) printResult(`${name}`, value);
}

export const saveBytecode = (cacheFolder: CacheFolder, bytecode: Bytecode, srcFile: string, srcMTime: number) : void =>
{
    const outFile = path.join(cacheFolder, path.basename(srcFile, ".pds") + ".pdbc");
    fs.writeFileSync(
        outFile,
        JSON.stringify(
            {
                version: 1,
                source: path.basename(srcFile),
                bytecode,
                mtime: srcMTime
            },
            null,
            2,
        )
    );
}

export const loadBytecode = (cacheFolder: string, srcFile: string) : Bytecode | null =>
{
    const inFile = path.join(cacheFolder, path.basename(srcFile, ".pds") + ".pdbc");

    if (!fs.existsSync(inFile)) return null;

    const data = JSON.parse(fs.readFileSync(inFile, "utf-8"));
    const stats = fs.statSync(srcFile);
    const srcMTime = stats.mtimeMs;

    if (data.version !== 1 || data.mtime !== srcMTime) {
        console.log("recompile");
        return null;
    }

    return data.bytecode;
}

export const removeQuotes = (value: any) : any =>
{
    if (typeof value === "string")
    {
        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'")) ||
            (value.startsWith("`") && value.endsWith("`"))
        )
        {
            return value.slice(1, -1);
        }
    }

    return value;
}