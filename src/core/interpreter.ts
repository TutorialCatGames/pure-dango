import fs      from "fs";
import path    from "path";
import {init}  from "gmp-wasm";

import {parser}         from "./parser/main";
import {buildBytecode}  from "./compiler";
import {tokenizer}      from "./tokenizer/tokenizer";

import {isConstant}    from "../runtime/globals";
import {runtimeErrors} from "../runtime/errors";

import {syncFunctions, asyncFunctions, errorTemplate} from "../runtime/stdlib";

import {loadBytecode, saveBytecode} from "./utils";

type PureNumber        =   number | bigint;
type BinaryFunction<T> =   (left: T, right: T) => any;
type Bytecode          =   Array<number | string | null | undefined>;

type CallFrame = 
{
    bytecode      : Bytecode,
    pointer       : number,
    savedScope    : Scope,
    returnMode    : "function" | "super" | "constructor" | "execute",
    instance?     : any,
    functionName  : string,
    file          : string,
    importer?     : string,
    pendingMethod? :
    {   
        methodBytecode   : Bytecode,
        methodKey        : string,
        methodParameters : string[],
        methodArgs       : any[],
        methodScope      : Scope,
        returnBytecode?  : Bytecode,
        returnPointer?   : number,
        returnScope?     : Scope,
        isStaticCall?    : true,
    }
    savedBaseDir? : string,

    line          : number,
    column        : number,
};

let g: any;
export let gmpInstance: any;
export let gmpPrecision: number = 128; 

export async function initGMP()  // default
{
    gmpInstance = await init();
    g = gmpInstance.getContext({precisionBits: gmpPrecision});
}

export function setPrecision(bits: number) 
{
    gmpPrecision = bits;
    if (gmpInstance)
    {
        g = gmpInstance.getContext({precisionBits: bits});
        try 
        {
            let test = g.Float(13.1);
        }
        catch(e)
        {
            errorTemplate(`setPrecision`, `float failed with precision ${bits}, got "${e}"`);
        }
    }
}

export const GF = (x: any): GFloat => 
{
    if (x instanceof GFloat) 
    {
        if (x.inner.precisionBits === gmpPrecision) 
            return x;
        const digits = Math.ceil(x.inner.precisionBits / 3.32);
        return new GFloat(g.Float(x.inner.toFixed(digits)));
    }

    return new GFloat(g.Float(String(x)));
};
export const isGFloat   = (x : any) : x is GFloat => x instanceof GFloat;
export const isGWrapper = (x : any) : boolean => 
    typeof x.rndMode === "number" &&
    typeof x.precisionBits === "number" && 
    typeof x.radix === "number" && 
    typeof x.mpfr_t === "number";

export function BigIntToGFloat(x : bigint) : GFloat
{
    if (x === 0n) 
        return new GFloat(g.Float("0"));

    const isNegative = x < 0n;
    const abs        = isNegative ? -x : x;

    function convert(n: bigint): any
    {
        if (n < 1000000000000000n)
            return g.Float(n.toString());

        const bits  = n.toString(2).length;
        const half  = BigInt(bits >> 1);
        const shift = 1n << half;

        const hi = n >> half;
        const lo = n & (shift - 1n);

        const hiF    = convert(hi);
        const loF    = convert(lo);
        const shiftF = g.Float("2").pow(g.Float(half.toString()));

        return hiF.mul(shiftF).add(loF);
    }

    const result = convert(abs);
    return new GFloat(isNegative ? result.neg() : result);
}

export function BigIntDivToGFloat(numerator: bigint, denominator: bigint): GFloat
{
    if (denominator === 0n)
        throw new runtimeErrors.DivisionByZero(numerator, denominator);

    const isNegative = (numerator < 0n) !== (denominator < 0n);
    const absNum     = numerator   < 0n ? -numerator   : numerator;
    const absDen     = denominator < 0n ? -denominator : denominator;

    const binding = gmpInstance.binding;

    function toMpz(n: bigint): number
    {
        let hex = n.toString(16);
        if (hex.length % 2) 
            hex = "0" + hex;

        const bytes = new Uint8Array(hex.length / 2);
        for (let i = 0; i < bytes.length; i++)
            bytes[i] = parseInt(hex.slice(i*2, i*2+2), 16);

        const wasmBuf = binding.malloc(bytes.length);
        binding.mem.set(bytes, wasmBuf);

        const mpz     = binding.mpz_t();
        binding.mpz_init(mpz);
        binding.mpz_import(mpz, bytes.length, 1, 1, 1, 0, wasmBuf);
        
        binding.free(wasmBuf);
        return mpz;
    }

    const mpzNum = toMpz(absNum);
    const mpzDen = toMpz(absDen);

    const numBits = BigInt(binding.mpz_sizeinbase(mpzNum, 2));
    const denBits = BigInt(binding.mpz_sizeinbase(mpzDen, 2));
    const shift   = (denBits > numBits ? denBits - numBits : 0n) + BigInt(gmpPrecision);

    const mpzShifted = binding.mpz_t();
    binding.mpz_init(mpzShifted);
    binding.mpz_mul_2exp(mpzShifted, mpzNum, Number(shift));

    const mpzResult = binding.mpz_t();
    binding.mpz_init(mpzResult);
    binding.mpz_tdiv_q(mpzResult, mpzShifted, mpzDen);

    binding.mpz_clear(mpzNum);     binding.mpz_t_free(mpzNum);
    binding.mpz_clear(mpzDen);     binding.mpz_t_free(mpzDen);
    binding.mpz_clear(mpzShifted); binding.mpz_t_free(mpzShifted);

    const mpfr = binding.mpfr_t();
    binding.mpfr_init2(mpfr, Number(shift) + 64);
    binding.mpfr_set_z(mpfr, mpzResult, 0);              // load integer
    binding.mpfr_div_2ui(mpfr, mpfr, Number(shift), 0); // divide by 2^shift

    binding.mpz_clear(mpzResult); binding.mpz_t_free(mpzResult);

    const result = g.Float(0);
    binding.mpfr_set(result.mpfr_t, mpfr, 0);
    binding.mpfr_clear(mpfr); binding.mpfr_t_free(mpfr);

    return new GFloat(isNegative ? result.neg() : result);
}

