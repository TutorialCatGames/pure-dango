import {runtimeErrors} from "../runtime/errors.ts";

function storeArgument(argument, bytecode)
{
    if (argument.type === "VariableReference") bytecode.push(operators.STORE, argument.value);
    else if (argument.type === "ArrayAccess")
    {
        parseObject(argument.object, bytecode, true);
        parseObject(argument.index, bytecode, true);
        bytecode.push(operators.ARRSET);
    }
    else throw new Error(`Invalid assignment target: "${argument.type}"`);
}

function handleDecrementAndIncrementOperator(node, type, bytecode, keepValue)
{
    parseObject(node.argument, bytecode, true);
    bytecode.push(operators.PUSH, 1);
    bytecode.push(type);
    storeArgument(node.argument, bytecode);   // update variable

    if (keepValue) parseObject(node.argument, bytecode, true) // return the updated if keepValue is true
}

function simpleUnary(node, bytecode, operator, keepValue)
{
    parseObject(node.argument, bytecode, true);
    bytecode.push(operator);

    if (!keepValue) bytecode.push(operators.POP);
}

function parseObject(node, bytecode = [], keepValue = false)
{
    const typeFunction = typeMap.get(node.type);

    if (!typeFunction)
    {
        throw new Error(`Unknown node type "${node.type}" with value ${node.value}`);
    }

    typeFunction(node, bytecode, keepValue);
    return bytecode;
}

