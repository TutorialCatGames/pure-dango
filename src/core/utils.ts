import fs from "fs";
import path from "path";
import {runtimeErrors, utilsErrors} from "../runtime/errors";

import {GF, isGFloat} from "./interpreter"; 

type RuntimeState =
{
    time:   number
}
type Bytecode = Array<string | number>;
type CacheFolder = string;

export const formatParameter = (parameter : any) : string => 
{
    let result = parameter.rest ? 
        `...${parameter.name}` 
        : parameter.name;

    if (parameter.default) 
        result += ` = ${generateOrigin(parameter.default, 0)}`;

    return result;
}

export const functionOrigin = (node : any, padding : string) : string =>
{
    const indent = padding.length;
    const parameters = node.parameters.map(formatParameter).join(", ");
    if (node.body.length === 0)
        return `${padding}function ${node.name ? node.name : ""}(${parameters}) {}`;

    return `${padding}function ${node.name ? node.name : ""}(${parameters}) {\n` +
        `${node.body.map((child : any) => generateOrigin(child, indent + 4)).join("\n")}\n` +
    `${padding}}`;
}

export const binaryOrigin = (node : any, padding : string) : string =>
{
    return `${padding}${generateOrigin(node.left, 0)} ${node.operator} ${generateOrigin(node.right, 0)}`;
}