let callStack      : CallFrame[] = [];
let activeBytecode : Bytecode    = [];

function next(bytecode: Bytecode) : any
{
    return bytecode[pointer++];
}

function getTrueValue(value : any)
{
    if (isGFloat(value)) 
        return value;

    if (value === "__INIT__")
        return 0;

    if (typeof value === "string" && value.trim() !== "" && !isNaN(Number(value)))
    {
        if (value.includes(".")) 
            return GF(value);
        if (/^[+-]?\d+$/.test(value))
            return BigInt(value);

        return GF(value);   // fallback
    }

    return value;
}

function simpleStack(value : any) : void
{
    if (value === null || value === undefined) 
        stack.push(value);

    else if (typeof value === "boolean") 
        stack.push(value ? 1 : 0);
    else if (typeof value === "bigint")  
        stack.push(value);

    else if (!isGFloat(value) && !Number.isInteger(value)) 
        stack.push(GF(value));
    
    else 
        stack.push(value);
}

function unwrapInstance(value: any): any
{
    if (value?.type === "class" && value?.isInstance && value?.properties?.__INIT__ !== undefined)
        return unwrapInstance(value.properties.__INIT__);
    
    return value;
}

function BinaryOperator(type : string) : Array<any>
{
    if (stack.length < 2) 
        errorTemplate(`BinaryOperator`, `there must be two numbers pushed before using an operator on them.`);

    const r = stack.pop();
    const l = stack.pop();

    if (typeof l === "bigint" && typeof r === "bigint")
        return [l, r];

    if (isGFloat(l) && isGFloat(r))
    {
        if (l.inner.precisionBits !== gmpPrecision || r.inner.precisionBits !== gmpPrecision)
            return [GF(l), GF(r)];
        return [l, r];
    }

    let right : any = unwrapInstance(getTrueValue(r));
    let left  : any = unwrapInstance(getTrueValue(l));

    if (left === null || left === undefined || right === null || right === undefined)
        return [left, right];
    
    if ((typeof left === "string" || typeof right === "string") && type !== "comparison") 
        errorTemplate(`BinaryOperator`, `left and right parameter must be type BigInt or Float, got "${typeof left === "string" ? left : right}"`);

    if (left === Infinity)  
        left = BigInt(Number.MAX_SAFE_INTEGER);
    if (right === Infinity) 
        right = BigInt(Number.MAX_SAFE_INTEGER);

    if (isGFloat(left)|| isGFloat(right))
    {
        left  = GF(left);
        right = GF(right);
        return [left, right];
    }

    if (
        (typeof left  === "number" && !Number.isInteger(left)) ||
        (typeof right === "number" && !Number.isInteger(right))
    )
    {
        left  = GF(left);
        right = GF(right);
        return [left, right];
    }

    if (typeof left === "bigint" || typeof right === "bigint")
    {
        if (typeof left !== "bigint")  
            left = BigInt(left);
        if (typeof right !== "bigint") 
            right = BigInt(right);
    }

    return [left, right];
}

function commandMapBinaryOperators(
    func        : BinaryFunction<number | bigint>,
    GMPFunc     : BinaryFunction<any>,
    type        : string
)
{
    return () => 
    {
        const r = stack.pop();
        const l = stack.pop();

        if (typeof l === "bigint" && typeof r === "bigint")
        {
            stack.push(func(l, r));
            return;
        }
        if (isGFloat(l) && isGFloat(r))
        {
            stack.push(GMPFunc(l, r));
            return;
        }

        stack.push(l);
        stack.push(r);
        let [left, right] : Array<any> = BinaryOperator(type);

        if (left === null || left === undefined || right === null || right === undefined)
        {
            stack.push(undefined);
            return;
        }

        const result = isGFloat(left) || isGFloat(right) ? GMPFunc(left, right) : func(left, right);
        stack.push(typeof result === "boolean" ? (result ? 1 : 0) : result);
    }
}

const methodCache = new WeakMap<object, Record<string, any>>();
function collectMethods(classDefinition: any): Record<string, any> 
{
    if (methodCache.has(classDefinition))
        return methodCache.get(classDefinition)!;

    let methods: Record<string, any> = {};
    if (classDefinition.superclass) 
    {
        try 
        {
            const superDef = currentScope.get(classDefinition.superclass);
            if (superDef?.type === "class")
                methods = { ...collectMethods(superDef) };
        } 
        catch {}
    }

    for (const method of Object.values(classDefinition.methods ?? {}) as any[])
        methods[method.name] = method;

    methodCache.set(classDefinition, methods);
    return methods;
}

function evaluateDefault(defaultBytecode : Bytecode): any
{
    const savedPointer     = pointer;
    const savedStack       = [...stack];
    const savedBytecode    = activeBytecode;
    const savedScope    = currentScope;

    stack          = [];
    pointer        = 0;
    activeBytecode = defaultBytecode;

    while (pointer < defaultBytecode.length)
    {
        const operator = defaultBytecode[pointer++];
        if (typeof operator === "number" && commands[operator])
            commands[operator]!(defaultBytecode);
    }

    const result = stack.pop();

    stack          = savedStack;
    pointer        = savedPointer;
    activeBytecode = savedBytecode;
    currentScope   = savedScope;

    return result;
}

