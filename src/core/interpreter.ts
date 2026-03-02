import fs                                from "fs";
import path                              from "path";
import Decimal                           from "decimal.js";

import {tokenizer}                       from "./tokenizer.ts";
import {parser}                          from "./parser.js";
import {buildBytecode}                   from "./compiler.js";

import {syncFunctions, asyncFunctions}   from "../runtime/stdlib.ts";
import {runtimeErrors}                   from "../runtime/errors.ts";
import {isConstant}                      from "../runtime/globals.ts";
import {removeQuotes}                    from "./utils.ts";

type PureNumber        =   number | Decimal | bigint;
type BinaryFunction<T> =   (left: T, right: T) => any;
type Bytecode          =   Array<number | Decimal | string | null | undefined>;

function next(bytecode: Bytecode) : number | string | null | undefined | Decimal
{
    return bytecode[pointer++];
}

function getTrueValue(value: any)
{
    if (typeof value === "string")
    {
        try
        {
            value = getVariable(value);
        }
        catch {}; // do nothing
    }

    if (typeof value === "string" && value.trim() !== "" && !isNaN(Number(value)))
    {
        if (value.includes(".")) return new Decimal(value);
        if (/^[+-]?\d+$/.test(value))
        {
           const bigIntValue : bigint = BigInt(value);

            if (bigIntValue > BigInt(Number.MAX_SAFE_INTEGER) || bigIntValue < BigInt(Number.MIN_SAFE_INTEGER))
            {
                return bigIntValue;
            }

            return Number(value);
        }

        return new Decimal(value);   // fallback
    }

    return value;
}

function simpleStack(value: any) : void
{
    if       (value === null) stack.push(value);
    else if  (typeof value === "boolean") stack.push(value ? 1 : 0);
    else if  (typeof value === "bigint")  stack.push(value);
    else if  (!(value instanceof Decimal) && !Number.isInteger(value)) stack.push(new Decimal(value));
    else     stack.push(value);
}

function BinaryOperator() : Array<number | Decimal | bigint>
{
    if (stack.length < 2) throw new Error(`BinaryOperatorError: There must be 2 numbers pushed before using an operator on them.`);

    let right : any =  getTrueValue(stack.pop());
    let left  : any =  getTrueValue(stack.pop());

    if (typeof left === "string" || typeof right === "string") throw new TypeError(`Cannot perform arithmetic with string: "${typeof left === "string" ? left : right}"`)

    //console.log(`left: ${left}`);
    //console.log(`right: ${right}`);

    if (left === Infinity)  left   = BigInt(Number.MAX_SAFE_INTEGER);
    if (right === Infinity) right  = BigInt(Number.MAX_SAFE_INTEGER);

    if (left instanceof Decimal || right instanceof Decimal)
    {
        if (!(left instanceof Decimal)) left = new Decimal(left);
        if (!(right instanceof Decimal)) right = new Decimal(right);
        return [left, right];
    }

    if (
        (typeof left === "number" || typeof left === "bigint") && (!Number.isInteger(left) && typeof left !== "bigint") ||
        (typeof right === "number" || typeof right === "bigint") && (!Number.isInteger(right) && typeof right !== "bigint")
    )
    {
        left   = new Decimal(left);
        right  = new Decimal(right);
        return [left, right];
    }

    if (typeof left === "bigint" || typeof right === "bigint")
    {
        if (typeof left !== "bigint")  left = BigInt(left);
        if (typeof right !== "bigint") right = BigInt(right);
    }

    return [left, right];
}

function commandMapBinaryOperators(
    func:        BinaryFunction<number | bigint>,
    decimalFunc: BinaryFunction<Decimal>
)
{
    return () => {
        const [left, right] = BinaryOperator();
        let result : any;
        if (left instanceof Decimal || right instanceof Decimal)
        {
            //if (decimalFunc) console.log(`Used decimal func "${decimalFunc}" \n`);
            result = decimalFunc
                ? decimalFunc(left instanceof Decimal ? left: Decimal(left), right instanceof Decimal ? right: Decimal(right))
                : func(Number(left), Number(right));
        }
        else
        {
            //console.log(`Used normal func "${func}" \n`)
            result = func(left, right);
            if (typeof result === "bigint" && (result === 0n || result === 1n))
            {
                result = Number(result);
            }
        }

        stack.push(typeof result === "boolean" ? (result ? 1: 0): result);
    }
}

export class Scope
{
    variables : Map<string, any>;
    slotMap   : Map<string, number>;
    slots     : any[];
    parent    : Scope | null;

