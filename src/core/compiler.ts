import {runtimeErrors} from "../runtime/errors";
import {errorTemplate} from "../runtime/stdlib";

type Bytecode = Array<any>;
type LoopInfo =
{
    start             : number,
    continueTarget    : number | null,
    end               : number | null,
    breakPositions    : number[],
    continuePositions : number[]
}
type TypeMap = Map<string, (node : any, bytecode : Bytecode, keepValue : boolean) => void>;

function storeArgument(argument : any, bytecode : Bytecode) : void
{
    if (argument.type === "VariableReference") 
        bytecode.push(operators.STORE, argument.value);
    else if (argument.type === "MemberExpression")
    {
        parseObject(argument.object, bytecode, true);
        bytecode.push(operators.PUSH, argument.property);
        bytecode.push(operators.ARRSET);
    }
    else if (argument.type === "ArrayAccess")
    {
        parseObject(argument.object, bytecode, true);
        parseObject(argument.index, bytecode, true);
        bytecode.push(operators.ARRSET);
    }
    else 
        throw new Error(`Invalid assignment target: "${argument.type}" at line ${argument.line}:${argument.column}`);
}

function handleDecrementAndIncrementOperator(node : any, type : number, bytecode : Bytecode, keepValue : boolean) : void
{
    parseObject(node.argument, bytecode, true);
    bytecode.push(operators.PUSH, 1);
    bytecode.push(type);
    storeArgument(node.argument, bytecode);   // update variable

    if (keepValue) 
        parseObject(node.argument, bytecode, true) // return the updated if keepValue is true
}

function simpleUnary(node : any, bytecode : Bytecode, operator : number, keepValue : boolean) : void
{
    parseObject(node.argument, bytecode, true);
    bytecode.push(operator);

    if (!keepValue) 
        bytecode.push(operators.POP);
}

function parseObject(node : any, bytecode : Bytecode = [], keepValue : boolean = false) : Bytecode
{
    const typeFunction = typeMap.get(node?.type);

    if (!typeFunction)
        errorTemplate(`parseObject`, `unknown node type "${node?.type}" with value ${node?.value} at line ${node?.row}:${node?.column}`);

    typeFunction(node, bytecode, keepValue);
    return bytecode;
}

function loopStatementHandler(statementName : string, bytecode : Bytecode, child : string) : void
{
    if (loopStack.length < 1) 
    {
        if (statementName === "break") 
            throw new runtimeErrors.BreakError();
        if (statementName === "continue") 
            throw new runtimeErrors.ContinueError();
    }
    const currentLoop = loopStack[loopStack.length - 1];
    
    if (child === "start")
    {
        const continuePosition = bytecode.length;
        bytecode.push(operators.JMP, 0);

        if (!currentLoop.continuePositions) currentLoop.continuePositions = [];

        currentLoop.continuePositions.push(continuePosition);
    }
    
    else
    {
        const breakPosition = bytecode.length;
        bytecode.push(operators.JMP, 0);
       
        if (!currentLoop.breakPositions) currentLoop.breakPositions = [];

        currentLoop.breakPositions.push(breakPosition);
    }
}

// Object.freeze makes this impossible to edit
const operators : Record<string, number> = Object.freeze({
    PUSH:       1,    // pushes a value on a stack
    LOAD:       2,    // loads a variable
    STORE:      3,    // stores a value in a variable
    ALLOC:      4,    // makes a new variable
    ADD:        5,    // short for addition
    SUB:        6,    // short for subtract
    MUL:        7,    // short for multiply
    DIV:        8,    // short for divide
    MOD:        9,    // short for modulo
    CALL:       10,   // calls a function
    NEG:        11,   // short for negative
    NOT:        12, 
    BITNOT:     13,   // makes the value negative, then adds -1 to the negative
    JMP:        14,   // jumps
    JZ:         15,   // jump if zero
    EQ:         16,   // ==
    NE:         17,   // !=
    GT:         18,   // >
    LT:         19,   // <
    GTE:        20,   // >=
    LTE:        21,   // <=
    POP:        22,   // pops one item from the stack
    PUSHSCP:    23,   // short for push scope
    POPSCP:     24,   // short for pop scope
    RETURN:     25,   // doesn't do anything
    EXEC:       26,   // runs the stack.pop()'s code
    MKFUNC:     27,   // stamps closure
    MKARR:      28,   // creates an array from n items on the stack
    ARRGET:     29,   // array index get
    ARRSET:     30,   // array index set
    MKOBJ:      31,   // creates an object from n items on the stack
    MKCLASS:    32,   // creates a class object
    MKINST:     33,   // creates an instance (new classname())
    SETLINE:    34,   // this GENUINELY doesn't need a comment but: sets the row and column
    SETFILE:    35,   // sets the current file name
    SPREAD:     36,   // spreaded arguments
    CALLMETHOD: 37,   
    TRY:        38,   // start try block
    ENDTRY:     39    // end try-catch
})