export class GFloat
{
    readonly inner: any;
    constructor(inner: any)
    {
        this.inner = inner;
    }
}

export class Scope
{
    variables : Map<string, any>;
    slotMap   : Map<string, number>;
    slots     : any[];
    parent    : Scope | undefined;

    constructor(parent : Scope | undefined = undefined)
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
            
            this.declare("undefined");
            this.set("undefined", undefined);
        }
    }

    declare(name: string) : void
    {
        if (this.variables.has(name)) 
            errorTemplate(`declare`, `identifier "${name}" has already been declared in this scope`);

        const slotIndex = this.slots.length;

        this.slots.push(undefined);   // push the default value
        this.slotMap.set(name, slotIndex);
        
        this.variables.set(name, undefined);
    }

    get(name: string) : any
    {
        let scope: Scope | undefined = this;
        while (scope)
        {
            const slot = scope.slotMap.get(name);
            if (slot !== undefined) 
                return scope.slots[slot];

            scope = scope.parent;
        }
        errorTemplate("get", `"${name}" is not defined`);
    }

    set(name: string, value: any): void
    {
        let scope: Scope | undefined = this;
        while (scope)
        {
            const slot = scope.slotMap.get(name);
            if (slot !== undefined)
            {
                scope.slots[slot] = value;
                return;
            }
            scope = scope.parent;
        }
        errorTemplate("set", `"${name}" is not defined`);
    }
}

function declareVariable(name: string)         : void  {return currentScope.declare(name);}
function setVariable(name: string, value: any) : void  {isConstant(name); currentScope.set(name, value);}
function getVariable(name: string)             : any   {return currentScope.get(name);}
function pushScope()                           : void  {currentScope = new Scope(currentScope)}   // make a new scope that is the child of the currentScope
function popScope()                            : void                 
{
    if (currentScope.parent === undefined) 
        errorTemplate(`popScope`, "cannot pop global scope");

    currentScope = currentScope.parent;
}

let currentScope : Scope =  new Scope(); 

let line   : number = 0;
let column : number = 0;

let file : string = "";

// these 3 are set in interpret
let currentBaseDir : string  =   "";
let pointer        : number  =   0;
let stack          : any[]   =   [];

export const getBaseDir = () => currentBaseDir;

const importedFiles = new Set();   // used for opcode 26

