import {syncFunctions, asyncFunctions} from "../runtime/stdlib.js";
import {runtimeErrors} from "../runtime/errors.js";
import {isConstant} from "../runtime/globals.js";
import Decimal from "decimal.js";
let scopeStack =
[
    {true: 1, false: 0, null: 0}, // global
];

function currentScope()
{
    return scopeStack[scopeStack.length - 1];
}

function declareVariable(name)
{
    const scope = currentScope();
    if (name in scope)
        throw new SyntaxError(`Identifier "${name}" already declared in this scope`);
    scope[name] = null;
}

function setVariable(name, value)
{
    for (let i = scopeStack.length - 1; i >= 0; i--)
    {
        if (name in scopeStack[i])
        {
            scopeStack[i][name] = value;
            return;
        }
    }
    throw new ReferenceError(`${name} is not defined`);
}

function getVariable(name)
{
    for (let i = scopeStack.length - 1; i >= 0; i--)
    {
        if (name in scopeStack[i])
        {
            return scopeStack[i][name];
        }
    }
    throw new ReferenceError(`${name} is not defined`);
}

const commandMap = new Map([
    [1, (bytecode) => {
            let value = next(bytecode);
            if (typeof value === "string" && /^[0-9]+$/.test(value))
            {
                if (value > Number.MAX_SAFE_INTEGER) value = BigInt(value);
                else value = Number(value);
            }
            else if (typeof value === "string" && !isNaN(value)) value = new Decimal(value);
            if (value === undefined) throw new runtimeErrors.MissingStackTokenError("PUSH");
            
            stack.push(value);
    }], // PUSH

    [2, (bytecode) => stack.push(getVariable(next(bytecode)))], // LOAD

    [3, (bytecode) => {
        const variableName = next(bytecode);
        isConstant(variableName);

        const variableValue = stack.pop();
        if (variableValue === undefined) throw new runtimeErrors.MissingStackTokenError("STORE");

        setVariable(variableName, variableValue);
    }], // STORE

    [4, (bytecode) => declareVariable(next(bytecode))], // ALLOC, make the value null when created

    [5, commandMapBinaryOperators((left, right) => left + right, (left, right) => left.add(right))], // ADD
    [6, commandMapBinaryOperators((left, right) => left - right, (left, right) => left.sub(right))], // SUB
    [7, commandMapBinaryOperators((left, right) => left * right, (left, right) => left.mul(right))],// MUL
    [8, commandMapBinaryOperators(
        (left, right) => {
            if (right === 0 || (right instanceof Decimal && right.isZero())) throw new runtimeErrors.DivisionByZero(left, right);
            return left / right
        },
        (left, right) => {
            if (right.isZero()) throw new runtimeErrors.DivisionByZero(left, right);
            return left.div(right)
    })], // DIV
    [9, commandMapBinaryOperators((left, right) => left % right, (left, right) => left.mod(right))], // MOD

    [10, async (bytecode) => {
        const functionName = next(bytecode);
        const argAmount = next(bytecode);
        const args = [];

        for (let i = 0; i < argAmount; i++)
        {
            args.unshift(stack.pop());
        }

        let func = syncFunctions[functionName];
        if (func)
        {
            const result = func(stack, getTrueValue, ...args);

            if (result !== undefined) stack.push(result);
            else stack.push(null);   // return something

            return;
        }

        func = asyncFunctions[functionName];
        if (func)
        {
            const result = await func(stack, getTrueValue, ...args);

            if (result !== undefined) stack.push(result);
            else stack.push(null);

            return;
        }

        let functionObject;

        try
        {
            functionObject = getVariable(functionName)
        }
        catch
        {
            throw new runtimeErrors.FunctionError(functionName);
        }

        if (!functionObject || !functionObject.bytecode || !Array.isArray(functionObject.parameters)) throw new runtimeErrors.FunctionError(functionName);

        // save the current location
        const savedPointer = pointer;

        // push a new scope for the function
        scopeStack.push({});

        // declare and set all parameters
        functionObject.parameters.forEach((parameter, i) => {
            declareVariable(parameter);
            setVariable(parameter, args[i] ?? undefined)
        });

        pointer = 0;

        // use our version of runBytecode so we don't have bugs.
        let hasReturned = false;
        while (pointer < functionObject.bytecode.length)
        {
            const operator = functionObject.bytecode[pointer++];

            if (operator === 25)
            { 
                hasReturned = true;

                const returnValue = stack.pop();
                scopeStack.pop();

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
            scopeStack.pop();
            stack.push(null);
        }

        pointer = savedPointer;
    }], // CALL

    [11, () => {
        let value = stack.pop();
        if (value instanceof Decimal) simpleStack(value.neg());
        simpleStack(-value);
    }], // NEG

    [12, () => {
        let value = stack.pop();
        if (value instanceof Decimal) value = value.isZero() ? 1: 0;
        simpleStack(value ? 0: 1);
    }], // NOT

    [13, () => {
        let value = stack.pop();
        if (value instanceof Decimal) value = BigInt(value.toFixed(0)); // ~ can't take floats or decimals
        simpleStack(~value);
    }], // BITNOT

    [14, (bytecode) => {
        const target = next(bytecode);
        pointer = target;
    }], // JMP
    [15, (bytecode) => {
        const target = next(bytecode);
        const value = stack.pop();

        if (value === 0)
        {
            pointer = target;
        }
    }], // JZ

    [16, commandMapBinaryOperators((left, right) => left === right, (left, right) => left.eq(right))], // EQ
    [17, commandMapBinaryOperators((left, right) => left !== right, (left, right) => !left.eq(right))], // NE
    [18, commandMapBinaryOperators((left, right) => left > right, (left, right) => left.gt(right))], // GT
    [19, commandMapBinaryOperators((left, right) => left < right, (left, right) => left.lt(right))], // LT
    [20, commandMapBinaryOperators((left, right) => left >= right, (left, right) => left.gte(right))], // GTE
    [21, commandMapBinaryOperators((left, right) => left <= right, (left, right) => left.lte(right))], // LTE
    [22, () => {
        if (stack.length === 0) throw new runtimeErrors.StackError();
        stack.pop()
    }], // POP
    [23, () => scopeStack.push({})], // PUSHSCP
    [24, () => {
        if (scopeStack.length === 1)
            throw new Error("Cannot pop global scope");
        scopeStack.pop();
    }], // POPSCP
    [25, () => {
        // return is handled in call
    }], // RETURN
]);

let pointer = 0;
let stack = [];

function next(bytecode)
{
    return bytecode[pointer++];
}

function getTrueValue(value)
{
    if (typeof value === "string")
    {
        try
        {
            value = getVariable(value);
        }
        catch {}; // do nothing
    }

    if (typeof value === "string" && !isNaN(value))
    {
        if (value.includes(".")) return new Decimal(value);
        if (/^[+-]?\d+$/.test(value))
        {
           const bigIntValue = BigInt(value);

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

function simpleStack(value)
{
    if (value === null) stack.push(value);
    else if (typeof value === "boolean") stack.push(value ? 1 : 0);
    else if (!(value instanceof Decimal) && !Number.isInteger(value)) stack.push(new Decimal(value));
    else stack.push(value);
}

function BinaryOperator()
{
    if (stack.length < 2)
    {
        throw new Error(`BinaryOperatorError: There must be 2 numbers pushed before using an operator on them.`);
    }

    let right = getTrueValue(stack.pop());
    let left = getTrueValue(stack.pop());

    //console.log(`left: ${left}`);
    //console.log(`right: ${right}`);

    if (left instanceof Decimal || right instanceof Decimal)
    {
        if (!(left instanceof Decimal)) left = new Decimal(left);
        if (!(right instanceof Decimal)) right = new Decimal(right);
        return [left, right];
    }

    if (
        (typeof left === "number" || typeof left === "bigint") && !Number.isInteger(left) ||
        (typeof right === "number" || typeof right === "bigint") && !Number.isInteger(right)
    )
    {
        left = new Decimal(left);
        right = new Decimal(right);
        return [left, right];
    }

    if (typeof left === "number" || typeof right === "number")
    {
        if (left === Infinity || right === Infinity)
        {
            if (left === Infinity) left = Number.MAX_SAFE_INTEGER;
            if (right === Infinity) right = Number.MAX_SAFE_INTEGER;
        }

        if (typeof left !== "bigint") left = BigInt(left);
        if (typeof right !== "bigint") right = BigInt(right);
    }

    return [left, right];
}

function commandMapBinaryOperators(func, decimalFunc)
{
    return () => {
        const [left, right] = BinaryOperator();
        let result;
        if (left instanceof Decimal || right instanceof Decimal)
        {
            //if (decimalFunc) console.log(`Used decimal func "${decimalFunc}" \n`);
            result = decimalFunc
                ? decimalFunc(left instanceof Decimal ? left: Decimal(left), right instanceof Decimal ? right: Decimal(right))
                : func(left, right);
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

async function runBytecode(bytecode)
{   
    const operator = bytecode[pointer++];
    //console.log(`[${pointer-1}] OP:${operator} Stack:${JSON.stringify(stack.slice(-3))} Scopes:${scopeStack.length}`);
    const command = commandMap.get(operator);

    if (command === undefined)
    {
        throw new Error(`Unknown operator code: "${operator}"`);
    }

    await command(bytecode);
}

export async function interpret(bytecode)
{
    pointer = 0;
    stack = [];
    scopeStack =
    [
        {true: 1, false: 0, null: null},   // global
    ];

    while (pointer < bytecode.length)
    {
        await runBytecode(bytecode);
    }

    return {
        stack,
        scopes: scopeStack
    };
}