const binaryOperators : Record<string, number> = Object.freeze({
    "+":    operators.ADD,
    "-":    operators.SUB,
    "*":    operators.MUL,
    "/":    operators.DIV,
    "%":    operators.MOD,

    "==":   operators.EQ,
    "!=":   operators.NE,
    ">":    operators.GT,
    "<":    operators.LT,
    ">=":   operators.GTE,
    "<=":   operators.LTE
});

const unaryOperators : Map<string, (node : any, bytecode : Bytecode, keepValue : boolean) => void> = new Map([
    ["++", (node : any, bytecode : Bytecode, keepValue : boolean) =>   handleDecrementAndIncrementOperator(node, operators.ADD, bytecode, keepValue)], 
    ["--", (node : any, bytecode : Bytecode, keepValue : boolean) =>   handleDecrementAndIncrementOperator(node, operators.SUB, bytecode, keepValue)], 

    ["!", (node : any, bytecode : Bytecode, keepValue : boolean) =>    simpleUnary(node, bytecode, operators.NOT, keepValue)],
    ["~", (node : any, bytecode : Bytecode, keepValue : boolean) =>    simpleUnary(node, bytecode, operators.BITNOT, keepValue)],
    
    ["-u", (node : any, bytecode : Bytecode, keepValue : boolean) =>   simpleUnary(node, bytecode, operators.NEG, keepValue)],
    ["+u", (node : any, bytecode : Bytecode, keepValue : boolean) =>   parseObject(node.argument, bytecode, keepValue)],
]);

const loopStack : LoopInfo[] = [];

let tempCounter = 0;
function getTempName() : string
{
    return `__$temp${tempCounter++}`;
}