const commands : Array<Function | undefined> =
[
    undefined,

    (bytecode : Bytecode) : void =>
    {
        let value : any = next(bytecode);
        if (typeof value === "string" && /^[0-9]+$/.test(value))
        {
            value = BigInt(value);
            stack.push(value);
            return;
        }

        else if (typeof value === "string" && value !== "" && !isNaN(Number(value))) 
            value = GF(value);

        if (value === undefined)
            throw new runtimeErrors.MissingStackTokenError("PUSH");
        
        stack.push(value);
    },   // PUSH

    (bytecode : Bytecode) : void  =>
    {
        const name : any = next(bytecode);
        const slot : any = currentScope.slotMap.get(name);
        const result = slot !== undefined ? currentScope.slots[slot] : getVariable(name);
        
        if (typeof result === "number")
            stack.push(String(result).includes(".") ? GF(result) : BigInt(result));
        else
            stack.push(result);
    },   // LOAD

    (bytecode : Bytecode) : void =>
    {
        const name  : any = next(bytecode);
        const value : any = stack.pop();
        
        const slot  : any = currentScope.slotMap.get(name);
        if (slot !== undefined) 
            currentScope.slots[slot] = value;
        else 
            setVariable(name, value);   // fallback
    },   // STORE

    (bytecode : Bytecode) : void =>
    {
        const name : string = (next(bytecode)) as string;
        declareVariable(name);
    },   // ALLOC, make the value undefined when created

    commandMapBinaryOperators
    (
        (left, right) => BigInt(left) + BigInt(right),
        (left, right) => new GFloat(left.inner.add(right.inner)),
        "arithmetic"
    ),   // ADD

    commandMapBinaryOperators
    (
        (left, right) => BigInt(left) - BigInt(right), 
        (left, right) => new GFloat(left.inner.sub(right.inner)),
        "arithmetic"
    ),   // SUB
    
    commandMapBinaryOperators
    (
        (left, right) => BigInt(left) * BigInt(right),
        (left, right) => new GFloat(left.inner.mul(right.inner)),
        "arithmetic"
    ),   // MUL
    
    commandMapBinaryOperators
    (
        (left, right) =>
        {
            if (right === 0n || (isGFloat(right) && right.inner.isZero())) 
                throw new runtimeErrors.DivisionByZero(left, right);

            return BigInt(left) / BigInt(right);
        },
        (left, right) =>
        {
            if (right.inner.isZero()) 
                throw new runtimeErrors.DivisionByZero(left, right);
            
            return new GFloat(left.inner.div(right.inner));
        },
        "arithmetic"
    ),   // DIV

    commandMapBinaryOperators
    (
        (left, right) => BigInt(left) % BigInt(right),
        (left, right) => new GFloat(left.inner.fmod(right.inner)),
        "arithmetic"
    ), // MOD

    async (bytecode : Bytecode) : Promise<void> =>
    {
        const callLine   : number = line;
        const callColumn : number = column;

        let rawNextBytecode = next(bytecode);
        if (typeof rawNextBytecode !== "string") 
            errorTemplate("CALL", `the name of a function must be a String, got "${rawNextBytecode}"`);

        const functionName: string = rawNextBytecode as string;
        
        rawNextBytecode = next(bytecode);
        if (rawNextBytecode === undefined || rawNextBytecode === null || typeof rawNextBytecode === "string")
            errorTemplate("CALL", `the amount of arguments must be type Float or BigInt, got "${rawNextBytecode}"`);

        const argumentAmount : PureNumber = rawNextBytecode as PureNumber;
        const args : any[] = [];
        for (let i = 0; i < (argumentAmount as number); i++)
        {
            const value : any = stack.pop();
            if (value?.__spread__)
                args.unshift(...value.value);
            else
                args.unshift(value);
        }

        if (functionName === "super")
        {
            const superClassName : any = currentScope.get("1345__superClass");
            if (!superClassName)
                errorTemplate("CALL", `"super" called outside of a class constructor`);

            const superClass : any = currentScope.get(superClassName);
            if (!superClass || superClass.type !== "class")
                errorTemplate("CALL", `superclass "${superClassName}" is not a class`);

            const instance : any = currentScope.get("this");

            if (superClass.methods["constructor"])
            {
                const superConstructor : any = superClass.methods["constructor"];

                const savedPointer : number = pointer;
                const savedScope   : Scope  = currentScope;

                currentScope = new Scope(superConstructor.closureScope ?? currentScope);
                currentScope.declare("this");
                currentScope.set("this", instance);

                const superMethods = collectMethods(superClass);
                for (const method of Object.values(superMethods) as any[])
                {
                    if (!instance.methods[method.name] || instance.methods[method.name].bytecode === method.bytecode)
                    {
                        instance.methods[method.name] =
                        {
                            ...method,
                            thisContext: instance
                        };
                    }
                }

                superConstructor.parameters.forEach
                (
                    (parameter: any, i: number) =>
                    {
                        declareVariable(parameter.name);
                        setVariable(parameter.name, args[i] !== undefined ? args[i] : (parameter.default !== null ? evaluateDefault(parameter.default) : undefined));
                    }
                );
                
                callStack.push
                (
                    {
                        bytecode     : activeBytecode,
                        pointer      : savedPointer,
                        savedScope,
                        returnMode   : "super",
                        functionName : functionName || "<anonymous>",
                        file,
                        line,
                        column
                    }
                );

                activeBytecode = superConstructor.bytecode;
                pointer        = 0;
            }

            return;
        }

        let func = syncFunctions[functionName as keyof typeof syncFunctions];   // as keyof typeof syncFunctions makes TS stop complaining adfjs;lkjf
        if (func)
        {
            const result = func(stack, getTrueValue, ...args);

            if (result !== undefined)
                stack.push(result);
            else
                stack.push(undefined);   // return something

            return;
        }

        func = asyncFunctions[functionName as keyof typeof asyncFunctions];
        if (func)
        {
            const result = await func(stack, getTrueValue, ...args);

            if (result !== undefined) 
                stack.push(result);
            else
                stack.push(undefined);

            return;
        }

        let functionObject = undefined;
        if (typeof functionName === "string")
        {
            try   {functionObject = currentScope.get(functionName);}
            catch {}
        }

        if (functionObject === undefined)
        {
            const top : any = stack[stack.length - 1];   // peek
            
            if (top !== null && top !== undefined && typeof top === "object" && top.bytecode)
                functionObject = stack.pop();
            else
                throw new runtimeErrors.FunctionError(functionName);
        }

        if (functionObject.type === "class" && !functionObject.isMethod)
            errorTemplate("CALL", `"${functionObject.name}" is a class and must be instantiated with "inst"`);

        const savedPointer : number  = pointer;
        const savedScope   : Scope   = currentScope;

        // if functionObject has a closure scope, use that as the parent for currentScope. Else, use currentScope as the parent for the new Scope Object
        currentScope = new Scope(functionObject.closureScope ?? currentScope);

        if (functionObject.staticClassName && !functionObject.thisContext)
        {
            const classDefinition = currentScope.get(functionObject.staticClassName);
            const allMethods      = collectMethods(classDefinition);
            const hasConstructor  = !!classDefinition.methods["constructor"];

            const init = args[0];

            const tempInstance : any =
            {
                type       : "class",
                methods    : {},
                properties : hasConstructor ? {__INIT__: init} : {},
                isInstance : true,
                class      : classDefinition.name,
                superclass : classDefinition.superclass
            };

            for (const method of Object.values(allMethods) as any[])
            {
                tempInstance.methods[method.name] =
                {
                    ...method,
                    thisContext: tempInstance
                };
            }

            functionObject = 
            {
                ...functionObject, 
                thisContext: tempInstance 
            };

            args.shift();

            currentScope.declare("this");
            currentScope.set("this", init);
        }

        if (functionObject.thisContext && !functionObject.staticClassName)
        {
            currentScope.declare("this");
            currentScope.set("this", functionObject.thisContext);
        }

        functionObject.parameters.forEach((parameter : any, i : number) => 
        {
            if (parameter.rest)
            {
                declareVariable(parameter.name);
                setVariable(parameter.name, args.slice(i));
            }
            else
            {
                declareVariable(parameter.name);

                const value = args[i] !== undefined 
                    ? args[i] 
                    : (parameter.default !== null ? evaluateDefault(parameter.default) : undefined);
                    
                setVariable(parameter.name, value);
            }
        });

        const resolvedName = functionName || functionObject?.name || "<anonymous>";
        callStack.push
        (
            {
                bytecode     : activeBytecode,
                pointer      : savedPointer,
                savedScope,
                returnMode   : "function",
                functionName : resolvedName,
                file,
                line         : callLine,
                column       : callColumn
            }
        );

        activeBytecode = functionObject.bytecode;
        pointer        = 0;
    },   // CALL

    () : void =>
    {
        let value = unwrapInstance(stack.pop());
        if (isGFloat(value))
        {
            simpleStack(new GFloat(value.inner.neg()));
            return;
        }
        simpleStack(-value);
    },   // NEG

    () : void =>
    {
        let value = unwrapInstance(stack.pop());
        if (isGFloat(value))
            value = value.inner.isZero() ? 0 : 1;

        simpleStack(value ? 0: 1);
    },   // NOT

    () : void => 
    {
        let value = unwrapInstance(stack.pop());
        if (isGFloat(value)) 
            value = BigInt(value.inner.toFixed(0)); // ~ can't take floats

        simpleStack(~value);
    },   // BITNOT

    (bytecode : Bytecode) : void => 
    {
        const target : any = next(bytecode);
        if (typeof target !== "number") 
            throw new runtimeErrors.InternalError(`target after opcode 14 (JMP) should be type "Number" but got "${target}"`);
        
        pointer = target;
    },   // JMP

    (bytecode : Bytecode) : void =>
    {
        const target : any    = next(bytecode);
        if (typeof target !== "number") 
            throw new runtimeErrors.InternalError(`target after opcode 15 (JZ) should be type "Number" but got "${target}"`);

        const raw   : any = stack.pop();
        const value : any = getTrueValue(raw);
        if (!value || value === "undefined" || value === "null") pointer = target;   // skip the loop or statement if the condition is false
    },   // JZ

    commandMapBinaryOperators((l, r) => l === r,  (l, r) => l.inner.isEqual(r.inner),         "comparison"),   // EQ
    commandMapBinaryOperators((l, r) => l !== r,  (l, r) => !l.inner.isEqual(r.inner),        "comparison"),   // NE
    commandMapBinaryOperators((l, r) => l > r,    (l, r) => l.inner.greaterThan(r.inner),     "comparison"),   // GT
    commandMapBinaryOperators((l, r) => l < r,    (l, r) => l.inner.lessThan(r.inner),        "comparison"),   // LT
    commandMapBinaryOperators((l, r) => l >= r,   (l, r) => l.inner.greaterOrEqual(r.inner),  "comparison"),   // GTE
    commandMapBinaryOperators((l, r) => l <= r,   (l, r) => l.inner.lessOrEqual(r.inner),     "comparison"),   // LTE

    () : void =>
    {
        if (stack.length === 0)
            throw new runtimeErrors.StackError();
        stack.pop()
    }, // POP

    () : void => pushScope(),   // PUSHSCP
    () : void => popScope(),    // POPSCP

    () : void =>
    {
        throw new runtimeErrors.InternalError(`found opcode 25 (RETURN) that wasn't handled by opcode 10 (CALL)`);
    },   // RETURN (handled in CALL/opcode 10)

    async () : Promise<void> =>
    {
        let absolutePath : any = stack.pop();
        if (typeof absolutePath !== "string") 
            errorTemplate("EXEC", `path after keyword "import" must be type String, got "${absolutePath}"`);

        absolutePath = path.resolve(currentBaseDir, absolutePath);

        if (importedFiles.
            has(absolutePath)) return;
        importedFiles.add(absolutePath);
        let fileContent : string;

        fileContent = fs.readFileSync(absolutePath, "utf8");

        if (!fileContent)
        {
            console.warn(`Warning: imported file "${absolutePath}" is empty`);
            return;
        }

        const cacheDirectory = path.join(
            process.env.LOCALAPPDATA || // Windows
            process.env.HOME && path.join(process.env.HOME, ".cache") || // MacOS/Linux
            process.cwd(),
            "pure-dango", ".pdbccache"
        );
        let importedBytecode = loadBytecode(cacheDirectory, absolutePath);

        if (!importedBytecode)
        {
            const tokens      = tokenizer(fileContent);
            const ast         = parser(tokens);
            importedBytecode  = buildBytecode(ast, absolutePath);

            const srcMTime = fs.statSync(absolutePath).mtimeMs;
            saveBytecode(cacheDirectory, importedBytecode, absolutePath, srcMTime);
        }

        const savedBaseDir = currentBaseDir;

        callStack.push
        (
            {
                bytecode   : activeBytecode,
                pointer    : pointer,
                savedScope : currentScope,
                returnMode : "execute",
                functionName : absolutePath,
                file,
                importer : file,
                line,
                column,
                savedBaseDir
            }
        );

        activeBytecode = importedBytecode;
        pointer        = 0;
        currentBaseDir = path.dirname(absolutePath);
    },   // EXEC

    () : void =>
    {
        const template : any = stack.pop();   // get the current function
        stack.push
        (
            {
                ...template,
                closureScope: currentScope   // add closureScope to know the function's scope
            }
        );
    },   // MKFUNC

    (bytecode: Bytecode) : void =>
    {
        const count    : number = next(bytecode) as number;
        const elements : any[] = [];

        for (let i = 0; i < count; i++)
            elements.unshift(stack.pop());

        stack.push(elements);
    },   // MKARR

    () : void =>
    {
        const index : any = getTrueValue(stack.pop());
        const array : any = stack.pop();

        
        if (typeof array === "string")
        {
            if (typeof index !== "bigint" && !isGFloat(index) && typeof index !== "number")
                errorTemplate("ARRGET", `String index must be a Float or BigInt, got "${index}"`);
            
            let idx : number;
            if (isGFloat(index))
                idx = parseInt(index.inner.toFixed(0), 10);
            else
                idx = Number(index);

            const character = array[idx] ?? null;
            stack.push(character !== null ? character : null);
            return;
        }

        if (array?.type === "class")
        {
            const key = String(index);

            if (array.properties && key in array.properties)
            {
                stack.push(array.properties[key]);
                return;
            }

            const methods = array.isInstance ? array.methods : collectMethods(array);

            if (array.methods === undefined)
                throw new runtimeErrors.ClassError(array?.name);

            if (methods[key] === undefined)
                throw new runtimeErrors.MethodError(key);

            const method = methods[key];
            stack.push
            (
                {
                    ...method,
                    isMethod        : true,
                    parameters      : method.parameters,
                    staticClassName : array.isInstance ? null : array.name
                }
            );
            return;
        }   

        if (array?.type === "object")
        {
            stack.push
            (
                array.value
                [
                    String(index)
                ] ?? undefined
            );
            return;
        }

        if (!Array.isArray(array) && typeof array !== "string")
            errorTemplate("ARRGET", `cannot index non-array value, got "${array}"`);
        if (typeof index !== "bigint" && !isGFloat(index))
            errorTemplate("ARRGET", `Array index must be a Float or BigInt, got "${index}"`);

        const result = array[isGFloat(index) ? parseInt(index.inner.toFixed(0), 10) : Number(index)] ?? undefined;
        stack.push(result);
    },   // ARRGET

    () : void =>
    {
        const index : any = getTrueValue(stack.pop());
        const array : any = getTrueValue(stack.pop());
        const value : any = stack.pop();
        const key = String(index);

        if (array?.type === "class")
        {
            if (array.isInstance)
                array.properties[key] = value;
            else
            {
                if (!array.properties) 
                    array.properties = {};
                array.properties[key] = value;
            }
            return;
        }

        if (array?.type === "object")
        {
            array.value[key] = value;
            return;
        }

        if (!Array.isArray(array))
            errorTemplate("ARRSET", `cannot index non-array value, got "${array}"`);
        if (typeof index !== "bigint" && !isGFloat(index))
            errorTemplate("ARRSET", `Array index must be a Float or BigInt, got "${index}"`);

        array[isGFloat(index) ? index.inner.toNumber() : Number(index)] = value;
    },   // ARRSET

    (bytecode: Bytecode) : void =>
    {
        const count  : number               = next(bytecode) as number;
        const object : Record<string, any>  =
        {
            type: "object",
            value: {}
        };

        for (let i = 0; i < count; i++)
        {
            const value : any   = stack.pop();
            const key   : any   = stack.pop();

            object.value[String(key)] = value;
        }

        stack.push(object);
    },   // MKOBJ

    () : void =>
    {
        const descriptor : any = stack.pop();

        const classObject : {type : "class", name : string, superclass : Record<string, any>, methods : any[]} =
        {
            type : "class",
            name : descriptor.name,
            superclass : descriptor.superclass,
            methods : descriptor.methods
        }

        stack.push(classObject);
    },   // MKCLASS

    async (bytecode : Bytecode) : Promise<void> =>
    {
        const className     : any = next(bytecode);
        const argumentCount : any = next(bytecode);

        const args : any[] = [];
        for (let i = 0; i < argumentCount; i++)
            args.unshift(stack.pop());

        const classDefinition : any = currentScope.get(className);
        if (!classDefinition || classDefinition.type !== "class")
            errorTemplate("MKISNT", `"${className}" is not a class`);

        const instance : {type : string, methods : Record<string, any>, properties : Record<string, any>, isInstance : boolean, class : string, superclass : any} =
        {
            type       : "class",
            methods    : {},
            properties : {},
            isInstance : true,
            class      : classDefinition.name,
            superclass : classDefinition.superclass
        }

        const allMethods = collectMethods(classDefinition);

        for (const method of Object.values(allMethods) as any[])
        {
            instance.methods[method.name] =
            {
                ...method,
                thisContext : instance
            };
        }

        if (Object.prototype.hasOwnProperty.call(classDefinition.methods, "constructor"))
        {
            const constructor : any = classDefinition.methods["constructor"];

            const savedPointer : number = pointer;
            const savedScope   : Scope  = currentScope;

            currentScope = new Scope(constructor.closureScope ?? currentScope);
            currentScope.declare("this");
            currentScope.set("this", instance);

            if (classDefinition.superclass)
            {
                currentScope.declare("1345__superClass");
                currentScope.set("1345__superClass", classDefinition.superclass);
            }

            (constructor.parameters ?? [])
                .forEach
                (
                    (parameter: any, i: number) =>
                    {
                        declareVariable(parameter.name);
                        setVariable(parameter.name, args[i] !== undefined ? args[i] : (parameter.default !== null ? evaluateDefault(parameter.default) : undefined));
                    }
                );

            callStack.push
            (
                {
                    bytecode   : activeBytecode,
                    pointer    : savedPointer,
                    savedScope,
                    returnMode : "constructor",
                    instance,
                    functionName : `inst ${className}`,
                    file,
                    line,
                    column
                }
            );

            activeBytecode = constructor.bytecode;
            pointer        = 0;
        }

        stack.push(instance);
    },   // MKINST

    (bytecode: Bytecode) : void =>
    {
        line =   next(bytecode) as number;
        column = next(bytecode) as number;
    },   // SETLINE

    (bytecode: Bytecode) : void =>
    {
        file = next(bytecode) as string;
    },   // SETFILE

    () : void =>
    {
        const array : any = getTrueValue(stack.pop());
        if (!Array.isArray(array))
            errorTemplate("SPREAD", `spread operator an only be used on arrays`);
        stack.push
        (
            {
                __spread__: true,
                value: array
            }
        )
    },   // SPREAD
    
    async (bytecode: Bytecode) : Promise<void> =>
    {
        const argumentCount : number = next(bytecode) as number;

        const args : any[] = [];
        for (let i = 0; i < argumentCount; i++)
        {
            const value = stack.pop();
            if (value?.__spread__)
                args.unshift(...value.value);
            else
                args.unshift(value);
        }

        const property : string = stack.pop() as string;
        const object   : any    = stack.pop();
        const key      : string = String(property);  // define key

        let functionObject : any;

        if (object?.type === "class")
        {
            if (object.properties && key in object.properties)
            {
                functionObject = object.properties[key];
            }
            else
            {
                const methods = object.isInstance ? object.methods : collectMethods(object);
                if (!methods[key]) 
                    throw new runtimeErrors.MethodError(key);

                const method = methods[key];
                functionObject =
                {
                    ...method,
                    isMethod        : true,
                    staticClassName : object.isInstance ? null : object.name,
                    thisContext     : object.isInstance ? object : null
                };
            }
        }
        else 
            throw new runtimeErrors.MethodError(key);

        const savedPointer = pointer;
        const savedScope   = currentScope;

        currentScope = new Scope(functionObject.closureScope ?? currentScope);

        if (functionObject.staticClassName && !functionObject.thisContext)
        {
            const classDefinition = currentScope.get(functionObject.staticClassName);
            const allMethods      = collectMethods(classDefinition);
            const hasConstructor  = !!classDefinition.methods["constructor"];

            const init = args[0];

            const tempInstance : any =
            {
                type       : "class",
                methods    : {},
                properties : hasConstructor ? {__INIT__: init} : {},
                isInstance : true,
                class      : classDefinition.name,
                superclass : classDefinition.superclass
            };

            for (const method of Object.values(allMethods) as any[])
                tempInstance.methods[method.name] = { ...method, thisContext: tempInstance };

            functionObject = { ...functionObject, thisContext: tempInstance };

            if (hasConstructor)
            {
                const constructor    = classDefinition.methods["constructor"];
                const constructorArg = args[0];
                args.shift();

                currentScope.declare("this");
                currentScope.set("this", tempInstance);

                if (classDefinition.superclass)
                {
                    currentScope.declare("1345__superClass");
                    currentScope.set("1345__superClass", classDefinition.superclass);
                }

                constructor.parameters.forEach((parameter: any, i: number) =>
                {
                    currentScope.declare(parameter.name);
                    currentScope.set(parameter.name, i === 0 ? constructorArg : undefined);
                });

                // push constructor frame on top (runs first)
                callStack.push
                (
                    {
                        bytecode      : constructor.bytecode,
                        pointer       : 0,
                        savedScope    : currentScope,
                        returnMode    : "constructor",
                        instance      : tempInstance,
                        functionName  : `inst ${functionObject.staticClassName}`,
                        file,

                        pendingMethod :
                        {
                            methodBytecode   : functionObject.bytecode,
                            methodKey        : key,
                            methodArgs       : args,
                            methodParameters : functionObject.parameters,
                            methodScope      : new Scope(functionObject.closureScope ?? savedScope),
                            returnBytecode   : activeBytecode,
                            returnPointer    : savedPointer,
                            returnScope      : savedScope,
                            isStaticCall: true
                        },

                        line,
                        column
                    }
                );

                activeBytecode = constructor.bytecode;
                pointer        = 0;
                return;
            }

            args.shift();

            currentScope.declare("this");
            currentScope.set("this", init);
        }

        if (functionObject.thisContext && !functionObject.staticClassName)
        {
            currentScope.declare("this");
            currentScope.set("this", functionObject.thisContext);
        }

        functionObject.parameters.forEach
        (
            (parameter: any, i: number) =>
            {
                if (parameter.rest)
                {
                    declareVariable(parameter.name);
                    setVariable(parameter.name, args.slice(i));
                }
                else
                {
                    declareVariable(parameter.name);
                    setVariable(parameter.name, args[i] !== undefined ? args[i] : (parameter.default !== null ? evaluateDefault(parameter.default) : undefined));
                }
            }
        );

        callStack.push
        (
            {
                bytecode     : activeBytecode,
                pointer      : savedPointer,
                savedScope,
                returnMode   : "function",
                functionName : key,
                file,
                line,
                column
            }
        );

        activeBytecode = functionObject.bytecode;
        pointer        = 0;
    },   // CALLMETHOD
];

