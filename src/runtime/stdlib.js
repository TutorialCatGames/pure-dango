import readline from "readline";
import
{
    removeQuotes,
    errorLengthCheck,
    joinStrings,
    bigIntPow
} from "../core/utils.js"
import Decimal from "decimal.js";
import {performance} from "perf_hooks";

export const syncFunctions =
{
    "now": () =>
    {
        return performance.now()
    },

    "print": (stack, _, ...args) =>
    {
        console.log(joinStrings(args.map(string => string instanceof Decimal ? string.toString() : string)));
    },

    "concat": (stack, _, ...args) =>
    {
        return joinStrings(args)
    },

    "root": (stack, _, ...args) =>
    {
        errorLengthCheck(3, args, "root");
        const base = args[0] instanceof Decimal ? args[0] : new Decimal(args[0]);
        if (base === undefined) throw new SyntaxError(`There must be a base after built-in function "root"`);

        const root = args[1] instanceof Decimal ? args[1] : new Decimal(args[1]);
        if (root === undefined) throw new SyntaxError(`There must be an exponent after base: "${base}"`);

        const returnScientificNotation = !!args[2];          // !! makes it a boolean

        if (base.eq(1)) return new Decimal(1);
        if (root.eq(1)) return base;

        const result = base.pow(new Decimal(1).div(root));   // if it was root(1, 5) this will be 1.pow(0.2)

        return returnScientificNotation
            ? result
            : result.toFixed();
    },

    "setPrecision": (stack, _, ...args) =>
    {
        errorLengthCheck(1, args, "setPrecision");
        const precision = Number(args[0]);
        if (typeof precision !== "number" ) throw new TypeError(`Decimal precision must be a number, but got "${precision}"`);
        Decimal.set({precision: precision});
    },

    "sine": (stack, getTrueValue, ...args) =>
    {
        errorLengthCheck(1, args, "sine");
        const value = typeof args[0] === "bigint"
            ? Number(args[0])
            : args[0] instanceof Decimal
                ? args[0].toNumber() : args[0];
        return Math.sin(value);
    },

    "cosine": (stack, getTrueValue, ...args) =>
    {
        errorLengthCheck(1, args, "cosine");
        const value = typeof args[0] === "bigint"
            ? Number(args[0])
            : args[0] instanceof Decimal
                ? args[0].toNumber() : args[0];
        return Math.cos(value);
    },

    "raise": (stack, getTrueValue, ...args) =>
    {
        errorLengthCheck(3, args, "raise");
        const base = getTrueValue(args[0]);
        if (base === undefined) throw new SyntaxError(`There must be a base after built-in function "raise"`);
        
        const exponent = getTrueValue(args[1]);
        if (exponent === undefined) throw new SyntaxError(`There must be an exponent after base: "${base}"`);

        const returnScientificNotation = !!args[2];

        // early returns
        if (base === 1 || base === 1n) return returnScientificNotation ? 1 : 1n;
        if ((base === 0 || base === 0n) && (exponent === 0 || exponent === 0n)) throw new EvalError(`0 raised to 0 can't be evaluated`);
        else if (base === 0 || base === 0n) return returnScientificNotation ? 0 : 0n;
        
        if ((Number.isInteger(base) && Number.isInteger(exponent)) || (typeof base === "bigint" && typeof exponent === "bigint")) 
        {
            if (returnScientificNotation)
            {
                return Math.pow(base, exponent);
            }
            else
            {
                const result = bigIntPow(BigInt(base), BigInt(exponent));
                return result;
            }
        }

        const decimalBase = base instanceof Decimal ? base : new Decimal(base);
        const decimalExponent = exponent instanceof Decimal ? exponent : new Decimal(exponent);
        const result = decimalBase.pow(decimalExponent);
        return returnScientificNotation
            ? result
            : result.toFixed();
    }
};

export const asyncFunctions =
{
    "input": async (stack, getTrueValue, ...args) =>
    {
        let joinedStrings = joinStrings(args);

        const rl = readline.createInterface(
            {
                input: process.stdin,
                output: process.stdout
            }
        );

        const inputValue = await new Promise(resolve => {
            rl.question(joinedStrings, answer => resolve(answer));
        });

        rl.close();

        return getTrueValue(inputValue);
    }
};