    constructor(parent : Scope | null = null)
    {
        this.variables    =  new Map();
        this.slotMap      =  new Map();   // fast lookup
        this.slots        =  [];
        this.parent       =  parent;

        if (!parent)
        {
            this.declare("true");
            this.set("true", 1);

            this.declare("false");
            this.set("false", 0);

            this.declare("null");
            this.set("null", null);
        }
    }

    declare(name: string) : void
    {
        if (this.variables.has(name)) throw new SyntaxError(`Identifier "${name}" has already been declared in this scope`);
        const slotIndex = this.slots.length;

        this.slots.push(null);   // push the default value
        this.slotMap.set(name, slotIndex);
        
        this.variables.set(name, null);
    }

    get(name: string) : any
    {
        const slot : any = this.slotMap.get(name);

        if (slot !== undefined) return this.slots[slot];

        if (this.parent) return this.parent.get(name);

        throw new ReferenceError(`"${name}" is not defined`);
    }

    set(name : string, value : any) : void
    {
        const slot : any = this.slotMap.get(name);

        if (slot !== undefined)
        {
            this.slots[slot] = value;
            return;
        }
        if (this.parent) return this.parent.set(name, value);

        throw new ReferenceError(`${name} is not defined`);
    }
}

function declareVariable(name: string)         : void  {return currentScope.declare(name);}
function setVariable(name: string, value: any) : void  {isConstant(name); currentScope.set(name, value);}
function getVariable(name: string)             : any   {return currentScope.get(name);}
function pushScope()                           : void  {currentScope = new Scope(currentScope)}   // make a new scope that is the child of the currentScope
function popScope()                            : void                 
{
    if (currentScope.parent === null) throw new Error("Cannot pop global scope");
    currentScope = currentScope.parent;
}

let currentScope : Scope =  new Scope(); 

// these 3 are set in interpret
let currentBaseDir : string  =   "";
let pointer        : number  =   0;
let stack          : any[]   =   [];

const importedFiles = new Set();   // used for opcode 26