const asyncOpcodes = new Set([10, 26, 35, 37]);
export async function interpret(bytecode: Bytecode, baseDir : string = process.cwd(), filename : string = "<anonymous>")
{
    pointer        = 0;
    stack          = [];
    activeBytecode = bytecode;
    currentBaseDir = baseDir;
    currentScope   = new Scope();
    callStack      = [];
    file           = filename;
    line           = 0;
    column         = 0;
    importedFiles.clear();

    let steps : number = 0;

    try
    {
        while (true)
        {
            if (pointer >= activeBytecode.length)
            {
                if (callStack.length === 0) 
                    break;

                const frame : any = callStack.pop();
                activeBytecode    = frame.bytecode;
                pointer           = frame.pointer;
                currentScope      = frame.savedScope;


                if (frame.returnMode === "constructor")
                {
                    if (!frame.pendingMethod)
                        stack.push(frame.instance);
                    
                    if (frame.pendingMethod)
                    {
                        const 
                        { 
                            methodBytecode, 
                            methodKey, 
                            methodArgs 
                        } = frame.pendingMethod;
                        
                        const methodScope = new Scope(currentScope);
                        methodScope.declare("this");
                        methodScope.set("this", frame.instance);

                        frame.pendingMethod.methodParameters.forEach
                        (
                            (parameter: any, i: number) =>
                            {
                                methodScope.declare(parameter.name);
                                methodScope.set(parameter.name, methodArgs[i] !== undefined ? methodArgs[i] : (parameter.default !== null ? evaluateDefault(parameter.default) : undefined));
                            }
                        );

                        callStack.push
                        (
                            {
                                bytecode     : activeBytecode,
                                pointer      : pointer,
                                savedScope   : currentScope,
                                returnMode   : "function",
                                functionName : methodKey,
                                file, 
                                line, 
                                column
                            }
                        );

                        currentScope   = methodScope;
                        activeBytecode = methodBytecode;
                        pointer        = 0;
                    }
                }
                else if (frame.returnMode === "super")
                {
                    const nextFrame = callStack[callStack.length - 1];
                    if (!nextFrame?.pendingMethod)
                        stack.push(undefined);
                }
                else if (frame.returnMode === "execute")
                {
                    file = frame.file;

                    line   = frame.line;
                    column = frame.column;

                    currentBaseDir = frame.savedBaseDir ?? currentBaseDir;
                }
                else
                {
                    if (stack[stack.length - 1] === undefined)
                        stack.push(undefined);
                }

                continue;
            }

            const operator : any = activeBytecode[pointer++];

            if (operator === 25)   // RETURN
            {
                const frame : any = callStack.pop();
                activeBytecode    = frame.bytecode;
                pointer           = frame.pointer;
                currentScope      = frame.savedScope;

                if (frame.returnMode === "constructor")
                {
                    stack.pop();
                    stack.push(frame.instance);

                    if (frame.pendingMethod)
                    {
                        const 
                        { 
                            methodBytecode, 
                            methodKey,
                            methodArgs, 
                            methodParameters 
                        } = frame.pendingMethod;
                        
                        const methodScope = new Scope(currentScope);
                        methodScope.declare("this");
                        methodScope.set("this", frame.instance);
                        
                        methodParameters.forEach
                        (
                            (parameter: any, i: number) =>
                            {
                                methodScope.declare(parameter.name);
                                methodScope.set(parameter.name, methodArgs[i] !== undefined ? methodArgs[i] : (parameter.default !== null ? evaluateDefault(parameter.default) : undefined));
                            }
                        );

                        callStack.push
                        (
                            {
                                bytecode     : frame.pendingMethod.returnBytecode,
                                pointer      : frame.pendingMethod.returnPointer, 
                                savedScope   : frame.pendingMethod.returnScope,
                                returnMode   : "function",
                                functionName : methodKey,
                                file, 
                                line, 
                                column
                            }
                        );

                        stack.pop(); 
                        currentScope   = methodScope;
                        activeBytecode = methodBytecode;
                        pointer        = 0;
                    }
                }
                else if (frame.returnMode === "super")
                {
                    const nextFrame = callStack[callStack.length - 1];
                    if (!nextFrame?.pendingMethod)
                        stack.push(undefined);
                }

                continue;
            }

            if (typeof operator !== "number") 
                throw new runtimeErrors.InternalError(`operator should be a number but got "${operator}"`);

            const command = commands[operator];
            if (command === undefined) 
                throw new runtimeErrors.InternalError(`unknown operator code: "${operator}"`);

            if (asyncOpcodes.has(operator)) 
            {
                await command(activeBytecode);
            } 
            else 
            {
                command(activeBytecode);
            }

            if (++steps % 1000000 === 0)
                await new Promise(setImmediate);
        }
    }
    catch(error : any)
    {
        if (!error.hasLocation)
        {
            const fileShortName = file.split(/[\\/]/).pop() ?? file;
            error.message += `\n    at ${fileShortName} (${file}:${line}:${column})`;

            for (let i = callStack.length - 1; i >= 0; i--)
            {
                const frame = callStack[i];

                if (frame.returnMode === "execute")
                {
                    const importerFile  = frame.importer ?? frame.file;
                    const importerShort = importerFile.split(/[\\/]/).pop() ?? importerFile;
                    error.message       += `\n    at ${importerShort} (${importerFile}:${frame.line}:${frame.column})`;
                }
                else
                {
                    const frameShort : string = frame.file.split(/[\\/]/).pop() ?? frame.file;
                    error.message       += `\n    at ${frame.functionName} (${frameShort}:${frame.line}:${frame.column})`;
                }
            }

            error.hasLocation = true;
        }
        throw error;
    }
    return {
        stack,
        scopes: currentScope
    };
}