function loopStatementHandler(statementName, bytecode, child)
{
    if (loopStack.length < 1) 
    {
        if (statementName === "break") throw new runtimeErrors.BreakError();
        if (statementName === "continue") throw new runtimeErrors.ContinueError();
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
const operators = Object.freeze({
    PUSH:      1,    // pushes a value on a stack
    LOAD:      2,    // loads a variable
    STORE:     3,    // stores a value in a variable
    ALLOC:     4,    // makes a new variable
    ADD:       5,    // short for addition
    SUB:       6,    // short for subtract
    MUL:       7,    // short for multiply
    DIV:       8,    // short for divide
    MOD:       9,    // short for modulo
    CALL:      10,   // calls a function
    NEG:       11,   // short for negative
    NOT:       12, 
    BITNOT:    13,   // makes the value negative, then adds -1 to the negative
    JMP:       14,   // jumps
    JZ:        15,   // jump if zero
    EQ:        16,   // ==
    NE:        17,   // !=
    GT:        18,   // >
    LT:        19,   // <
    GTE:       20,   // >=
    LTE:       21,   // <=
    POP:       22,   // pops one item from the stack
    PUSHSCP:   23,   // short for push scope
    POPSCP:    24,   // short for pop scope
    RETURN:    25,   // doesn't do anything
    EXEC:      26,   // runs the stack.pop()'s code
    MKFUNC:    27,   // stamps closure
    MKARR:     28,   // creates an array from n items on the stack
    ARRGET:    29,   // array index get
    ARRSET:    30    // array index set
})

const binaryOperators = Object.freeze({
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

const unaryOperators = new Map([
    ["++", (node, bytecode, keepValue) =>   handleDecrementAndIncrementOperator(node, operators.ADD, bytecode, keepValue)], 
    ["--", (node, bytecode, keepValue) =>   handleDecrementAndIncrementOperator(node, operators.SUB, bytecode, keepValue)], 

    ["!", (node, bytecode, keepValue) =>    simpleUnary(node, bytecode, operators.NOT, keepValue)],
    ["~", (node, bytecode, keepValue) =>    simpleUnary(node, bytecode, operators.BITNOT, keepValue)],
    
    ["-u", (node, bytecode, keepValue) =>   simpleUnary(node, bytecode, operators.NEG, keepValue)],
    ["+u", (node, bytecode, keepValue) =>   parseObject(node.argument, bytecode, keepValue)],
]);

const loopStack = [];

let tempCounter = 0;
function getTempName()
{
    return `__$temp${tempCounter++}`;
}

const typeMap = new Map([
    ["Program", (node, bytecode) =>             node.body.forEach(n => parseObject(n, bytecode))],

    ["Literal", (node, bytecode) =>             bytecode.push(operators.PUSH, node.value)],
    ["StringLiteral", (node, bytecode) =>       bytecode.push(operators.PUSH, node.value)],
    ["ArrayLiteral", (node, bytecode, keepValue) => {
        node.elements.forEach(element => parseObject(element, bytecode, true));
        bytecode.push(operators.MKARR, node.elements.length);

        if (!keepValue) bytecode.push(operators.POP);
    }],
    ["VariableReference", (node, bytecode) =>   bytecode.push(operators.LOAD, node.value)],

    ["ArrayAccess", (node, bytecode, keepValue) => {
        parseObject(node.object, bytecode, true);
        parseObject(node.index, bytecode, true);
        bytecode.push(operators.ARRGET);

        if (!keepValue) bytecode.push(operators.POP);
    }],

    ["BinaryExpression", 
        (node, bytecode, keepValue) => {
            parseObject(node.left, bytecode, true);
            parseObject(node.right, bytecode, true);

            const operator = binaryOperators[node.operator];

            if (!operator) throw new Error(`Unknown operator "${node.operator}"`);

            bytecode.push(operator);

            if (!keepValue) bytecode.push(operators.POP);
        }
    ],

    ["LogicalExpression", 
        (node, bytecode, keepValue) => {
            parseObject(node.left, bytecode, true);

            if (node.operator === "&&")
            {
                const jumpToFalse = bytecode.length;
                bytecode.push(operators.JZ, 0);

                parseObject(node.right, bytecode, true);
                
                const jumpToEnd = bytecode.length;
                bytecode.push(operators.JMP, 0);
                
                const falseLabel = bytecode.length;
                bytecode[jumpToFalse + 1] = falseLabel;
                bytecode.push(operators.PUSH, 0);
                
                const end = bytecode.length;
                bytecode[jumpToEnd + 1] = end;
            }

            else
            {
                const jumpIfFalse = bytecode.length;
                bytecode.push(operators.JZ, 0);

                bytecode.push(operators.PUSH, 1);
                
                const jumpToEnd = bytecode.length;
                bytecode.push(operators.JMP, 0);
                
                const falseLabel = bytecode.length;
                bytecode[jumpIfFalse + 1] = falseLabel;
                parseObject(node.right, bytecode, true);
                
                const end = bytecode.length;
                bytecode[jumpToEnd + 1] = end;
            }

            if (!keepValue) bytecode.push(operators.POP);
        }
    ],

    ["ContinueStatement", (node, bytecode) =>   loopStatementHandler("continue", bytecode, "start")],
    ["BreakStatement", (node, bytecode) =>      loopStatementHandler("break", bytecode, "end")],

    ["NewDeclaration", (node, bytecode) =>      bytecode.push(operators.ALLOC, node.name)],

    ["NewAssignment", 
        (node, bytecode) => {
            bytecode.push(operators.ALLOC, node.name);
            if (node.value !== null) parseObject(node.value, bytecode, true);
            bytecode.push(operators.STORE, node.name);
        }
    ],

    ["Assignment", 
        (node, bytecode, keepValue) => {
            parseObject(node.value, bytecode, true);
            if (typeof node.name === "string") 
            {
                bytecode.push(operators.STORE, node.name);
                if (keepValue) bytecode.push(operators.LOAD, node.name);
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
        (node, bytecode, keepValue = false) => {
            node.args.forEach(argument => parseObject(argument, bytecode, true));

            bytecode.push(operators.CALL, node.name, node.args.length);
            if (!keepValue) bytecode.push(operators.POP);
        }
    ],

    ["UnaryExpression", (node, bytecode, keepValue) => {
        const operatorFunction = unaryOperators.get(node.value);

        if (!operatorFunction)
        {
            throw new Error(`Unknown unary operator: "${node.value}"`);
        }

        operatorFunction(node, bytecode, keepValue)
    }],

    ["PostfixUnaryExpression", (node, bytecode, keepValue) => {
            if (keepValue)
            {
                const tempName = getTempName();
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

    ["IfStatement", (node, bytecode) => {

        parseObject(node.condition, bytecode, true);
        const elseLabel = 0;
        const endLabel = 1;

        const JZPosition = bytecode.length;
        bytecode.push(operators.JZ, elseLabel);

        bytecode.push(operators.PUSHSCP);                   // pushes an object to store local variables in
        node.body.forEach(n => parseObject(n, bytecode));   // parse the body which is a list
        bytecode.push(operators.POPSCP);                    // delete the local variables 
       
        const JMPPosition = bytecode.length;
        bytecode.push(operators.JMP, endLabel);

        const elsePosition = bytecode.length;
        bytecode[JZPosition + 1] = elsePosition;

        if (node.else)
        {
            bytecode.push(operators.PUSHSCP);
            node.else.forEach(n => parseObject(n, bytecode));  // parse the else
            bytecode.push(operators.POPSCP);
        }

        const endPosition = bytecode.length;
        bytecode[JMPPosition + 1] = endPosition;
    }],

    ["TernaryExpression", (node, bytecode, keepValue) => {
        parseObject(node.condition, bytecode, true);

        const JZPosition = bytecode.length;
        bytecode.push(operators.JZ, 0);

        parseObject(node.then, bytecode, true);

        const JMPPosition = bytecode.length;
        bytecode.push(operators.JMP, 0);

        const elsePosition = bytecode.length;
        bytecode[JZPosition + 1] = elsePosition;

        parseObject(node.else, bytecode, true);

        const endPosition = bytecode.length;
        bytecode[JMPPosition + 1] = endPosition;

        if (!keepValue) bytecode.push(operators.POP);
    }],

    ["ForStatement", (node, bytecode) => {
        bytecode.push(operators.PUSHSCP);
        if (node.initial) parseObject(node.initial, bytecode);

        const start = bytecode.length;
        
        const loopInfo =
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
        node.body.forEach(n => parseObject(n, bytecode));
        bytecode.push(operators.POPSCP);

        loopInfo.continueTarget = bytecode.length; 

        if (node.update) parseObject(node.update, bytecode);

        bytecode.push(operators.JMP, start);
        
        const end = bytecode.length;
        loopInfo.end = end;
        
        bytecode[jumpValueToEndPosition + 1] = end;

        const positions =
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
        
        for (const {position, target} of positions)
        {
            bytecode[position + 1] = target;
        }
        
        loopStack.pop();
        bytecode.push(operators.POPSCP);
    }],

    ["WhileStatement", (node, bytecode) => {
        const start = bytecode.length;
        
        const loopInfo = { 
            start,
            continueTarget: start,
            end: null,
            breakPositions: [],
            continuePositions: []
        };
        loopStack.push(loopInfo);

        parseObject(node.condition, bytecode, true);   // keepValue has to be true to push the condition result on the stack for JZ to read
        
        const jumpValueToEndPosition = bytecode.length;
        bytecode.push(operators.JZ, 0);

        bytecode.push(operators.PUSHSCP);
        node.body.forEach(n => parseObject(n, bytecode));
        bytecode.push(operators.POPSCP);

        bytecode.push(operators.JMP, start);
        
        const end = bytecode.length;
        loopInfo.end = end;
        
        bytecode[jumpValueToEndPosition + 1] = end;
        
        const positions =
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
        
        for (const {position, target} of positions)
        {
            bytecode[position + 1] = target;
        }
        
        loopStack.pop();
    }],

    ["FunctionDeclaration", (node, bytecode) => {
        const newBytecode = [];
    
        node.body.forEach(n => parseObject(n, newBytecode));

        // make sure the function returns smth
        newBytecode.push(operators.PUSH, null);
        newBytecode.push(operators.RETURN);

        bytecode.push(operators.ALLOC, node.name);

        const functionObject =
        {
            bytecode: newBytecode,
            parameters: node.parameters,
            origin: node.origin
        };

        bytecode.push(operators.PUSH, functionObject);
        bytecode.push(operators.MKFUNC);
        bytecode.push(operators.STORE, node.name);
    }],

    ["FunctionExpression", (node, bytecode, keepValue = true) => {
        const newBytecode = [];

        node.body.forEach(n => parseObject(n, newBytecode));

        newBytecode.push(operators.PUSH, null);
        newBytecode.push(operators.RETURN);

        const functionObject =
        {
            bytecode: newBytecode,
            parameters: node.parameters,
            origin: node.origin
        }

        bytecode.push(operators.PUSH, functionObject);
        bytecode.push(operators.MKFUNC);
        if (node.name) bytecode.push(operators.STORE, node.name);

        if (!keepValue) bytecode.push(operators.POP);
    }],

    ["ReturnStatement", (node, bytecode) => {
        if (node.argument) parseObject(node.argument, bytecode, true);
        bytecode.push(operators.RETURN);
    }],

    ["ImportStatement", (node, bytecode, keepValue = true) => {
        bytecode.push(operators.PUSH, node.path);
        bytecode.push(operators.EXEC);
    }],
]);

export function buildBytecode(ast)
{
    tempCounter = 0;
    const bytecode = [];

    parseObject(ast, bytecode);

    //console.dir(bytecode, {depth: null, colors: true});
    return bytecode;
}