const commandMap = new Map([
    [1, (bytecode : Bytecode) : void => {
            let value : any = next(bytecode);
            if (typeof value === "string" && /^[0-9]+$/.test(value))
            {
                const numberValue = Number(value);
                if (numberValue > Number.MAX_SAFE_INTEGER) value = BigInt(value);
                else if (numberValue > 1e12)               value = new Decimal(value);
                else value = numberValue;

                //console.log(`PUSHING: ${value}`);
                stack.push(value);
                return;
            }

            else if (typeof value === "string" && !isNaN(Number(value))) value = new Decimal(value);

            if (value === undefined) throw new runtimeErrors.MissingStackTokenError("PUSH");
            
            stack.push(value);
    }], // PUSH

    [2, (bytecode : Bytecode) : void  => {
        const name : any = next(bytecode);
        const slot : any = currentScope.slotMap.get(name);

        if (slot !== undefined) stack.push(currentScope.slots[slot]);
        else stack.push(getVariable(name));   // fallback
    }], // LOAD

    [3, (bytecode : Bytecode) : void => {
        const name  : any = next(bytecode);
        const value : any = stack.pop();
        const slot  : any = currentScope.slotMap.get(name);

        if (slot !== undefined) currentScope.slots[slot] = value;
        else setVariable(name, value);
    }], // STORE

    [4, (bytecode : Bytecode) : void => {
        const name : string = (next(bytecode)) as string;
        declareVariable(name);
    }], // ALLOC, make the value null when created

    [5, commandMapBinaryOperators(
        (left, right) => {
            if (typeof left === "bigint" || typeof right === "bigint") return BigInt(left) + BigInt(right);
            return left + right;
        },
        (left, right) => left.add(right))
    ],  // ADD

    [6, commandMapBinaryOperators(
        (left, right) => {
            if (typeof left === "bigint" || typeof right === "bigint") return BigInt(left) - BigInt(right);
            return left - right;
        }, 
        (left, right) => left.sub(right))
    ],  // SUB
    
    [7, commandMapBinaryOperators(
        (left, right) => {
            if (typeof left === "bigint" || typeof right === "bigint") return BigInt(left) * BigInt(right);
            return left * right;
        },
        (left, right) => left.mul(right))
    ],  // MUL
    
    [8, commandMapBinaryOperators(
        (left : number | bigint, right : any) => {
            if (right === 0 || (right instanceof Decimal && right.isZero())) throw new runtimeErrors.DivisionByZero(left, right);
            if (typeof left === "bigint" || typeof right === "bigint") return BigInt(left) / BigInt(right);
            return left / right;
        },
        (left, right) => {
            if (right.isZero()) throw new runtimeErrors.DivisionByZero(left, right);
            return left.div(right);
    })], // DIV

    [9, commandMapBinaryOperators(
        (left, right) => {
            if (typeof left === "bigint" || typeof right === "bigint") return BigInt(left) % BigInt(right);
            return left % right;
        }, 
        (left, right) => left.mod(right))
    ], // MOD

    [10, async (bytecode) : Promise<void> => {
        let rawNextBytecode = next(bytecode);
        if (typeof rawNextBytecode !== "string") throw new EvalError(`The name of a function can only be type String, but got "${rawNextBytecode}"`);
        const functionName: string = rawNextBytecode as string;

        rawNextBytecode = next(bytecode);
        if (rawNextBytecode === undefined || rawNextBytecode === null || typeof rawNextBytecode === "string") throw new EvalError(`The amount of arguments can only be type Decimal, Number, or BigInt but got "${rawNextBytecode}"`);
        const argAmount : PureNumber = rawNextBytecode as PureNumber;

        const args : any[] = [];
        for (let i = 0; i < (argAmount as number); i++)
        {
            args.unshift(stack.pop());
        }

        let func = syncFunctions[functionName as keyof typeof syncFunctions];   // as keyof typeof syncFunctions makes TS stop complaining adfjs;lkjf
        if (func)
        {
            const result = func(stack, getTrueValue, ...args);

            if (result !== undefined) stack.push(result);
            else stack.push(null);   // return something

            return;
        }

        func = asyncFunctions[functionName as keyof typeof asyncFunctions];
        if (func)
        {
            const result = await func(stack, getTrueValue, ...args);

            if (result !== undefined) stack.push(result);
            else stack.push(null);

            return;
        }

        let functionObject = null;
        if (typeof functionName === "string")
        {
            try     {functionObject = currentScope.get(functionName);}
            catch   {}
        }

        if (functionObject === null || functionObject === undefined)
        {
            const top : any = stack.pop();
            
            if (top?.bytecode && Array.isArray(top.parameters))
            {
                functionObject = top;
                args.shift();
            }
            else throw new runtimeErrors.FunctionError(functionName);
        }

        const savedPointer : number  = pointer;
        const savedScope   : Scope   = currentScope;

        //console.log("Looking up func, currentScope has:", [...currentScope.slotMap.keys()]);

        // if functionObject has a closure scope, use that as the parent for currentScope. Else, use currentScope as the parent for the new Scope Object
        currentScope = new Scope(functionObject.closureScope ?? currentScope);

        functionObject.parameters.forEach((parameter : string, i : number) => {
            declareVariable(parameter);
            setVariable(parameter, args[i] ?? undefined);
        });

        pointer = 0;

        // use my version of runBytecode so we don't have bugs.
        let hasReturned : boolean = false;
        while (pointer < functionObject.bytecode.length)
        {
            const operator = functionObject.bytecode[pointer++];

            if (operator === 25)
            { 
                hasReturned = true;

                currentScope = savedScope;

                const returnValue : any = stack.pop();
                stack.push(returnValue);

                break;
            } // RETURN

            const command = commandMap.get(operator);

            if (!command)
                throw new Error(`Unknown operator code: "${operator}"`);

            await command(functionObject.bytecode);
        }

        if (!hasReturned) 
        {
            if (currentScope.parent) currentScope = currentScope.parent;
            stack.push(null);
        }

        pointer = savedPointer;
    }], // CALL

    [11, () : void => {
        let value = stack.pop();
        if (value instanceof Decimal) simpleStack(value.neg());
        simpleStack(-value);
    }], // NEG

    [12, () : void => {
        let value = stack.pop();
        if (value instanceof Decimal) value = value.isZero() ? 1: 0;
        simpleStack(value ? 0: 1);
    }], // NOT

    [13, () : void => {
        let value = stack.pop();
        if (value instanceof Decimal) value = BigInt(value.toFixed(0)); // ~ can't take floats or decimals
        simpleStack(~value);
    }], // BITNOT

    [14, (bytecode) : void => {
        const target : any = next(bytecode);
        if (typeof target !== "number") throw new runtimeErrors.InternalError(`Target after opcode 14 (JMP) should be type "Number" but got "${target}"`);
        
        pointer = target;
    }], // JMP

    [15, (bytecode) : void => {
        const target : any    = next(bytecode);
        if (typeof target !== "number") throw new runtimeErrors.InternalError(`Target after opcode 15 (JZ) should be type "Number" but got "${target}"`);

        const value  : 0 | 1  = stack.pop();
        if (value !== 0 && value !== 1) throw new runtimeErrors.InternalError(`Value in stack should be 0 or 1 but got "${value}"`);
        
        if (value === 0) pointer = target;   // skip the loop or statement if the condition is false
    }], // JZ

    [16, commandMapBinaryOperators((left, right) => left === right,   (left, right) => left.eq(right))],    // EQ
    [17, commandMapBinaryOperators((left, right) => left !== right,   (left, right) => !left.eq(right))],   // NE
    [18, commandMapBinaryOperators((left, right) => left > right,     (left, right) => left.gt(right))],    // GT
    [19, commandMapBinaryOperators((left, right) => left < right,     (left, right) => left.lt(right))],    // LT
    [20, commandMapBinaryOperators((left, right) => left >= right,    (left, right) => left.gte(right))],   // GTE
    [21, commandMapBinaryOperators((left, right) => left <= right,    (left, right) => left.lte(right))],   // LTE
    
    [22, () : void => {
        if (stack.length === 0) throw new runtimeErrors.StackError();
        stack.pop()
    }], // POP

    [23, () : void => pushScope()],   // PUSHSCP
    [24, () : void => popScope()],    // POPSCP

    [25, () : void => {throw new runtimeErrors.InternalError(`Found opcode 25 (RETURN) that wasn't handled by opcode 10 (CALL)`);}],            // RETURN (handled in CALL/opcode 10)

    [26, async () : Promise<void> => {
        let absolutePath : any = removeQuotes(stack.pop());
        if (typeof absolutePath !== "string") throw new TypeError(`Path after keyword "import" must be string but got: "${absolutePath}"`);
        absolutePath = path.resolve(currentBaseDir, absolutePath);

        if (importedFiles.has(absolutePath)) return;
        importedFiles.add(absolutePath);
        let file : string;

        try
        {
            file = fs.readFileSync(absolutePath, "utf8");
        }
        catch
        {
            throw new runtimeErrors.FileNotFoundError(absolutePath);
        }

        if (!file) throw new runtimeErrors.FileNotFoundError(absolutePath);

        const tokens = tokenizer(file);
        const ast = parser(tokens);
        const importedBytecode = buildBytecode(ast);

        const savedPointer = pointer;

        pointer = 0;
        while (pointer < importedBytecode.length)
        {
            const operator = importedBytecode[pointer++];

            const command = commandMap.get(operator);
            if (!command) throw new Error(`Unknown operator code: "${operator}"`);
            await command(importedBytecode);
        }

        pointer = savedPointer;
    }],   // EXEC

    [27, () : void => {
        const template = stack.pop();   // get the current function
        stack.push({
            ...template,
            closureScope: currentScope   // add closureScope to know the function's scope.
        });
    }],   // MKFUNC

    [28, (bytecode: Bytecode) : void => {
        const count : number = next(bytecode) as number;
        const elements : any[] = [];

        for (let i = 0; i < count; i++) elements.unshift(stack.pop());

        stack.push(elements);
    }],   // MKARR

    [29, () : void => {
        const index : any = getTrueValue(stack.pop());
        const array : any = getTrueValue(stack.pop());

        if (typeof array === "string")
        {
            if (typeof index !== "number") throw new TypeError(`String index must be a number. But got "${index}"`);
            const character = removeQuotes(array)[index] ?? null;
            stack.push(character !== null ? `"${character}"` : null);
            return;
        }

        if (!Array.isArray(array))     throw new TypeError(`Cannot index non-array value: "${array}"`);
        if (typeof index !== "number") throw new TypeError(`Array index must be a number but got "${index}"`);

        const result = array[index] ?? null;
        stack.push(result);
    }],   // ARRGET
    
    [30, () : void => {
        const index : any = getTrueValue(stack.pop());
        const array : any = getTrueValue(stack.pop());
        const value : any = stack.pop();

        if (!Array.isArray(array))     throw new TypeError(`Cannot index non-array value: "${array}"`);
        if (typeof index !== "number") throw new TypeError(`Array index must be a number but got "${index}"`);

        array[index] = value;
    }]
]);

async function runBytecode(bytecode: Bytecode)
{   
    const operator : any = bytecode[pointer++];
    if (typeof operator !== "number") throw new runtimeErrors.InternalError(`operator should be a number but got "${operator}"`);
    //console.log(`[${pointer-1}] OP:${operator} Stack:${JSON.stringify(stack.slice(-3))`);
    const command = commandMap.get(operator);

    if (command === undefined) throw new Error(`Unknown operator code: "${operator}"`);

    await command(bytecode);
}

export async function interpret(bytecode: Bytecode, baseDir : string = process.cwd())
{
    pointer          = 0;
    stack            = [];
    currentBaseDir   = baseDir;
    importedFiles.clear();

    while (pointer < bytecode.length) await runBytecode(bytecode);

    return {
        stack,
        scopes: currentScope
    };
}