export async function executeInCurrentContext(code : string, isolateScope : boolean = false) : Promise<any>
{
    const tokens = tokenizer(code);
    const ast = parser(tokens);
    const execBytecode = buildBytecode(ast, "<exec>");
    
    const savedPointer  = pointer;
    const savedStack    = [...stack];
    const savedBytecode = activeBytecode;
    const savedScope    = currentScope;
    
    if (isolateScope)
        currentScope = new Scope(currentScope);
    
    activeBytecode = execBytecode;
    pointer = 0;
    stack = [];
    
    while (true)
    {
        if (pointer >= activeBytecode.length)
        {
            if (callStack.length === 0 || callStack[callStack.length - 1].returnMode === "execute")
                break;

            const frame : any = callStack.pop();
            activeBytecode    = frame.bytecode;
            pointer           = frame.pointer;
            currentScope      = frame.savedScope;

            if (frame.returnMode === "constructor")
                stack.push(frame.instance);
            else if (frame.returnMode === "function")
            {
                if (stack[stack.length - 1] === undefined)
                    stack.push(undefined);
            }

            continue;
        }

        const operator = activeBytecode[pointer++];

        // RETURN
        if (operator === 25)
        {
            if (callStack.length === 0)
                break;

            const frame : any = callStack.pop();
            activeBytecode    = frame.bytecode;
            pointer           = frame.pointer;
            currentScope      = frame.savedScope;

            if (frame.returnMode === "constructor")
            {
                stack.pop();
                stack.push(frame.instance);
            }
            
            if (frame.returnMode === "execute")
                break;

            continue;
        }

        if (typeof operator === "number" && commands[operator])
        {
            if (asyncOpcodes.has(operator))
                await commands[operator](activeBytecode);
            else
                commands[operator](activeBytecode);
        }
    }
    
    const result = stack.length > 0 
        ? stack.pop() 
        : undefined;
    
    stack = savedStack;
    pointer = savedPointer;
    activeBytecode = savedBytecode;
    
    if (isolateScope)
        currentScope = savedScope;
    
    return result;
}