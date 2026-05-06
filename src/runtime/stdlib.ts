import fs from "fs";
import path from "path";
import readline from "readline";
import {performance} from "perf_hooks";

import
{
    maxArguments,
    joinStrings,
    bigIntPow,
    interpretEscapeCharacters,
    FON
} from "../core/utils"


import 
{
    getBaseDir, 
    GF, 
    isGFloat, 
    gmpPrecision, 
    setPrecision, 
    isGWrapper, 
    GFloat,
    BigIntToGFloat,
    BigIntDivToGFloat,
    gmpInstance,
    executeInCurrentContext
} from "../core/interpreter";

import {precisionToBits} from "gmp-wasm";

type Stack = number[] | string[] | null[];

export function errorTemplate(name : string, message : string, suggestion? : string) : never
{
    const body = suggestion ? `${message}, ${suggestion}` : message;
    const formatted = name
        ? `[ERROR] ${name}:\n${body}`
        : `[ERROR] ${body}`;

    const err = new Error(formatted);
    err.name = "";
    throw err;
}

function applyRounding(value : any, mode : string) : any
{
    switch (mode)
    {
        case "down"      : return value.floor();
        case "up"        : return value.ceil();
        case "half_even" : return value.round();
    }
}

function toFloat(value: any): GFloat
{
    if (isGFloat(value)) 
        return value;

    if (typeof value === "bigint") 
        return BigIntToGFloat(value);
    if (typeof value === "number") 
        return GF(value.toString());
    if (typeof value === "string" && !isNaN(Number(value))) 
        return GF(value);

    errorTemplate("toFloat", `Cannot convert "${value}" to a Float`, "ensure the value is a BigInt, Float, or numeric string before passing it");
}

function toBigInt(value: any)
{
    if (typeof value === "bigint") 
        return value;

    if (isGFloat(value)) 
        return BigInt(value.inner.toFixed());
    if (typeof value === "number") 
        return BigInt(value.toString());
    if (typeof value === "string" && !isNaN(Number(value))) 
        return BigInt(value);

    errorTemplate("toBigInt", `Cannot convert "${value}" to a BigInt`, "ensure the value is a BigInt, Float, or numeric string before passing it");
}

function simpleRounding(normalFunc: (value: number) => any, GMPFunc: (value: any) => any, args: any[], name: string) : any
{
    maxArguments(1, args, name);

    const value = args[0];
    if (!(isGFloat(value) || typeof value === "bigint")) 
        errorTemplate(name, `value must be Float or BigInt`, "ensure the value is a BigInt or Float before passing it");
    
    const result = typeof value === "bigint"
        ? normalFunc(Number(value))
        : GMPFunc(toFloat(value));

    return result;
}