const typeMap : TypeMap = new Map([
    ["Program", 
        (node : any, bytecode : Bytecode) : void =>
            node.body.forEach(
                (n : any, i : number) =>
                    parseObject(n, bytecode, i === node.body.length - 1)
            )
    ],

    ["Literal",           (node : any, bytecode : Bytecode) : void => {bytecode.push(operators.PUSH, node.value)}],
    ["StringLiteral",     (node : any, bytecode : Bytecode) : void => {bytecode.push(operators.PUSH, node.value)}],
    ["VariableReference", 
        (node : any, bytecode : Bytecode) : void => 
        {
            bytecode.push(operators.SETLINE, node.row ?? 0, node.column ?? 0); 
            bytecode.push(operators.LOAD, node.value)
        }
    ],

    ["ArrayLiteral", 
        (node : any, bytecode : Bytecode, keepValue : boolean) : void =>
        {
            node.elements.forEach((element : any) => parseObject(element, bytecode, true));
            bytecode.push(operators.MKARR, node.elements.length);

            if (!keepValue) bytecode.push(operators.POP);
        }
    ],
    ["ObjectLiteral", 
        (node : any, bytecode : Bytecode, keepValue : boolean) : void =>
        {
            for (const property of node.properties)
            {
                bytecode.push(operators.PUSH, property.key);
                parseObject(property.value, bytecode, true);
            }
            bytecode.push(operators.MKOBJ, node.properties.length);

            if (!keepValue) bytecode.push(operators.POP);
        }
    ],

    ["ClassDeclaration", 
        (node : any, bytecode : Bytecode) : void =>
        {
            const methods : Record<string, any> = {};

            for (const method of node.methods)
            {
                const methodBytecode : Bytecode = [];
                (method.body ?? []).forEach((n : any) => parseObject(n, methodBytecode));
                methodBytecode.push(operators.PUSH, null);
                methodBytecode.push(operators.RETURN);

                const parameters = method.parameters.map
                (
                    (parameter: any) => 
                    (
                        {
                            name    : parameter.name,
                            rest    : parameter.rest,
                            default : parameter.default ? parseObject(parameter.default, [], true) : null
                        }
                    )
                );

                methods[method.name] = 
                {
                    name: method.name,
                    bytecode: methodBytecode,
                    parameters,
                    ast: method
                }
            }

            bytecode.push(operators.ALLOC, node.name);
            bytecode.push(operators.PUSH,
                {
                    name : node.name,
                    superclass : node.superclass,
                    methods
                }
            );       

            bytecode.push(operators.MKCLASS);
            bytecode.push(operators.STORE, node.name);
        }
    ],

    ["ClassInstantiation",
        (node : any, bytecode : Bytecode, keepValue : boolean) : void =>
        {
            const len = bytecode.length;
            node.args.forEach((argument : any) => parseObject(argument, bytecode, true));
            bytecode.push(operators.MKINST, node.className, node.args.length);
            
            if (!keepValue) 
                bytecode.push(operators.POP);
        }
    ],

    ["ArrayAccess", 
        (node : any, bytecode : Bytecode, keepValue : boolean) : void =>
        {
            bytecode.push(operators.SETLINE, node.row ?? 0, node.column ?? 0);

            parseObject(node.object, bytecode, true);
            parseObject(node.index, bytecode, true);
            bytecode.push(operators.ARRGET);

            if (!keepValue) bytecode.push(operators.POP);
        }
    ],

    ["MemberExpression", 
        (node : any, bytecode : Bytecode, keepValue : boolean) : void =>
        {
            bytecode.push(operators.SETLINE, node.row ?? 0, node.column ?? 0);

            parseObject(node.object, bytecode, true);
            bytecode.push(operators.PUSH, node.property);
            bytecode.push(operators.ARRGET);

            if (!keepValue) bytecode.push(operators.POP);
        }
    ],

    ["BinaryExpression", 
        (node : any, bytecode : Bytecode, keepValue : boolean) : void =>
        {
            parseObject(node.left, bytecode, true);
            parseObject(node.right, bytecode, true);

            const operator : number = binaryOperators[node.operator];

            if (!operator) 
                errorTemplate(`BinaryExpression`, `Unknown operator "${node.operator}"`);

            bytecode.push(operator);

            if (!keepValue) bytecode.push(operators.POP);
        }
    ],

    ["LogicalExpression", 
        (node : any, bytecode : Bytecode, keepValue : boolean) : void =>
        {
            parseObject(node.left, bytecode, true);

            if (node.operator === "&&")
            {
                const jumpToFalse : number = bytecode.length;
                bytecode.push(operators.JZ, 0);

                parseObject(node.right, bytecode, true);
                
                const jumpToEnd : number = bytecode.length;
                bytecode.push(operators.JMP, 0);
                
                const falseLabel : number = bytecode.length;
                bytecode[jumpToFalse + 1] = falseLabel;
                bytecode.push(operators.PUSH, 0);
                
                const end : number = bytecode.length;
                bytecode[jumpToEnd + 1] = end;
            }

            else
            {
                const jumpIfFalse : number = bytecode.length;
                bytecode.push(operators.JZ, 0);

                bytecode.push(operators.PUSH, 1);
                
                const jumpToEnd : number = bytecode.length;
                bytecode.push(operators.JMP, 0);
                
                const falseLabel : number = bytecode.length;
                bytecode[jumpIfFalse + 1] = falseLabel;
                parseObject(node.right, bytecode, true);
                
                const end : number = bytecode.length;
                bytecode[jumpToEnd + 1] = end;
            }

            if (!keepValue) bytecode.push(operators.POP);
        }
    ],

    ["ContinueStatement", (node : any, bytecode : Bytecode) : void => loopStatementHandler("continue", bytecode, "start")],
    ["BreakStatement", (node : any, bytecode : Bytecode)    : void => loopStatementHandler("break", bytecode, "end")],

    ["NewDeclaration", (node : any, bytecode : Bytecode) : number => bytecode.push(operators.ALLOC, node.name)],

    ["NewAssignment", 
        (node : any, bytecode) =>
        {
            bytecode.push(operators.SETLINE, node.row ?? 0, node.column ?? 0);

            bytecode.push(operators.ALLOC, node.name);
            if (node.value !== null) parseObject(node.value, bytecode, true);
            bytecode.push(operators.STORE, node.name);
        }
    ],

    ["Assignment", 
        (node : any, bytecode : Bytecode, keepValue : boolean) : void =>
        {
            bytecode.push(operators.SETLINE, node.row ?? 0, node.column ?? 0);

            parseObject(node.value, bytecode, true);
            if (typeof node.name === "string") 
            {
                bytecode.push(operators.STORE, node.name);
                if (keepValue) bytecode.push(operators.LOAD, node.name);
            }
            else if (node.name.type === "MemberExpression")
            {
                parseObject(node.name.object, bytecode, true);
                bytecode.push(operators.PUSH, node.name.property);
                bytecode.push(operators.ARRSET);
            }   
            else
            {
                parseObject(node.name.object, bytecode, true);
                parseObject(node.name.index, bytecode, true);
                bytecode.push(operators.ARRSET);
            }
        }
    ],

    ["FunctionCall", 
        (node : any, bytecode : Bytecode, keepValue : boolean = false) : void =>
        {
            bytecode.push(operators.SETLINE, node.row ?? 0, node.column ?? 0);

            node.args.forEach
            (
                (argument : any) => 
                {
                    if (argument.type === "SpreadElement")
                    {
                        parseObject(argument.argument, bytecode, true);
                        bytecode.push(operators.SPREAD);
                    }
                    else
                        parseObject(argument, bytecode, true);
                }
            );

            bytecode.push(operators.CALL, node.name, node.args.length);
            if (!keepValue) bytecode.push(operators.POP);
        }
    ],

    ["UnaryExpression",
        (node : any, bytecode : Bytecode, keepValue : boolean) : void =>
        {
            const operatorFunction = unaryOperators.get(node.value);
            if (!operatorFunction) throw new Error(`Unknown unary operator: "${node.value}"`);
            operatorFunction(node, bytecode, keepValue)
        }
    ],

    ["PostfixUnaryExpression",
        (node : any, bytecode : Bytecode, keepValue : boolean) : void =>
        {
            if (keepValue)
            {
                const tempName : string = getTempName();
                bytecode.push(operators.ALLOC, tempName);                 // make the temp variable

                parseObject(node.argument, bytecode, true);
                bytecode.push(operators.STORE, tempName);                 // store the current value

                parseObject(node.argument, bytecode, true);
                bytecode.push(operators.PUSH, 1);
                bytecode.push(node.operator === "++" ? operators.ADD : operators.SUB);
                storeArgument(node.argument, bytecode);      // minus the variable by one

                bytecode.push(operators.LOAD, tempName);                  // load the previous value if keepValue is true
            }

            else
            {
                parseObject(node.argument, bytecode, true);
                bytecode.push(operators.PUSH, 1);
                bytecode.push(node.operator === "++" ? operators.ADD : operators.SUB);
                storeArgument(node.argument, bytecode);      // minus the variable by one
            }
        }
    ],

    ["IfStatement",
        (node : any, bytecode : Bytecode) : void =>
        {   
            bytecode.push(operators.SETLINE, node.row ?? 0, node.column ?? 0);

            parseObject(node.condition, bytecode, true);
            const elseLabel : number = 0;
            const endLabel  : number = 1;

            const JZPosition : number = bytecode.length;
            bytecode.push(operators.JZ, elseLabel);

            bytecode.push(operators.PUSHSCP);                   // pushes an object to store local variables in
            node.body.forEach((n : any) => parseObject(n, bytecode));   // parse the body which is a list
            bytecode.push(operators.POPSCP);                    // delete the local variables 
        
            const JMPPosition : number = bytecode.length;
            bytecode.push(operators.JMP, endLabel);

            const elsePosition : number = bytecode.length;
            bytecode[JZPosition + 1] = elsePosition;

            if (node.else)
            {
                bytecode.push(operators.PUSHSCP);
                node.else.forEach((n : any) => parseObject(n, bytecode));  // parse the else
                bytecode.push(operators.POPSCP);
            }

            const endPosition : number = bytecode.length;
            bytecode[JMPPosition + 1] = endPosition;
        }
    ],

    ["TernaryExpression",
        (node : any, bytecode : Bytecode, keepValue : boolean) : void =>
        {
            parseObject(node.condition, bytecode, true);

            const JZPosition : number = bytecode.length;
            bytecode.push(operators.JZ, 0);

            parseObject(node.then, bytecode, true);

            const JMPPosition : number = bytecode.length;
            bytecode.push(operators.JMP, 0);

            const elsePosition : number = bytecode.length;
            bytecode[JZPosition + 1] = elsePosition;

            parseObject(node.else, bytecode, true);

            const endPosition : number = bytecode.length;
            bytecode[JMPPosition + 1] = endPosition;

            if (!keepValue) bytecode.push(operators.POP);
        }
    ],

    ["ForStatement", 
        (node : any, bytecode : Bytecode) : void =>
        {
            bytecode.push(operators.SETLINE, node.row ?? 0, node.column ?? 0);

            bytecode.push(operators.PUSHSCP);
            if (node.initial) parseObject(node.initial, bytecode);

            const start : number = bytecode.length;
            
            const loopInfo : LoopInfo =
            { 
                start,
                continueTarget: null,
                end: null,
                breakPositions: [],
                continuePositions: []
            };
            loopStack.push(loopInfo);

            if (node.condition) parseObject(node.condition, bytecode, true);
            const jumpValueToEndPosition = bytecode.length;
            bytecode.push(operators.JZ, 0);

            bytecode.push(operators.PUSHSCP);
            node.body.forEach((n : any) => parseObject(n, bytecode));
            bytecode.push(operators.POPSCP);

            loopInfo.continueTarget = bytecode.length; 

            if (node.update) parseObject(node.update, bytecode);

            bytecode.push(operators.JMP, start);
            
            const end : number = bytecode.length;
            loopInfo.end = end;
            
            bytecode[jumpValueToEndPosition + 1] = end;

            const positions : Array<{position : number, target : number | null}> =
            [
                ...loopInfo.breakPositions.map(position => ({
                    position,
                    target: end
                })),

                ...loopInfo.continuePositions.map(position => ({
                    position,
                    target: loopInfo.continueTarget
                }))
            ]
            
            for (const {position, target} of positions) bytecode[position + 1] = target;
            
            loopStack.pop();
            bytecode.push(operators.POPSCP);
        }
    ],

    ["WhileStatement",
        (node : any, bytecode : Bytecode) : void =>
        {
            bytecode.push(operators.SETLINE, node.row ?? 0, node.column ?? 0);

            const start : number = bytecode.length;
            
            const loopInfo : LoopInfo = { 
                start,
                continueTarget: start,
                end: null,
                breakPositions: [],
                continuePositions: []
            };
            loopStack.push(loopInfo);

            parseObject(node.condition, bytecode, true);   // keepValue has to be true to push the condition result on the stack for JZ to read
            
            const jumpValueToEndPosition : number = bytecode.length;
            bytecode.push(operators.JZ, 0);

            bytecode.push(operators.PUSHSCP);
            node.body.forEach((n : any) => parseObject(n, bytecode));
            bytecode.push(operators.POPSCP);

            bytecode.push(operators.JMP, start);
            
            const end : number = bytecode.length;
            loopInfo.end = end;
            
            bytecode[jumpValueToEndPosition + 1] = end;
            
            const positions : Array<{position : number, target : number | null}> =
            [
                ...loopInfo.breakPositions.map(position => ({
                    position,
                    target: end
                })),

                ...loopInfo.continuePositions.map(position => ({
                    position,
                    target: loopInfo.continueTarget
                }))
            ]
            
            for (const {position, target} of positions) bytecode[position + 1] = target;
            
            loopStack.pop();
        }
    ],

    ["TryStatement", 
        (node : any, bytecode : Bytecode) : void =>
        {
            bytecode.push(operators.SETLINE, node.row ?? 0, node.column ?? 0);

            const tryStartPosition = bytecode.length;
            bytecode.push(operators.TRY, 0, 0); // [TRY, catchPosition, finallyPosition]

            // parse try body
            bytecode.push(operators.PUSHSCP);
            node.tryBlock.forEach((n: any) => parseObject(n, bytecode));
            bytecode.push(operators.POPSCP);

            // jump past catch block if no error occurred
            const skipCatchPosition = bytecode.length;
            bytecode.push(operators.JMP, 0);

            // catch block
            const catchPosition = bytecode.length;
            bytecode[tryStartPosition + 1] = catchPosition;

            bytecode.push(operators.PUSHSCP);
            bytecode.push(operators.ALLOC, node.errorVariable);
            bytecode.push(operators.STORE, node.errorVariable);

            node.catchBlock.forEach((n: any) => parseObject(n, bytecode));
            bytecode.push(operators.POPSCP);

            // end of catch block
            const afterCatchPosition = bytecode.length;
            bytecode[skipCatchPosition + 1] = afterCatchPosition;

            if (node.finallyBlock)
            {
                const finallyPosition = bytecode.length;
                bytecode[tryStartPosition + 2] = finallyPosition;

                bytecode.push(operators.PUSHSCP);
                node.finallyBlock.forEach((n: any) => parseObject(n, bytecode));
                bytecode.push(operators.POPSCP);
            }
            else
                bytecode[tryStartPosition + 2] = afterCatchPosition;

            bytecode.push(operators.ENDTRY);
        }
    ],

    ["FunctionDeclaration",
        (node : any, bytecode : Bytecode) : void =>
        {
            bytecode.push(operators.SETLINE, node.row ?? 0, node.column ?? 0);
            
            const newBytecode : Bytecode = [];
        
            node.body.forEach((n : any) => parseObject(n, newBytecode));

            // make sure the function returns smth
            newBytecode.push(operators.PUSH, null);
            newBytecode.push(operators.RETURN);

            bytecode.push(operators.ALLOC, node.name);

            const parameters = node.parameters.map
            (
                (parameter: any) => 
                (
                    {
                        name    : parameter.name,
                        rest    : parameter.rest,
                        default : parameter.default ? parseObject(parameter.default, [], true) : null
                    }
                )
            );

            const functionObject =
            {
                bytecode: newBytecode,
                parameters,
                ast: node
            };

            bytecode.push(operators.PUSH, functionObject);
            bytecode.push(operators.MKFUNC);
            bytecode.push(operators.STORE, node.name);
        }
    ],

    ["MethodCall",
        (node : any, bytecode : Bytecode, keepValue : boolean) =>
        {
            bytecode.push(operators.SETLINE, node.row ?? 0, node.column ?? 0);

            parseObject(node.object, bytecode, true);
            bytecode.push(operators.PUSH, node.property);
            
            node.args.forEach
            (
                (argument : any) => 
                {
                    if (argument.type === "SpreadElement")
                    {
                        parseObject(argument.argument, bytecode, true);
                        bytecode.push(operators.SPREAD);
                    }
                    else
                        parseObject(argument, bytecode, true);
                }
            );

            bytecode.push(operators.CALLMETHOD, node.args.length);

            if (!keepValue) 
                bytecode.push(operators.POP);
        }
    ],

    ["FunctionExpression",
        (node : any, bytecode : Bytecode, keepValue : boolean = true) : void =>
        {
            const newBytecode : Bytecode = [];

            node.body.forEach((n : any) => parseObject(n, newBytecode));

            newBytecode.push(operators.PUSH, null);
            newBytecode.push(operators.RETURN);

            const parameters = node.parameters.map
            (
                (parameter: any) =>
                (
                    {
                        name    : parameter.name,
                        rest    : parameter.rest,
                        default : parameter.default ? parseObject(parameter.default, [], true) : null
                    }
                )
            );

            const functionObject : {bytecode: Bytecode, parameters : any, ast : any}=
            {
                bytecode: newBytecode,
                parameters,
                ast: node
            }

            bytecode.push(operators.PUSH, functionObject);
            bytecode.push(operators.MKFUNC);
            if (node.name) 
                bytecode.push(operators.STORE, node.name);

            if (!keepValue) 
                bytecode.push(operators.POP);
        }
    ],

    ["ReturnStatement",
        (node : any, bytecode : Bytecode) : void =>
        {
            bytecode.push(operators.SETLINE, node.row ?? 0, node.column ?? 0);

            if (node.argument) 
                parseObject(node.argument, bytecode, true);
            bytecode.push(operators.RETURN);
        }
    ],

    ["ImportStatement",
        (node : any, bytecode : Bytecode) : void =>
        {
            bytecode.push(operators.SETLINE, node.row ?? 0, node.column ?? 0);
            bytecode.push(operators.PUSH, node.path);
            bytecode.push(operators.EXEC);
        }
    ],
]);

export function buildBytecode(ast : any, filename : string = "<anonymous>")
{
    tempCounter = 0;
    const bytecode : Bytecode = [];

    bytecode.push(operators.SETFILE, filename);

    parseObject(ast, bytecode);

    //console.dir(bytecode, {depth: null, colors: true});
    return bytecode;
}