const origins : Record<string, Function> = Object.freeze({
    FunctionExpression  : (node : any, padding : string) : string => functionOrigin(node, padding),
    FunctionDeclaration : (node : any, padding : string) : string => functionOrigin(node, padding),

    Literal           : (node : any, padding : string) : string => `${padding}${node.value}`,
    StringLiteral: (node: any, padding: string): string => 
    {
        const escaped = node.value
            .replace(/\\/g, "\\\\")
            .replace(/\n/g, "\\n")
            .replace(/\t/g, "\\t")
            .replace(/\r/g, "\\r")
            .replace(/"/g, '\\"');
        return `${padding}"${escaped}"`;
    },
    VariableReference : (node : any, padding : string) : string => `${padding}${node.value}`,
    
    ArrayLiteral       : (node : any, padding : string) : string => `${padding}[${node.elements.map((element : any) => generateOrigin(element, 0)).join(", ")}]`,
    ArrayAccess        : (node : any, padding : string) : string => `${padding}${generateOrigin(node.object, 0)}[${generateOrigin(node.index, 0)}]`,
    ObjectLiteral      : (node : any, padding : string) : string =>
        `${padding}{\n` +
            node.properties
                .map((property : {key: string, value : any}) =>
                    `${property.key}: ${generateOrigin(property.value, 0)}`
                )
            .join(", ") +
        `}`,

    ClassDeclaration   : (node : any, padding : string) : string =>
    {
        const methods: string = node.methods
            .map((method: any) => {
                const indent = padding.length + 4;
                const pad = " ".repeat(indent);

                const parameters = method.parameters.map(formatParameter).join(", "); // was node.parameters

                if (method.body.length === 0)
                    return `${pad}${method.name}(${parameters}) {}`;

                return `${pad}${method.name}(${parameters}) {\n` +
                        method.body.map((child: any) => generateOrigin(child, indent + 4)).join("\n") +
                    `\n${pad}}`;
            })
            .join("\n\n");

        const properties: string = (node.properties ?? [])
            .slice(1)
            .map((property: any) => {
                const indent = padding.length + 4;
                const pad = " ".repeat(indent);

                if (property.value?.type === "FunctionExpression") 
                {
                    const parameters = property.value.parameters.map(formatParameter).join(", ");
                    if (property.value.body.length === 0)
                        return `${pad}${property.key}(${parameters}) {}`;

                    return `${pad}${property.key}(${parameters}) {\n` +
                            property.value.body.map((child: any) => generateOrigin(child, indent + 4)).join("\n") +
                        `\n${pad}}`;
                }

                return `${pad}${property.key}: ${generateOrigin(property.value, 0)}`;
            })
            .join("\n\n");

        return `${padding}${node.name} {\n` +
            `${methods ? methods + "\n" : ""}` +
            `${properties ? properties + "\n" : ""}` +
        `${padding}}`;
    },

    MethodCall         : (node : any, padding : string) : string =>
        `${padding}${generateOrigin(node.object, 0)}.${node.property}(${node.args.map((a : any) => generateOrigin(a, 0)).join(", ")})`,

    ClassInstantiation : (node : any, padding:  string) => 
    {
        return `${padding}new ${node.variableName} = inst ${node.className}(${node.args.map((x : any) => generateOrigin(x, 0)).join(", ")})`
    },

    MemberExpression : (node : any, padding : string) : string => `${padding}${generateOrigin(node.object, 0)}.${node.property}`,

    Assignment     : (node : any, padding : string) : string =>
    {
        const isCompound : boolean = 
            (node.value.type === "BinaryExpression" || node.value.type === "LogicalExpression") &&
            node.value.left?.type === "VariableReference" &&
            node.value.left?.value === node.name;
        const operator   : string = isCompound ? (node.value.operator + "=") : "=";
        const value      : any    = isCompound ? generateOrigin(node.value.right, 0) : generateOrigin(node.value, 0);
        
        const target : string = typeof node.name === "string" ? node.name : generateOrigin(node.name, 0);
        return `${padding}${target} ${operator} ${value};`;
    },

    NewAssignment  : (node : any, padding : string) : string =>
    {
        const isCompound: boolean = 
            (node.value.type === "BinaryExpression" || node.value.type === "LogicalExpression") &&
            node.value.left?.type === "VariableReference" &&
            node.value.left?.value === node.name;
        const operator   : string  = isCompound ? (node.value.operator + "=") : "=";
        const value      : any     = isCompound ? generateOrigin(node.value.right, 0) : generateOrigin(node.value, 0);

        const target : string = typeof node.name === "string" ? node.name : generateOrigin(node.name, 0);
        return `${padding}new ${target} ${operator} ${value};`;
    },
    NewDeclaration : (node : any, padding : string) : string => `${padding}new ${node.name};`,

    UnaryExpression        : (node : any, padding : string) : string => `${padding}${node.value === "-u" || node.value === "+u" ? node.value[0] : node.value}${generateOrigin(node.argument, 0)}`,
    PostfixUnaryExpression : (node : any, padding : string) : string => `${padding}${generateOrigin(node.argument, 0)}${node.operator}`,
    BinaryExpression       : (node : any, padding : string) : string => binaryOrigin(node, padding),
    LogicalExpression      : (node : any, padding : string) : string => binaryOrigin(node, padding),

    IfStatement       : (node : any, padding : string) : string =>
    {
        const indent    : number = padding.length;
        const elseBlock : string = node.else
            ? `\n${padding}else {\n` + 
                `${Array.isArray(node.else) ? generateOrigin(node.else[0], indent + 4) : generateOrigin(node.else, indent + 4)}` +
              `\n${padding}}`
            : "";

        return `${padding}if (${generateOrigin(node.condition, 0)}) {\n` +
            node.body.map((child : any) => generateOrigin(child, indent + 4)).join("\n") +
        `\n${padding}}\n` +
        elseBlock;
    },

    TernaryExpression : (node : any, padding : string) : string => `${padding}${generateOrigin(node.condition, 0)} ? ${generateOrigin(node.then, 0)} : ${generateOrigin(node.else, 0)}`,

    ForStatement      : (node : any, padding : string) : string => 
    {
        const indent = padding.length;

        const initial   = generateOrigin(node.initial, 0)?.replace(/;$/, "") ?? "";
        const condition = generateOrigin(node.condition, 0) ?? "";
        const update    = generateOrigin(node.update, 0)?.replace(/;$/, "") ?? "";
        return `${padding}for (${initial}; ${condition}; ${update}) {\n` +
                node.body.map((child : any) => generateOrigin(child, indent + 4)).join("\n") +
            `\n${padding}}`
    },

    ForInStatement    : (node : any, padding : string) : string => 
    {
        const indent = padding.length;
        return `${padding}for (${node.left} in ${generateOrigin(node.right, 0)}) {\n` +
            node.body.map((child : any) => generateOrigin(child, indent + 4)).join("\n") +
        `\n${padding}}`;
    },

    ForOfStatement    : (node : any, padding : string) : string => 
    {
        const indent = padding.length;
        return `${padding}for (${node.left} of ${generateOrigin(node.right, 0)}) {\n` +
            node.body.map((child : any) => generateOrigin(child, indent + 4)).join("\n") +
        `\n${padding}}`;
    },

    WhileStatement    : (node : any, padding : string) : string =>
    {
        const indent = padding.length;
        return `${padding}while (${generateOrigin(node.condition, 0)}) {\n` +
            node.body.map((child : any) => generateOrigin(child, indent + 4)).join("\n") +
        `\n${padding}}`
    },

    DoWhileStatement  : (node : any, padding : string) : string => 
    {
        const indent = padding.length;
        return `${padding}do {\n` +
            node.body.map((child : any) => generateOrigin(child, indent + 4)).join("\n") +
        `\n${padding}} while (${generateOrigin(node.condition, 0)});`;
    },

    TryStatement      : (node : any, padding : string) : string => 
    {
        const indent = padding.length;

        const tryBlock     = node.tryBlock.map((child : any) => generateOrigin(child, indent + 4)).join("\n");
        const catchBlock   = node.catchBlock.map((child : any) => generateOrigin(child, indent + 4)).join("\n");
        const finallyBlock = node.finallyBlock
            ? `\n${padding}finally {\n` + 
                   node.finallyBlock.map((child : any) => generateOrigin(child, indent + 4)).join("\n") + 
              `\n${padding}}`
            : "";

        return `${padding}try {\n` + 
                   `${tryBlock}\n` + 
               `${padding}} catch (${node.errorVariable}) {` + 
                   `\n${catchBlock}\n` + 
               `${padding}}` + 
               `${finallyBlock}`;
    },

    SwitchStatement   : (node : any, padding : string) : string => 
    {
        const indent = padding.length;
        const pad    = " ".repeat(indent + 4);

        const cases = node.cases.map((child : any) =>
            `${pad}case ${generateOrigin(child.test, 0)}:\n` +
                child.consequent.map((statement: any) => generateOrigin(statement, indent + 8)).join("\n")
        ).join("\n");

        const defaultCase = node.defaultCase
            ? `\n${pad}default:\n` + 
                  node.defaultCase.consequent.map((statement: any) => generateOrigin(statement, indent + 8)).join("\n")
            : "";

        return `${padding}switch (${generateOrigin(node.discriminant, 0)}) {` +
                   `\n${cases}${defaultCase}\n` + 
               `${padding}}`;
    },

    FunctionCall     : (node : any, padding : string) : string => `${padding}${node.name}(${node.args.map((argument : any) => generateOrigin(argument, 0)).join(", ")})`,
    ReturnStatement  : (node : any, padding : string) : string => `${padding}return${node.argument ? " " + generateOrigin(node.argument, 0) : ""};`,

    BreakStatement    : (node : any, padding : string) : string => `${padding}break;`,
    ContinueStatement : (node : any, padding : string) : string => `${padding}continue;`,

    ImportStatement : (node : any, padding : string) : string => `${padding}import "${node.path}";`
});

export const generateOrigin = (node : any, indent = 0) : string | null =>
{
    if (!node) 
        return null;

    const padding = " ".repeat(indent);    // get the padding
    const func    = origins[node.type];

    if (func) 
        return func(node, padding);
    throw new runtimeErrors.InternalError(`No origin generator for node type "${node.type}"`);
}

// stdlib
export const maxArguments = (maxLength: number, list: any[], name: string) : void =>
{
    let plural = maxLength === 1 ? "argument": "arguments";
    if (list.length > maxLength) 
        throw new utilsErrors.FunctionArgumentError(name, maxLength, plural);
}

export const bigIntPow = (base: bigint, exponent: bigint) : bigint | any =>
{
    if (exponent < 0n) 
        return GF(base.toString()).inner.pow(GF(exponent.toString()));
    if (exponent === 0n && base === 0n) 
        throw new EvalError(`0n raised to 0n can't be evaluated`);
    if (exponent === 0n) 
        return 1n;

    let result = 1n;
    while (exponent > 0n)
    {
        if ((exponent & 1n) === 1n) result *= base; // use exponentiation by squaring. "(exponent & 1) === 1n" checks if the exponent is an odd number
        base *= base;
        exponent >>= 1n; // integer division operator
    }
    
    return result;
}

export const typeHandler = (item: any) : string => 
{
    if (item.isInstance)
    {
        if (item.properties["0"])
            return format(item.properties["0"])!;

        const properties = Object.entries(item.properties ?? {})
            .filter(([key]) => key !== "0") // filter out __INIT__
            .map(([key, value]) => `    ${key}: ${format(value)}`)
            .join(",\n    ");

        const methods = Object.values(item.methods ?? {})
            .filter((method : any) => method.name !== "constructor")
            .map((method : any) => `    ${method.name}(${method.parameters.map((parameter: any) => parameter.name).join(", ")})`)
            .join("\n");

        const hasContent = properties || methods;
        return hasContent
            ? `${item.class} {\n${properties ? properties + "\n" : ""}${methods ? methods + "\n" : ""}}`
            : `${item.class} {}`;
    }

    switch (item.type)
    {
        case "object":
        {
            const entries = Object.entries(item.value).map(([key, value]) => `${key}: ${format(value)}`).join(", ");
            return `{${entries}}`;
        }

        case "class":
        {
            const methods = Object.values(item.methods ?? {})
                .filter((method: any) => method.name !== "constructor")
                .map((method: any) => `    ${method.name}(${method.parameters.map((p: any) => p.name).join(", ")})`)
                .join("\n");

            const properties = Object.entries(item.properties ?? {})
                .filter(([key]) => key !== "0")
                .map(([key, value]: [string, any]) => {
                    if (typeof value === "function" || value?.bytecode)
                        return `    ${key}(${(value.parameters ?? []).map((p: any) => p.name).join(", ")})`;
                    return `    ${key}: ${value}`;
                })
                .join("\n");

            return `${item.name ?? "unknown"} {\n` +
                `${methods ? methods + "\n" : ""}` +
                `${properties ? properties + "\n" : ""}` +
            `}`;
        }

        default:
        {
            throw new runtimeErrors.InternalError(`Type of "${item}" is not implemented in typeHandler`);
        }
    }
}

export const format = (item: any) : string | null =>
{
    if (item === null || item === undefined) 
        return item;

    if (isGFloat(item))             
        return item.inner.toString();

    if (Array.isArray(item))                 
        return "[" + 
            item.map(x => 
            {
                const formatted : any = format(x);
                return formatted;
            }).join(", ") + "]";

    if (item.type)                           
        return typeHandler(item);

    if (typeof item === "object")            
        return generateOrigin(item.ast)?.replace(/\\/g, "\\\\")!;

    return item;
}

// FON (FormatObjectNotation) is a version of format designed for console.dir()
export const FON = (item: any) : any =>
{
    if (item === null || item === undefined)
        return item;

    if (typeof item === "number" || typeof item === "bigint")
        return item;
    if (isGFloat(item))
        return item.toString();
    if (Array.isArray(item))
        return item.map(FON);

    if (item?.type === "object")
    {
        const result : Record<any, any> = {};
        for (const [key, value] of Object.entries(item.value))
            result[key] = FON(value);
        return result;
    }

    if (item?.isInstance)
    {
        const inner: Record<string, any> = {};
        for (const [key, value] of Object.entries(item.properties ?? {}))
        {
            if (key.startsWith("__") && key.endsWith("__")) 
                continue;
            inner[key] = FON(value);
        }
        
        const wrapper: Record<string, any> = {};
        wrapper[item.class] = inner;
        return wrapper;
    }

    if (item?.type === "class")
        return `[class ${item.name}]`;
    
    if (item?.bytecode)
        return `[function ${item.name ?? "<anonymous>"}]`;

    return item.toString();
}

export const joinStrings = (list: any[]) : string =>
{
    return list.reduce((joined, item) => joined + format(item), "");
}

// index
export const run = async (functionToRun: Function, state: RuntimeState, ...args: any[]) : Promise<any> =>
{
    const start    : number = performance.now();
    const output   : any = await functionToRun(...args);
    const end      : number = performance.now();
    const duration : number = end - start;

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

    if (!fs.existsSync(inFile)) 
        return null;

    const data = JSON.parse(fs.readFileSync(inFile, "utf-8"));
    const stats = fs.statSync(srcFile);
    const srcMTime = stats.mtimeMs;

    if (data.version !== 1 || data.mtime !== srcMTime) 
    {
        console.log("recompile");
        return null;
    }

    return data.bytecode;
}

export const interpretEscapeCharacters = (str: string): string =>
{
    return String(str).replace(
        /\\(x[0-9a-fA-F]{1,4}|u[0-9a-fA-F]{1,4}|[0-7]{1,3}|.)/g,
        (match, character) =>
        {
            if (character.startsWith('x'))
                return String.fromCharCode(parseInt(character.slice(1), 16));
            if (character.startsWith('u'))
                return String.fromCharCode(parseInt(character.slice(1), 16));
            if (/^[0-7]{1,3}$/.test(character))
                return String.fromCharCode(parseInt(character, 8));
            switch (character)
            {
                case "n":  return "\n";
                case "t":  return "\t";
                case "b":  return "\b";
                case "r":  return "\r";
                case '0':  return "\0";
                case "'":  return "'";
                case '"':  return '"';
                case "\\": return "\\";
                default:   return match;
            }
        }
    );
};