export const syncFunctions =
{
    "now" : () : number =>
    {
        return performance.now();
    },

    "out": (stack: Stack, getTrueValue: Function, ...args: any[]) : void =>
    {
        const map     : string[] = args.map(string => isGFloat(string) ? string.inner.toString() : string);
        const joined  : string   = joinStrings(map);
        const escaped : string   = interpretEscapeCharacters(joined);
        process.stdout.write(escaped);
    },

    "print" : (stack: Stack, getTrueValue: Function, ...args: any[]) : void =>
    {
        const map     : string[] = args.map(string => isGFloat(string) ? string.inner.toString() : string);
        const joined  : string   = joinStrings(map);
        const escaped : string   = interpretEscapeCharacters(joined);
        console.log(escaped);
    },

    "concat": (stack: Stack, getTrueValue: Function, ...args: any[]) : string =>
    {
        return joinStrings(args.map(x => isGFloat(x) ? x.inner.toString() : x));
    },

    "dir": (stack: Stack, getTrueValue: Function, ...args: any[]) : void =>
    {
        maxArguments(2, args, "dir");
        const value      : any = FON(args[0]);
        const rawOptions : any = args[1]; 

        const options : Record<string, any> = rawOptions?.value ?? {};

        const depth  : number | null = options["depth"]  ?? null;
        const colors : boolean       = options["colors"] ?? true;

        console.dir(value, {depth, colors});
    },

    "root": (stack: Stack, getTrueValue: any, ...args: any[]) : any =>
    {
        maxArguments(3, args, "root");
        const rawBase: any = args[0];
        if (rawBase === undefined) 
            errorTemplate("root", `base parameter is undefined`);
        
        const rawRoot: any = args[1];
        if (rawRoot === undefined) 
            errorTemplate("root", `root parameter is undefined`);
        if (GF(rawRoot).inner.isEqual(2))
            return syncFunctions.sqrt(stack, getTrueValue, rawBase);

        const base = GF(rawBase);
        const root = GF(rawRoot);

        if (base.inner.isEqual(GF("1").inner))
            return GF("1");
        if (root.inner.isEqual(GF("1").inner))
            return base;
        if (root.inner.isEqual(GF("0").inner))
            errorTemplate("root", `root parameter cannot be 0`);

        if (base.inner.isEqual(GF("0").inner) && root.inner.lessThan(GF("0").inner))
            errorTemplate("root", `0 cannot have a negative root`);

        // x^(1/n)
        const reciprocal = GF("1").inner.div(root.inner);
        return new GFloat(base.inner.pow(reciprocal));
    },

    "sqrt": (stack: Stack, getTrueValue: Function, ...args: any[]) : any =>
    {
        maxArguments(1, args, "sqrt");
        return new GFloat(toFloat(args[0]).inner.sqrt());
    },

    "raise": (stack: Stack, getTrueValue: Function, ...args: any[]) : any =>
    {
        maxArguments(3, args, "raise");
        let base : any = getTrueValue(args[0]);
        if (base === undefined) 
            errorTemplate("raise", `base parameter is undefined`);
        
        let exponent : any = getTrueValue(args[1]);
        if (exponent === undefined) 
            errorTemplate("raise", `exponent parameter is undefined`);

        const useNativeMath = !!args[2];

        // early returns
        if (base === 1n)
            return 1n;
        if (base === 0n && exponent === 0n) 
            errorTemplate("raise", `0 raised to 0 cannot be evaluated`);
        else if (base === 0n)
            return 0n;
        
        if (typeof base === "bigint" || typeof exponent === "bigint") 
        {
            if (typeof base !== "bigint")
                base = BigInt(base);
            if (typeof exponent !== "bigint")
                exponent = BigInt(exponent);

            if (useNativeMath)
                return Math.pow(Number(base), Number(exponent));
            else
                return bigIntPow(base, exponent);
        }

        const GMPBase     = toFloat(base);
        const GMPExponent = toFloat(exponent);
        const result      = new GFloat(GMPBase.inner.pow(GMPExponent.inner));
        return useNativeMath
            ? BigInt(result.inner.toNumber())
            : result;
    },

    "strtoFixed": (stack: Stack, getTrueValue: Function, ...args: any[]): string =>
    {
        maxArguments(3, args, "strtoFixed");
        const x : any = args[0];
        if (!isGFloat(x))
            errorTemplate("strtoFixed", `x parameter must be type Float, got "${x}"`, `maybe you forgot to call tofloat()?`);

        const digits : number = isGFloat(args[1]) ? args[1].inner.toNumber() : Number(args[1]);
        const mode   : string | undefined = args[2];

        if (mode)
            return applyRounding(x, mode).toFixed(digits);

        const binding = gmpInstance.binding;

        // pointers
        const expPointer = binding.malloc(8);
        const strPointer = binding.mpfr_get_str(0, expPointer, 10, digits + 1, x.inner.mpfr_t, 0);

        // read null-terminated string from wasm memory
        const mem = new Uint8Array(binding.mem.buffer);
        let str = "", i = strPointer;
        while (mem[i] !== 0) str += String.fromCharCode(mem[i++]);

        const exp = new Int32Array(binding.mem.buffer, expPointer, 1)[0];

        binding.mpfr_free_str(strPointer);
        binding.free(expPointer);

        const isNeg     = str[0] === "-";
        const magnitude = isNeg ? str.slice(1) : str;

        let result: string;
        if (exp >= magnitude.length)
            result = magnitude + "0".repeat(exp - magnitude.length) + ".0";
        else if (exp <= 0)
            result = "0." + "0".repeat(-exp) + magnitude;
        else
            result = magnitude.slice(0, exp) + "." + magnitude.slice(exp);

        return (isNeg ? "-" : "") + result;
    },

    "floattostr": (stack: Stack, getTrueValue: Function, ...args: any[]): string =>
    {
        maxArguments(2, args, "floattostr");
        const x      = args[0] as GFloat;
        const digits = isGFloat(args[1]) ? args[1].inner.toNumber() : Number(args[1]);

        const binding = gmpInstance.binding;

        const mpfrPow = binding.mpfr_t();
        binding.mpfr_init2(mpfrPow, gmpPrecision + 64);
        binding.mpfr_set_ui(mpfrPow, 10, 0);

        const mpfrExp = binding.mpfr_t();
        binding.mpfr_init2(mpfrExp, gmpPrecision + 64);
        binding.mpfr_set_ui(mpfrExp, digits + 5, 0);
        binding.mpfr_pow(mpfrPow, mpfrPow, mpfrExp, 0);  // mpfrPow = 10^(digits+5)
        binding.mpfr_clear(mpfrExp); binding.mpfr_t_free(mpfrExp);

        // multiply x by 10^(digits+5)
        const mpfrShifted = binding.mpfr_t();
        binding.mpfr_init2(mpfrShifted, gmpPrecision + 64);
        binding.mpfr_mul(mpfrShifted, x.inner.mpfr_t, mpfrPow, 0);
        binding.mpfr_clear(mpfrPow); binding.mpfr_t_free(mpfrPow);

        // truncate to integer
        const mpfrInt = binding.mpfr_t();
        binding.mpfr_init2(mpfrInt, gmpPrecision + 64);
        binding.mpfr_floor(mpfrInt, mpfrShifted);
        binding.mpfr_clear(mpfrShifted); binding.mpfr_t_free(mpfrShifted);

        // convert to mpz
        const mpz = binding.mpz_t();
        binding.mpz_init(mpz);
        binding.mpfr_get_z(mpz, mpfrInt, 0);
        binding.mpfr_clear(mpfrInt); binding.mpfr_t_free(mpfrInt);

        // convert mpz to string using mpz_to_string
        const str = binding.mpz_to_string(mpz, 10);
        binding.mpz_clear(mpz); binding.mpz_t_free(mpz);

        const result = str.slice(0, 1) + "." + str.slice(1, digits + 1);
        return result;
    },

    "bigintdiv": (stack: Stack, getTrueValue: Function, ...args: any[]): GFloat =>
    {
        maxArguments(2, args, "bigintdiv");
        const numerator = args[0];
        const denominator = args[1];
        if (typeof numerator !== "bigint" || typeof denominator !== "bigint")
            errorTemplate("bigintdiv", `both arguments must be BigInt, got "${numerator}" and "${denominator}"`, `maybe you forgot to call tobigint()?`);
        
        return BigIntDivToGFloat(numerator, denominator);
    },

    "bigintmul": (stack: Stack, getTrueValue: Function, ...args: any[]): any =>
    {
        maxArguments(2, args, "bigintmul");
        if (typeof args[0] !== "bigint" || typeof args[1] !== "bigint")
            errorTemplate("bigintmul", `both arguments must be BigInt, got "${args[0]}" and "${args[1]}"`, `maybe you forgot to call tobigint()?`);

        const binding = gmpInstance.binding;

        function toMpz(n: bigint): number
        {
            const neg = n < 0n;
            const abs = neg ? -n : n;
            let hex   = abs.toString(16);
            if (hex.length % 2) hex = "0" + hex;
            const bytes = new Uint8Array(hex.length / 2);
            for (let i = 0; i < bytes.length; i++)
                bytes[i] = parseInt(hex.slice(i*2, i*2+2), 16);

            const wasmBuf = binding.malloc(bytes.length);
            binding.mem.set(bytes, wasmBuf);
            const mpz = binding.mpz_t();
            binding.mpz_init(mpz);
            binding.mpz_import(mpz, bytes.length, 1, 1, 1, 0, wasmBuf);
            binding.free(wasmBuf);
            if (neg) binding.mpz_neg(mpz, mpz);
            return mpz;
        }

        function fromMpz(mpz: number): bigint
        {
            const neg = binding.mpz_sgn(mpz) < 0;
            const absmpz = binding.mpz_t();
            binding.mpz_init(absmpz);
            binding.mpz_abs(absmpz, mpz);

            const hex = binding.mpz_to_string(absmpz, 16);
            binding.mpz_clear(absmpz);
            binding.mpz_t_free(absmpz);

            const result = hex ? BigInt("0x" + hex) : 0n;
            return neg ? -result : result;
        }

        // convert BigInt to Mpz
        const a   = toMpz(args[0]);
        const b   = toMpz(args[1]);

        const mpz = binding.mpz_t(); 
        binding.mpz_init(mpz);
        binding.mpz_mul(mpz, a, b); // multiply a and b

        binding.mpz_clear(a);  // free a
        binding.mpz_t_free(a);

        binding.mpz_clear(b); 
        binding.mpz_t_free(b);

        const result = fromMpz(mpz); // convert Mpz to BigInt
        binding.mpz_clear(mpz);  // free the mpz
        binding.mpz_t_free(mpz);

        return result;
    },

    "chudnovsky": (stack: Stack, getTrueValue: Function, ...args: any[]): any =>
    {
        maxArguments(1, args, "chudnovsky");
        const raw = args[0];
        const n   = isGFloat(raw)
            ? raw.inner.toNumber()
            : typeof raw === "bigint"
                ? Number(raw)
                : raw as number;

        const P: bigint[] = [];
        const Q: bigint[] = [];
        const T: bigint[] = [];

        for (let a = 1; a < n; a++)
        {
            const s = BigInt(6 * a);
            const t = BigInt(3 * a);
            const b = BigInt(a);

            P.push((s-5n)*(s-4n)*(s-3n)*(s-2n)*(s-1n)*s);
            Q.push(262537412640768000n * b*b*b * t*(t-1n)*(t-2n));
            T.push((a%2===0 ? 1n : -1n) * P[P.length-1] * (13591409n + 545140134n * b));
        }

        while (P.length > 1)
        {
            const nP: bigint[] = [];
            const nQ: bigint[] = [];
            const nT: bigint[] = [];

            for (let i = 0; i + 1 < P.length; i += 2)
            {
                nP.push(P[i] * P[i+1]);
                nQ.push(Q[i] * Q[i+1]);
                nT.push(Q[i+1] * T[i] + P[i] * T[i+1]);
            }

            if (P.length % 2 === 1)
            {
                nP.push(P[P.length-1]);
                nQ.push(Q[Q.length-1]);
                nT.push(T[T.length-1]);
            }

            P.length = 0;
            for (let i = 0; i < nP.length; i++) P.push(nP[i]);
            Q.length = 0;
            for (let i = 0; i < nQ.length; i++) Q.push(nQ[i]);
            T.length = 0;
            for (let i = 0; i < nT.length; i++) T.push(nT[i]);
        }

        return [P[0], Q[0], T[0]];
    },

    "ecompute": (stack: Stack, getTrueValue: Function, ...args: any[]): any =>
    {
        maxArguments(1, args, "ecompute");
        const raw = args[0];
        const n   = isGFloat(raw) ? raw.inner.toNumber() : Number(raw);

        let P: bigint[] = [];
        let Q: bigint[] = [];

        for (let i = 1; i < n; i++)
        {
            P.push(1n);
            Q.push(BigInt(i));
        }

        while (P.length > 1)
        {
            const nP: bigint[] = [];
            const nQ: bigint[] = [];

            for (let i = 0; i + 1 < P.length; i += 2)
            {
                nP.push(P[i] * Q[i+1] + P[i+1]);
                nQ.push(Q[i] * Q[i+1]);
            }

            if (P.length % 2 === 1)
            {
                nP.push(P[P.length-1]);
                nQ.push(Q[Q.length-1]);
            }

            P = nP;
            Q = nQ;
        }

        return [P[0], Q[0]];
    },

    "toSignificance": (stack: Stack, getTrueValue: Function, ...args: any[]) : any =>
    {
        maxArguments(3, args, "toSignificance");
        const x : any = args[0];
        if (!isGFloat(x))
            errorTemplate("toSignificance", `x parameter must be type Float, got "${x}"`, `maybe you forgot to call tofloat()?`);
        
        const digits : any = isGFloat(args[1]) ? args[1].inner.toNumber() : Number(args[1]);
        if (!Number.isInteger(digits) || digits <= 0)
            errorTemplate("toSignificance", `digits parameter must be a positive integer, got "${digits}"`);
        
        const mode : string | undefined = args[2];

        // GMP doesn't have toSignificantDigits natively so we shift to get significance, round, and shift back.
        const string  = x.inner.toFixed(digits + 10);
        const rounded = GF(string);
        return mode ? applyRounding(rounded, mode) : rounded;
    },

    "toDecimalPlaces": (stack: Stack, getTrueValue: Function, ...args: any[]) : any =>
    {
        maxArguments(3, args, "toDecimalPlaces");
        const x : any = args[0];
        if (!isGFloat(x))
            errorTemplate("toDecimalPlaces", `x parameter must be type Float, got "${x}"`, `maybe you forgot to call tofloat()?`);
        
        const digits : any = isGFloat(args[1]) ? args[1].inner.toNumber() : Number(args[1]);
        if (!Number.isInteger(digits) || digits <= 0)
            errorTemplate("toDecimalPlaces", `digits parameter must be a positive integer, got "${digits}"`);
        
        const mode : string | undefined = args[2];

        const str     = x.inner.toFixed(digits);
        const rounded = GF(str);
        return mode ? applyRounding(rounded, mode) : rounded;
    },

    "exp": (stack: Stack, getTrueValue: Function, ...args: any[]) : any =>
    {
        maxArguments(1, args, "exp");
        const x : any = args[0];
        if (x === undefined) 
            errorTemplate("exp", `x parameter is undefined`);
        if (!(isGFloat(x) || typeof x === "bigint")) 
            errorTemplate("exp", `x parameter must be Float or BigInt, got "${x}"`, "maybe you forgot to call tofloat() or tobigint()?");

        return new GFloat(toFloat(x).inner.exp());  // e^x
    },

    "setPrecision": (stack: Stack, _: any, ...args: any[]) : void =>
    {
        maxArguments(1, args, "setPrecision");
        
        let x : number;
        if (isGWrapper(args[0]))
            x = args[0].mpfr_t;
        if (isGFloat(args[0]))
            x = args[0].inner.toNumber();
        else if (typeof args[0] === "bigint")
            x = Number(args[0]);
        else
            x = args[0];
        
        setPrecision(x);
    },

    "toBits": (stack: Stack, _: any, ...args: any[]) : any =>
    {
        maxArguments(1, args, "toBits");
        
        let digits: number;
        if (isGFloat(args[0]))
            digits = args[0].inner.toNumber();
        else if (typeof args[0] === "bigint")
            digits = Number(args[0]);
        else
            digits = args[0];
        
        const bits = GF(precisionToBits(digits));
        return bits;
    },

    "getPrecision": () : number =>
    {
        return gmpPrecision;
    },

    "sine": (stack: Stack, getTrueValue: Function, ...args: any[]) : any =>
    {
        maxArguments(1, args, "sine");
        const x = args[0];
        if (x === undefined)
            errorTemplate("sine", `x parameter is undefined`);
        
        return new GFloat(toFloat(x).inner.sin());
    },

    "cosine": (stack: Stack, getTrueValue: Function, ...args: any[]) : any =>
    {
        maxArguments(1, args, "cosine");
        const x = args[0];
        if (x === undefined)
            errorTemplate("cosine", `x parameter is undefined`);
        
        return new GFloat(toFloat(x).inner.cos());
    },

    "tan": (stack: Stack, getTrueValue: Function, ...args: any[]) : any =>
    {
        maxArguments(1, args, "tan");
        const x = args[0];
        if (x === undefined)
            errorTemplate("tan", `x parameter is undefined`);
        
        return new GFloat(toFloat(x).inner.tan());
    },

    "arcsin": (stack: Stack, getTrueValue: Function, ...args: any[]) : any =>
    {
        maxArguments(1, args, "arcsin");
        const x = args[0];
        if (x === undefined) 
            errorTemplate("arcsin", `x parameter is undefined`);

        const float = toFloat(x);
        if (float.inner.lessThan(GF("-1").inner) || float.inner.greaterThan(GF("1").inner))
            errorTemplate("arcsin", `domain is [-1, 1], got "${float.toString()}"`);
        
        return new GFloat(float.inner.asin());
    },

    "arccos": (stack: Stack, getTrueValue: Function, ...args: any[]) : any =>
    {
        maxArguments(1, args, "arccos");
        const x = args[0];
        if (x === undefined) 
            errorTemplate("arccos", `x parameter is undefined`);

        const float = toFloat(x);
        if (float.inner.lessThan(GF("-1").inner) || float.inner.greaterThan(GF("1").inner))
            errorTemplate("arccos", `domain is [-1, 1], got "${float.toString()}"`);
        
        return new GFloat(float.inner.acos());
    },

    "arctan": (stack: Stack, getTrueValue: Function, ...args: any[]) : any =>
    {
        maxArguments(1, args, "arctan");
        const x = args[0];
        if (x === undefined)
            errorTemplate("arctan", `x parameter is undefined`);
        
        return new GFloat(toFloat(x).inner.atan());
    },

    "random": (stack: Stack, getTrueValue: Function, ...args: any[]) : any =>
    {
        maxArguments(3, args, "random");

        if (args.length === 0) 
            return GF(Math.random().toString());

        const min = toFloat(args[0]);
        if (args.length === 1)
            errorTemplate("random", `max parameter must be defined after min`);

        const max           = toFloat(args[1]);
        const returnInteger = !!args[2];

        const range  = max.inner.sub(min.inner);
        const result = min.inner.add(GF(Math.random().toString()).inner.mul(range));

        return returnInteger ? new GFloat(result.floor()) : new GFloat(result);
    },

    "ceil": (stack: Stack, getTrueValue: Function, ...args: any[]) : any => 
    {
        return simpleRounding((x: number) => Math.ceil(x), x => new GFloat(x.inner.ceil()), args, "ceil");
    },

    "floor": (stack: Stack, getTrueValue: Function, ...args: any[]) : any  => 
    {
        return simpleRounding((x: number) => Math.floor(x), x => new GFloat(x.inner.floor()), args, "floor");
    },

    "round": (stack: Stack, getTrueValue: Function, ...args: any[]) : any  => 
    {
        return simpleRounding((x: number) => Math.round(x), x => new GFloat(x.inner.round()), args, "round"); 
    },
    
    "abs": (stack: Stack, getTrueValue: Function, ...args: any[]) : any => 
    {
        const x = args[0];
        if (typeof x === "bigint") 
            return x < 0n ? -x : x;   // abs doesn't work on BigInt :3

        return simpleRounding((x: number) => Math.abs(x), x => new GFloat(x.inner.abs()), args, "abs");
    },

    "log": (stack: Stack, getTrueValue: Function, ...args: any[]) : any => 
    {
        maxArguments(2, args, "log");
        const rawValue = args[0];
        if (rawValue === undefined) 
            errorTemplate("log", `x parameter is undefined`);
        
        const x = toFloat(rawValue);
        if (x.inner.lessOrEqual(GF("0").inner))
            errorTemplate("log", `x parameter must be positive, got "${x.toString()}"`);

        if (args.length === 1)
            return new GFloat(x.inner.log()); // ln(x)

        const base = toFloat(args[1]);

        if (base.inner.isEqual(GF("1").inner))
            errorTemplate("log", `base parameter cannot be 1`);
        if (base.inner.lessOrEqual(GF("0").inner))
            errorTemplate("log", `base parameter must be positive`);

        // log_b = ln(x) / ln(b)
        return new GFloat(x.inner.log().div(base.inner.log()));
    },

    "min": (stack: Stack, getTrueValue: Function, ...args: any[]) : any => 
    {
        if (args.length === 0) 
            errorTemplate("min", `needs at least one argument`);

        return args.reduce((a, b) =>
        {
            const fa = toFloat(a);
            const fb = toFloat(b);
            return fa.inner.lessThan(fb.inner) ? a : b;
        });
    },

    "max": (stack: Stack, getTrueValue: Function, ...args: any[]) : any => 
    {
        if (args.length === 0) 
            errorTemplate("max", `needs at least one argument`);

        return args.reduce((a, b) =>
        {
            const fa = toFloat(a);
            const fb = toFloat(b);
            return fa.inner.greaterThan(fb.inner) ? a : b;
        });
    },

    "len": (stack: Stack, getTrueValue: Function, ...args: any[]) : number =>
    {
        let x : any = args[0];

        if (x?.type === "object") 
            x = Object.entries(x.value);
        else if (!Array.isArray(x) && typeof x !== "string")    
            errorTemplate("len", `x parameter must be a String, Array, or Object, got "${x}"`);

        return x.length;
    },

    "push": (stack: Stack, getTrueValue: Function, ...args: any[]) : void =>
    {
        const array : any = args[0];

        if (!Array.isArray(array)) 
            errorTemplate("push", `First parameter must be an Array, got "${array}"`);

        for (let i = 1; i < args.length; i++) 
            array.push(args[i]);
    },

    "pop": (stack: Stack, getTrueValue: Function, ...args: any[]) : any =>
    {
        maxArguments(1, args, "pop");

        const array : any = args[0];
        if (!Array.isArray(array)) 
            errorTemplate("pop", `First parameter must be an Array, got "${array}"`);
        
        return array.pop() ?? null;
    },

    "typeof": (stack: Stack, getTrueValue: Function, ...args: any[]) : string => 
    {
        maxArguments(1, args, "typeof");

        const value : any = args[0];

        if (value === null)        
            return "null";
        if (value === undefined)   
            return "undefined";
        if (typeof value === "boolean")
            return "boolean";

        if (isGFloat(value))
            return "float";
        if (typeof value === "bigint")
            return "bigint";

        if (typeof value === "string")   
            return "string";
        if (Array.isArray(value))        
            return "array";

        if (value?.isInstance)      
        {
            const initType = syncFunctions.typeof([], () => "", value.properties["0"]);
            return initType || value.class;
        }

        if (value?.type === "class")              
            return "class";

        if (value?.bytecode)             
            return "function";

        if (value?.type === "object")    
            return "object";
        
        return "unknown";
    },

    "strascii": (stack: Stack, getTrueValue: Function, ...args: any[]) : number => 
    {
        maxArguments(1, args, "strascii");
        return (args[0] as string).charCodeAt(0);
    },

    "asciistr": (stack: Stack, getTrueValue: Function, ...args: any[]) : string => 
    {
        maxArguments(1, args, "asciistr");
        return String.fromCharCode(Number(args[0]));
    },

    "throwerror": (stack: Stack, getTrueValue: Function, ...args: any[]) : void =>
    {
        maxArguments(2, args, "throwerror");
        const name    : string = args[0] ?? "Error";
        const message : string = args[1] ?? "";

        const error = new Error(interpretEscapeCharacters(message));
        error.name  = name;
        Object.defineProperty(error, 'name', {value: name});
        throw error;
    },

    "regularerror": (stack: Stack, getTrueValue: Function, ...args: any[]) : void =>
    {
        const map     : string[] = args.map(string => isGFloat(string) ? string.inner.toString() : string);
        const joined  : string   = joinStrings(map);
        const escaped : string   = interpretEscapeCharacters(joined);
        console.error(`\x1B[1m\x1B[31m${escaped}\x1B[0m`);
    },

    "rf": (stack: Stack, getTrueValue: Function, ...args: any[]) : string =>
    {
        maxArguments(2, args, "rf");
        if (args[0] === undefined)
            errorTemplate("rf", `path parameter is undefined`);

        const rawPath : string = args[0];
        const resolvedPath : string = path.resolve(getBaseDir(), rawPath);

        const encoding : string = args[1] ? args[1] : "utf8";
        if (typeof encoding !== "string")
            errorTemplate("rf", `encoding parameter must be a String, got "${encoding}"`);

        try
        {
            return fs.readFileSync(resolvedPath, encoding as BufferEncoding);
        }
        catch
        {
            errorTemplate("rf", `file "${resolvedPath}" was not found`);
        }
    },

    "wfraw": (stack: Stack, getTrueValue: Function, ...args: any[]) : void =>
    {
        maxArguments(3, args, "wfraw");
        if (args[0] === undefined)
            errorTemplate("wfraw", `path parameter is undefined`);

        const rawPath      : string = args[0];
        const resolvedPath : string = path.resolve(getBaseDir(), rawPath);
        const content      : string = args[1];
        const encoding     : string = args[2] ? args[2] : "utf8";
        if (typeof encoding !== "string")
            errorTemplate("wfraw", `encoding parameter must be a String, got "${encoding}"`);

        try
        {
            fs.writeFileSync(resolvedPath, content, encoding as BufferEncoding);
        }
        catch
        {
            errorTemplate("wfraw", `could not write to file "${resolvedPath}"`);
        }
    },

    "wf": (stack: Stack, getTrueValue: Function, ...args: any[]) : void =>
    {
        maxArguments(3, args, "wf");
        if (args[0] === undefined)
            errorTemplate("wf", `path parameter is undefined`);

        const rawPath      : string = args[0];
        const resolvedPath : string = path.resolve(getBaseDir(), rawPath);
        const content      : string = interpretEscapeCharacters(args[1]);
        const encoding     : string = args[2] ? args[2] : "utf8";
        if (typeof encoding !== "string")
            errorTemplate("wf", `encoding parameter must be a String, got "${encoding}"`);
    
        try
        {
            fs.writeFileSync(resolvedPath, content, encoding as BufferEncoding);
        }
        catch
        {
            errorTemplate("wf", `could not write to file "${resolvedPath}"`);
        }
    },

    "ifp": (stack: Stack, getTrueValue: Function, ...args: any[]) : string =>
    {
        maxArguments(1, args, "ifp");
        const fileName : string = args[0];

        const root = (process as any).pkg
            ? path.dirname(process.execPath)
            : path.resolve(path.dirname(process.argv[1]), "..");

        return path.join(path.resolve(root, "src", "runtime", "libs"), fileName);
    },

    "af": (stack: Stack, getTrueValue: Function, ...args: any[]) : void =>
    {
        maxArguments(3, args, "af");
        if (args[0] === undefined)
            errorTemplate("af", `path parameter is undefined`);

        const rawPath      : string = args[0];
        const resolvedPath : string = path.resolve(getBaseDir(), rawPath);

        const content  : string = interpretEscapeCharacters(args[1]);

        const encoding : string = args[2] ? args[2] : "utf8";
        if (typeof encoding !== "string")
            errorTemplate("af", `encoding parameter must be a String, got "${encoding}"`);
    
        try
        {
            fs.appendFileSync(resolvedPath, content, encoding as BufferEncoding);
        }
        catch
        {
            errorTemplate("af", `could not append to file "${resolvedPath}"`);
        }
    },

    "df": (stack: Stack, getTrueValue: Function, ...args: any[]) : void =>
    {
        maxArguments(1, args, "df");
        if (args[0] === undefined)
            errorTemplate("df", `path parameter is undefined`);

        const rawPath      : string = args[0];
        const resolvedPath : string = path.resolve(getBaseDir(), rawPath);
    
        try
        {
            fs.unlinkSync(resolvedPath);
        }
        catch
        {
            errorTemplate("df", `could not delete file "${resolvedPath}"`);
        }
    },

    "fe": (stack: Stack, getTrueValue: Function, ...args: any[]) : number =>
    {
        maxArguments(1, args, "fe");
        if (args[0] === undefined)
            errorTemplate("fe", `path parameter is undefined`);

        const rawPath      : string = args[0];
        const resolvedPath : string = path.resolve(getBaseDir(), rawPath);
    
        return fs.existsSync(resolvedPath) ? 1 : 0;
    },

    "ld": (stack: Stack, getTrueValue: Function, ...args: any[]) : any =>
    {
        maxArguments(1, args, "ld");
        if (args[0] === undefined)
            errorTemplate("ld", `path parameter is undefined`);

        const rawPath      : string = args[0];
        const resolvedPath : string = path.resolve(getBaseDir(), rawPath);

        try
        {
            return fs.readdirSync(resolvedPath);
        }
        catch
        {
            errorTemplate("ld", `could not read directory "${resolvedPath}"`);
        }
    },

    "md": (stack: Stack, getTrueValue: Function, ...args: any[]) : void =>
    {
        maxArguments(1, args, "md");
        if (args[0] === undefined)
            errorTemplate("md", `path parameter is undefined`);
        
        const rawPath      : string = args[0];
        const resolvedPath : string = path.resolve(getBaseDir(), rawPath);
        try
        {
            fs.mkdirSync(resolvedPath);
        }
        catch
        {
            errorTemplate("md", `could not make directory "${resolvedPath}"`);
        }
    },

    "mdr": (stack: Stack, getTrueValue: Function, ...args: any[]) : void =>
    {
        maxArguments(1, args, "mdr");
        if (args[0] === undefined)
            errorTemplate("mdr", `path parameter is undefined`);
        
        const rawPath      : string = args[0];
        const resolvedPath : string = path.resolve(getBaseDir(), rawPath);
        try
        {
            fs.mkdirSync(resolvedPath, {recursive: true});
        }
        catch
        {
            errorTemplate("mdr", `could not make directory "${resolvedPath}"`);
        }
    },

    "dd": (stack: Stack, getTrueValue: Function, ...args: any[]) : void =>
    {
        maxArguments(1, args, "dd");
        if (args[0] === undefined)
            errorTemplate("dd", `path parameter is undefined`);
        
        const rawPath      : string = args[0];
        const resolvedPath : string = path.resolve(getBaseDir(), rawPath);
        try
        {
            fs.rmSync(resolvedPath, {recursive: true});
        }
        catch
        {
            errorTemplate("dd", `could not delete directory "${resolvedPath}"`);
        }
    },

    "fd": (stack: Stack, getTrueValue: Function, ...args: any[]) : number =>
    {
        maxArguments(1, args, "fd");
        if (args[0] === undefined)
            errorTemplate("fd", `path parameter is undefined`);
        
        const rawPath      : string = args[0];
        const resolvedPath : string = path.resolve(getBaseDir(), rawPath);
        try
        {
            return fs.statSync(resolvedPath).isDirectory() ? 1 : 0;
        }
        catch
        {
            errorTemplate("fd", `could not find directory "${resolvedPath}"`);
        }
    },

    "rd": (stack: Stack, getTrueValue: Function, ...args: any[]) : void =>
    {
        maxArguments(2, args, "rd");
        if (args[0] === undefined)
            errorTemplate("rd", `path parameter is undefined`);
        if (args[1] === undefined)
            errorTemplate("rd", `newPath parameter is undefined`);
        
        const rawPath      : string = args[0];
        const resolvedPath : string = path.resolve(getBaseDir(), rawPath);

        const newPath         : string = args[1];
        const resolvedNewPath : string = path.resolve(getBaseDir(), newPath);
        try
        {
            fs.renameSync(resolvedPath, resolvedNewPath);
        }
        catch
        {
            errorTemplate("rd", `could not rename directory "${resolvedPath}"`);
        }
    },

    "tostr": (stack: Stack, getTrueValue: Function, ...args: any[]) : string =>
    {
        maxArguments(1, args, "tostr");
        const value = args[0];
        if (value === undefined || value === null)
            errorTemplate("tostr", `x parameter must be a String, BigInt, or Float`);

        if (isGFloat(value))
        {
            const digits = Math.ceil(value.inner.precisionBits / 3.32) + 10;
            return value.inner.toFixed(digits);
        }
        else if (value?.isInstance) 
        {
            const init = value.properties["0"];
            if (isGFloat(init))
            {
                const digits = Math.ceil(init.inner.precisionBits / 3.32) + 10;
                return init.inner.toFixed(digits);
            }
            if (init !== undefined && init !== null)
                return String(init);
            
            return `[${value.class}]`;
        }
        else if (value?.type === "class")
            return `[class ${value.class}]`
        
        else if (Array.isArray(value) || (typeof value === "object" && value !== null))
            return JSON.stringify(unwrap(value));
        else
            return value.toString();
    },

    "tojson": (stack: Stack, getTrueValue: Function, ...args: any[]): string =>
    {
        maxArguments(1, args, "tojson");
        return JSON.stringify(unwrap(args[0]));
    },

    "tofloat": (stack: Stack, getTrueValue: Function, ...args: any[]) : any | number =>
    {
        maxArguments(1, args, "tofloat");
        const x = args[0];
        if (x === undefined || x === null)
            errorTemplate("tofloat", `x parameter must be a String, BigInt, or Float`);

        return toFloat(x);
    },

    "tobigint": (stack: Stack, getTrueValue: Function, ...args: any[]) : any | number =>
    {
        maxArguments(1, args, "tobigint");
        const value = args[0];
        if (value === undefined || value === null)
            errorTemplate("tobigint", `x parameter must be a String, BigInt, or Float`);

        return toBigInt(value);
    },

    "toarr": (stack: Stack, getTrueValue: Function, ...args: any[]) : Array<any> =>
    {
        const splitNumber = (value : any) : (number | string)[] => 
        {
            const string = isGFloat(value) 
                ? value.inner.toFixed() 
                : String(value < 0 ? -value : value).replace("n", "");

            const isNegative = isGFloat(value) 
                ? value.inner.isNegative() 
                : value < 0;

            const [integer, float] = string.split('.');

            const digits : (number | string)[] = integer.split('').map(Number);
            if (float) 
                digits.push('.', ...float.split('').map(Number));
            if (isNegative) 
                digits[0] = (digits[0] as number) * -1;

            return digits;
        };

        maxArguments(1, args, "toarr");

        const value : any = args[0];
        if (value === undefined || value === null)
            errorTemplate("toarr", `x parameter must be a String, BigInt, or Float, got "${value}"`);

        if (Array.isArray(value))
            return value;
        else if (typeof value === "object" && !isGFloat(value))
            return Object.entries(value);
        else if (typeof value === "bigint" || isGFloat(value))
            return splitNumber(value);
        else if (typeof value === "string")
            return Array.from(value);

        return [];
    },

    "tobj": (stack: Stack, getTrueValue: Function, ...args: any[]): any =>
    {
        maxArguments(1, args, "tobj");
        const value = args[0];
        if (value === undefined || value === null)
            errorTemplate("tobj", `x parameter must be a String, got "${value}"`, `maybe you forgot to call tostr()?`);

        const str = typeof value === "string" ? value : JSON.stringify(value);

        const wrap = (value : any): any =>
        {
            if (Array.isArray(value))
                return value.map(wrap);
            else if (value !== null && typeof value === "object")
            {
                const wrapped: Record<string, any> = {};
                for (const key of Object.keys(value))
                    wrapped[key] = wrap(value[key]);
                return {type: "object", value: wrapped};
            }

            return value;
        };

        try
        {
            return wrap(JSON.parse(str));
        }
        catch (error: any)
        {
            errorTemplate("tobj", `failed to parse JSON: ${error.message}`);
        }
    },

    "keys": (stack: Stack, getTrueValue: Function, ...args: any[]) : Array<string> =>
    {
        maxArguments(1, args, "keys");
        const value = args[0];
        if (value?.type !== "object")
            errorTemplate("keys", `x parameter must be an Object, got "${value}"`, "maybe you forgot to call tobj()?");

        return Object.keys(value.value);
    },

    "values": (stack: Stack, getTrueValue: Function, ...args: any[]) : Array<string> =>
    {
        maxArguments(1, args, "values");
        const value : any = args[0];
        if (value?.type !== "object")
            errorTemplate("values", `x parameter must be an Object, got "${value}"`, "maybe you forgot to call tobj()?");

        return Object.values(value.value);
    },

    "kill": (stack: Stack, getTrueValue: Function, ...args: any[]) : void =>
    {
        maxArguments(1, args, "exit");
        const code : any = args[0] ?? 0;
        const exitCode = isGFloat(code) ? code.inner.toNumber() : Number(code);

        if (exitCode !== 0)
            console.error(`Process exited with error code ${code}`);
        
        process.exit(exitCode);
    },

    "getcwd" : () : string   => process.cwd(),
    "getargv": () : string[] => process.argv.slice(4),

    "getenv": (stack: Stack, getTrueValue: Function, ...args: any[]) : string | undefined =>
    {
        maxArguments(1, args, "getenv");
        return process.env[getTrueValue(args[0])];
    },

    "getpid": () : number => process.pid,

    "__gmpmethods__": (stack: Stack, getTrueValue: Function, ...args: any[]) : any =>
    {
        const value = args[0];
        if (isGFloat(value))
            return Object.getOwnPropertyNames(Object.getPrototypeOf(value)).join(", ");
        return "not a gfloat";
    },
}

const safeStringify = (data : any) : string => 
    JSON.stringify(
        data, 
        (_, value) => 
        {
            if (typeof value === "bigint") 
                return Number(value);
            if (
                value && 
                typeof value === "object" && 
                "type" in value && 
                "value" in value
            ) 
                return value.value;
            return value;
        }
    );

const unwrap = (value: any): any => 
{
    if (value && typeof value === "object" && "type" in value && "value" in value)
        return unwrap(value.value);

    if (Array.isArray(value))
        return value.map(unwrap);

    if (value && typeof value === "object") 
    {
        const result : any = {};
        for (const key of Object.keys(value))
            result[key] = unwrap(value[key]);

        return result;
    }

    if (typeof value === "bigint")
        return value.toString();

    return value;
};

export const asyncFunctions =
{
    "input": async (stack: Stack, getTrueValue: Function, ...args: any[]) : Promise<string> =>
    {
        let joinedStrings : string  = joinStrings(args.map(x => isGFloat(x) ? x.inner.toFixed() : x));

        const rl : readline.Interface = readline.createInterface
        (
            {
                input  : process.stdin,
                output : process.stdout
            }
        );

        const prompt : string = interpretEscapeCharacters(joinedStrings);

        const inputValue : string = await new Promise
        (
            resolve => 
            {
                rl.question(prompt, answer => resolve(answer));
            }
        );

        rl.close();

        return inputValue;
    },

    "sleep": async (stack: Stack, getTrueValue: Function, ...args: any[]) : Promise<void> =>
    {
        maxArguments(1, args, "sleep");
        const ms : any = args[0];
        if (ms === undefined)
            errorTemplate("sleep", `ms parameter is undefined`);

        await new Promise
        (
            resolve => 
                setTimeout
                (
                    resolve,
                    Number(ms)
                )
        );
    },

    "http_get": async (stack: Stack, getTrueValue: Function, ...args: any[]) : Promise<string> =>
    {
        maxArguments(2, args, "http_get");
        
        const url : string = args[0];
        if (!url || typeof url !== "string")
            errorTemplate("http_get", `url parameter must be a String, got "${url}"`, `maybe you forgot to call tostr()?`);

        const options : any = args[1] || {};
        const headers : Record<string, string> = unwrap(options?.headers || {});

        const response = await fetch(url, {method: "GET", headers: headers});

        if (!response.ok)
            errorTemplate("http_get", `${response.status} ${response.statusText}`);

        try
        {
            return await response.text();
        }
        catch (error: any)
        {
            errorTemplate("http_get", error.message);
        }
    },

    "http_post": async (stack: Stack, getTrueValue: Function, ...args: any[]) : Promise<string> =>
    {
        maxArguments(3, args, "http_post");
        
        const url : string = args[0];
        if (!url || typeof url !== "string")
            errorTemplate("http_post", `url parameter must be a String, got "${url}"`, `maybe you forgot to call tostr()?`);

        const data    : any = args[1];
        const options : any = args[2] || {};
        
        const unwrappedOptions = unwrap(options);
        const headers: Record<string, string> = unwrappedOptions?.headers || {"Content-Type": "application/json"};
    
        const body = safeStringify(data);
        const response = await fetch(url, {method: 'POST', headers: headers, body: body});

        if (!response.ok) 
        {
            const errorBody = await response.text();
            let message = `${response.status} ${response.statusText}`;
            try 
            {
                const parsed = JSON.parse(errorBody);
                message = parsed?.[0]?.error?.message || parsed?.error?.message || message;
            } 
            catch {/*notjson*/}

            errorTemplate("http_post", message);
        }

        try
        {
            return await response.text();
        }
        catch (error: any)
        {
            errorTemplate("http_post", error.message);
        }
    },

    "http_request": async (stack: Stack, getTrueValue: Function, ...args: any[]): Promise<string> =>
    {
        maxArguments(1, args, "http_request");
        
        const config : any = args[0];
        if (!config || typeof config !== "object")
            errorTemplate("http_request", `config parameter must be an Object, got "${config}"`, `maybe you forgot to call tobj()?`);

        const url     : string = config.url;
        const method  : string = config.method || 'GET';
        const headers : Record<string, string> = unwrap(config.headers || {});
        const body    : any = config.body;

        if (!url)
            errorTemplate("http_request", `config parameter must include a "url" property`);

        const fetchOptions : RequestInit = {method: method.toUpperCase(), headers: headers};

        if (body && method.toUpperCase() !== "GET")
            fetchOptions.body = safeStringify(body)

        const response = await fetch(url, fetchOptions);

        if (!response.ok)
            errorTemplate("http_request", `${response.status} ${response.statusText}`);

        try
        {
            return await response.text();
        }
        catch (error: any)
        {
            errorTemplate("http_request", error.message);
        }
    },

    "exec": async (stack: Stack, getTrueValue: Function, ...args: any[]) : Promise<any> =>
    {
        maxArguments(2, args, "exec");

        const code : string = args[0];
        if (typeof code !== "string")
            errorTemplate("exec", `code parameter must be a String, got "${code}"`);

        const isolateScope : boolean = args[1] ?? false;

        return await executeInCurrentContext(code, isolateScope);
    }
};