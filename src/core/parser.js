import {parseErrors} from "../runtime/errors.js";

const OPERATORS =
{
    "+": {prec: 10, assoc: "left", type:"binary"},
    "-": {prec: 10, assoc: "left", type:"binary"},
    "*": {prec: 20, assoc: "left", type:"binary"},
    "/": {prec: 20, assoc: "left", type:"binary"},
    "%": {prec: 20, assoc: "left", type: "binary"},

    "=": {prec: 5, assoc: "right", type: "assignment"},
    "-=": {prec: 5, assoc: "right", type: "assignment"},
    "+=": {prec: 5, assoc: "right", type: "assignment"},
    "*=": {prec: 5, assoc: "right", type: "assignment"},
    "/=": {prec: 5, assoc: "right", type: "assignment"},

    "==": {prec: 7, assoc: "left", type:"binary"},
    "!=": {prec: 7, assoc: "left", type:"binary"},
    ">": {prec: 8, assoc: "left", type:"binary"},
    "<": {prec: 8, assoc: "left", type:"binary"},
    ">=": {prec: 8, assoc: "left", type:"binary"},
    "<=": {prec: 8, assoc: "left", type:"binary"},

    "&&": {prec: 3, assoc: "right", type: "logical"},
    "||": {prec: 4, assoc: "right", type: "logical"},

    "!": {prec: 30, assoc: "right", type: "unary", fix: "prefix"},
    "~": {prec: 30, assoc: "right", type: "unary", fix: "prefix"},
    "+u": {prec: 30, assoc: "right", type: "unary", fix: "prefix"},
    "-u": {prec: 30, assoc: "right", type: "unary", fix: "prefix"},
    "++": {prec: 30, assoc: "right", type: "unary", fix: "both"},
    "--": {prec: 30, assoc: "right", type: "unary", fix: "both"}
}

// returns item state.position of tokens
function peek(tokens, state)
{
    return tokens[state.position];
}

// returns item state.position + 1 of tokens, and adds 1 to state.position
function next(tokens, state)
{
    if (state.position >= tokens.length) return null;
    return tokens[state.position++];
}

function isUnaryPrefix(operator) {
    return OPERATORS[operator]?.type === "unary" &&
           OPERATORS[operator].fix !== "postfix";
}

function parseStartingToken(token, tokens, state)
{
    //console.log("=== parseStartingToken called ===");
    //console.log("Token:", token ? `${token.type} "${token.value}"` : "null");
    //console.log("State position:", state.position);

    if (!token) {
        throw new Error(`Unexpected end of input`);
    }

    // makes it easier to read
    let {
        type,
        value, 
        row,
        column
    } = token;

    if (type === "Operator" && (value === "+" || value === "-"))
    {
        const previousToken = tokens[state.position - 2];

        const isUnaryContext =
            !previousToken || 
            (previousToken.type === "Operator" && previousToken.value !== ")" && previousToken.value !== "++" && previousToken.value !== "--") ||
            previousToken.value === "(" ||
            previousToken.value === "," ||
            (OPERATORS[previousToken.value] && OPERATORS[previousToken.value].type === "assignment");

        if (isUnaryContext) 
        {
            console.log("CHANGING ", value, " to ", value + "u");
            value += "u"
        }

        else
        {   
            console.log("NOT changing ", value, " (stays as binary)")
        }
    }

    if (
        type === "Literal" ||
        type === "StringLiteral"
    )
    {
        return {
            type,
            value,
            row,
            column
        }
    }

    if (isUnaryPrefix(value))
    {
        const valueObject = OPERATORS[value];
        const operand = parseExpression(tokens, valueObject.prec, state);

        if (valueObject.fix === "both")
        {
            return {
                type: "UnaryExpression",
                value: value.toString(),
                argument: operand,
                row,
                column
            };
        }

        if (valueObject.fix === "prefix")
        {
            return {
                type: "UnaryExpression",
                value,
                argument: operand,
                row,
                column
            }
        }

        throw new Error(`UnaryOperatorError: Unknown fix type for unary operator "${value}" at row ${row}, char ${column}`);
    }

    if (type === "Identifier")
    {
        const peekToken = peek(tokens, state);

        // if the first item of tokens is "(" then treat it as a function
        if (peekToken && peekToken.value === "(")
        {
            return parseFunctionCall(value, tokens, state);
        }

        return {
            type: "VariableReference",
            value,
            row,
            column
        }
    }

    if (value === "(")
    {
        const expression = parseExpression(tokens, 0, state);
        
        const peekToken = peek(tokens, state);
        if (!peekToken || peekToken.value !== ")") throw new parseErrors.MissingTokenError(")", expression.row, expression.column);

        next(tokens, state);

        return expression;
    }

    if (value === ";") return null;

    throw new parseErrors.UnexpectedTokenError(value, row, column);
}

// parse the expression using shunting-yard
function parseExpression(tokens, minimumPrecedence = 0, state, stopAtComma = false)
{
    const stoppingCheck = (token) =>
    {
        if (!token) return true;

        if (token.value === ")") return true;

        if (stopAtComma && token.value === ",") return true;

        return false;
    };

    const attachPostfix = (node) =>
    {
        let lastOperator = null;

        while (true) {
            const token = peek(tokens, state);
            if (stoppingCheck(token)) break;

            const info = OPERATORS[token.value];
            if (!info || info.type !== "unary" || !(info.fix === "postfix" || info.fix === "both")) break;
            if ((lastOperator === "++" || lastOperator === "--") && (token.value === "++" || token.value === "--"))
                throw new parseErrors.ChainedIncDecError(token.row, token.column);
            
            if (node.type !== "VariableReference") throw new parseErrors.InvalidPostfixError(token.value, node.type, node.value, node.row, node.column);
            const operator = next(tokens, state);
            node = {
                type: "PostfixUnaryExpression",
                operator: operator.value,
                argument: node,
                row: operator.row,
                column: operator.column
            };

            lastOperator = operator.value;
        }

        return node;
    }

    
    let operatorStack = [];
    let outputStack = [];

    let token = next(tokens, state);
    if (!token) return null;

    let node = parseStartingToken(token, tokens, state);
    node = attachPostfix(node);
    outputStack.push(node);
    while (true)
    {
        let token = peek(tokens, state);
        if (stoppingCheck(token)) break;

        const operatorInfo = OPERATORS[token.value];
        if (!operatorInfo || operatorInfo.prec < minimumPrecedence) break;

        const operator = next(tokens, state);

        while (outputStack.length > 0)
        {
            const topOperator = operatorStack[operatorStack.length - 1];
            const topInfo = OPERATORS[topOperator?.value] ?? null;
            if (!topInfo) break;

            if (
                topInfo.type !== "assignment" &&
                (
                    (operatorInfo.assoc === "left" && operatorInfo.prec <= topInfo.prec) ||
                    (operatorInfo.assoc === "right" && operatorInfo.prec < topInfo.prec)
                )
            )
            {
                if (topInfo.type === "unary")
                {
                    const operand = outputStack.pop();
                    outputStack.push({
                        type: "UnaryExpression",
                        value: topOperator.value,
                        argument: operand,
                        row: topOperator.row,
                        column: topOperator.column
                    });
                }
                else
                {
                    const rightNode = outputStack.pop();
                    const leftNode = outputStack.pop();

                    outputStack.push({
                        type: topInfo.type === "logical" ? "LogicalExpression" : "BinaryExpression",
                        operator: topOperator.value,
                        left: leftNode,
                        right: rightNode,
                        row: topOperator.row,
                        column: topOperator.column
                    });
                }

                operatorStack.pop();
            } else break;
        }

        if (operatorInfo.type === "assignment")
        {
            const leftNode = outputStack.pop();
            if (leftNode.type !== "VariableReference") throw new parseErrors.AssignmentError(operator.value, operator.row, operator.column);

            const rightNode = parseExpression(tokens, operatorInfo.prec, state, stopAtComma);

            const baseOperators =
            {
                "+=": "+",
                "-=": "-",
                "*=": "*",
                "/=": "/",
                "%=": "%"
            }

            outputStack.push({
                type: "Assignment",
                name: leftNode.value,
                value: operator.value === "="
                    ? rightNode
                    : {
                        type: OPERATORS[baseOperators[operator.value]]?.type === "logical"
                            ? "LogicalExpression"
                            : "BinaryExpression",
                        operator: baseOperators[operator.value],
                        left: leftNode,
                        right: rightNode
                    },
                row: operator.row,
                column: operator.column
            });

            break;
        }

        operatorStack.push(operator);

        let nextToken = next(tokens, state);
        if (!nextToken) break;
        let node = attachPostfix(parseStartingToken(nextToken, tokens, state));

        outputStack.push(node);
    }

    while (operatorStack.length) {
        const operator = operatorStack.pop();
        const operatorInfo = OPERATORS[operator.value];
        if (operatorInfo.type === "unary")
        {
            const operand = outputStack.pop(); // take one value
            outputStack.push({
                type: "UnaryExpression",
                value: operator.value,
                argument: operand,
                row: operator.row,
                column: operator.column
            });
        }
        else
        {
            const rightNode = outputStack.pop(); // take 2 values
            const leftNode = outputStack.pop();
            outputStack.push({
                type: operatorInfo.type === "logical" ? "LogicalExpression" : "BinaryExpression",
                operator: operator.value,
                left: leftNode,
                right: rightNode,
                row: operator.row,
                column: operator.column
            });
        }
    }

    return outputStack[0];
}

function parseFunctionCall(name, tokens, state)
{
    // remove (
    next(tokens, state);
    let args = [];

    const peekToken = peek(tokens, state);

    if (peekToken && peekToken.value === ")")
    {
        // remove )
        next(tokens, state);
        return {
            type: "FunctionCall",
            name,
            args
        }
    }

    // get all the arguments
    while (peek(tokens, state) && peek(tokens, state).value !== ")")
    {
        const expression = parseExpression(tokens, 0, state, true);

        if (!expression)
        {
            console.warn(`\n Expected expression in function call "${name}"`);
            break;
        }

        args.push(expression);

        const peekToken = peek(tokens, state);

        if (peekToken && peekToken.value === ",")
        {
            next(tokens, state);
        }
    }

    if (!peek(tokens, state) || peek(tokens, state).value !== ")")
    {
        const lastToken = tokens[state.position - 1];
        const row = lastToken?.row ?? 0;
        const column = lastToken?.column ?? 0;

        throw new parseErrors.FunctionCallError(`Missing ")" in function call for name "${name}"`, row, column);
    }

    next(tokens, state);

    if (peek(tokens, state) && peek(tokens, state).value === "(")
    {
        throw new parseErrors.ChainedFunctionCallError(name, peek(tokens, state).row, peek(tokens, state).column);
    }

    return {
        type: "FunctionCall",
        name,
        args
    };
}

function parseStatement(ast, tokens, state) {
    const token = peek(tokens, state);
    if (!token) return null;

    if (token.type === "Keyword")
    {
        if (variableHandler(ast, token, tokens, state)) return true;
        if (ifHandler(ast, token, tokens, state)) return true;
        if (whileHandler(ast, token, tokens, state)) return true;
        if (loopControlHandler(ast, token, tokens, state)) return true;
        if (forHandler(ast, token, tokens, state)) return true;
        if (functionHandler(ast, token, tokens, state)) return true;
        if (returnHandler(ast, token, tokens, state)) return true;
    }

    const expression = parseExpression(tokens, 0, state);
    if (expression) ast.body.push(expression);
    return expression;
}

function variableHandler(ast, token, tokens, state)
{
    if (token && token.type !== "Keyword" || token.value !== "new") return false;

    const {row, column} = next(tokens, state);

    const nextToken = peek(tokens, state);
    if (nextToken && nextToken.type !== "Identifier") throw new Error(`Expected a variable after keyword "new" at row ${row} char ${column}`);

    const {value: identifierValue} = next(tokens, state);

    let value = null;
    if (peek(tokens, state)?.value === "=")
    {
        next(tokens, state); // remove =
        value = parseExpression(tokens, 0, state);
    }

    const node = 
    {
        type: value
            ? "NewAssignment"
            : "NewDeclaration",
        name: identifierValue,
        value,
        row,
        column
    };

    ast.body.push(node);
    return true;
}

function parseBlock(tokens, state)
{
    const openingBracket = peek(tokens, state);
    if (!openingBracket || openingBracket.value !== "{") throw new parseErrors.MissingTokenError("{", openingBracket?.row ?? 0, openingBracket?.column ?? 0);

    next(tokens, state); // remove {

    let block = [];

    while (peek(tokens, state) && peek(tokens, state).value !== "}")
    {
        const temporaryAST = {type: "Program", body: []};
        parseStatement(temporaryAST, tokens, state);
        block.push(...temporaryAST.body);
    }

    const closingBracket = peek(tokens, state);
    if (!closingBracket || closingBracket.value !== "}") throw new parseErrors.MissingTokenError("}", closingBracket?.row ?? 0, closingBracket?.column ?? 0);

    next(tokens, state); // remove "}"

    return block;
}

function getCondition(keyword, token, tokens, state)
{
    if (!token || token.type !== "Keyword" || token.value !== keyword) return false;
    const {
        row,
        column
    } = next(tokens, state); // delete the keyword

    if (!peek(tokens, state) || peek(tokens, state).value !== "(") throw new parseErrors.MissingTokenError("(", row, column);
    next(tokens, state); // remove (

    const condition = parseExpression(tokens, 0, state);

    if (!condition) throw new Error(`Expected condition after keyword "${keyword}" at row ${token.row} char ${token.column}`);
    if (!peek(tokens, state) || peek(tokens, state).value !== ")") throw new parseErrors.MissingTokenError(")", condition.row, condition.column);
    next(tokens, state); // remove )

    return condition;
}

function loopControlHandler(ast, token, tokens, state)
{
    if (!token || token.type !== "Keyword" || (token.value !== "continue" && token.value !== "break")) return false;
    next(tokens, state); // delete the keyword
    
    const node =
    {
        type: token.value === "continue" ? "ContinueStatement": "BreakStatement",
        row: token.row,
        column: token.column
    }

    ast.body.push(node);
    return true;
}

function ifHandler(ast, token, tokens, state)
{
    const condition = getCondition("if", token, tokens, state);
    if (!condition) return false;

    const thenBlock = parseBlock(tokens, state);

    let elseBlock = null;
    const maybeElse = peek(tokens, state);
    if (maybeElse && maybeElse.type === "Keyword" && maybeElse.value === "else")
    {
        next(tokens, state); // eat the else

        const maybeIf = peek(tokens, state);

        if (maybeIf && maybeIf.type === "Keyword" && maybeIf.value === "if")
        {
            const elseIfAST = {type: "Program", body: []};
            ifHandler(elseIfAST, maybeIf, tokens, state);
            elseBlock = [elseIfAST.body[0]];
        }
        else elseBlock = parseBlock(tokens, state);
    }

    const node = 
    {
        type: "IfStatement",
        condition,
        body: thenBlock,
        else: elseBlock,
        row: token.row,
        column: token.column
    };

    ast.body.push(node);
    return true;
}

function checkForSemicolon(tokens, state, row, column)
{
    const peekToken = peek(tokens, state);
    if (!peekToken || peekToken.value !== ";") throw new parseErrors.MissingTokenError(";", row, column);
    next(tokens, state); // consume the semicolon
}

function forHandler(ast, token, tokens, state)
{
    if (!token || token.type !== "Keyword" || token.value !== "for") return false;
    const
    {
        row,
        column
    } = next(tokens, state); // delete for

    if (!peek(tokens, state) || peek(tokens, state).value !== "(") throw new parseErrors.MissingTokenError("(", row, column);
    next(tokens, state);

    const temporaryAST =
    {
        type: "Program",
        body: []
    };
    parseStatement(temporaryAST, tokens, state);

    if (temporaryAST.body.length !== 1) throw new Error(`Invalid for-loop initializer`);

    const initial = temporaryAST.body[0];

    checkForSemicolon(tokens, state, row, column);

    const condition = parseExpression(tokens, 0, state);
    checkForSemicolon(tokens, state, row, column);

    const update = parseExpression(tokens, 0, state);

    if (!peek(tokens, state) || peek(tokens, state).value !== ")") throw new parseErrors.MissingTokenError(")", row, column);
    next(tokens, state); // remove )

    const thenBlock = parseBlock(tokens, state);

    const node = 
    {
        type: "ForStatement",
        initial,
        condition,
        update,
        body: thenBlock,
        row: token.row,
        column: token.column
    };

    ast.body.push(node);
    return true;
}

function whileHandler(ast, token, tokens, state)
{
    const condition = getCondition("while", token, tokens, state);
    if (!condition) return false;
    
    const thenBlock = parseBlock(tokens, state);

    const node = 
    {
        type: "WhileStatement",
        condition,
        body: thenBlock,
        row: token.row,
        column: token.column
    };

    ast.body.push(node);
    return true;
}

function functionHandler(ast, token, tokens, state)
{
    if (!token || token.type !== "Keyword" || token.value !== "function") return false;
    const
    {
        row,
        column
    } = next(tokens, state);

    const functionName = peek(tokens, state);
    if (!functionName || functionName.type !== "Identifier") throw new SyntaxError(`Expected identifier after keyword "function" at row ${row}, char ${column}`);
    
    const 
    {
        value: name
    } = next(tokens, state);

    const openingParentheses = peek(tokens, state);
    if (!openingParentheses || openingParentheses.value !== "(") throw new SyntaxError(`Expected "(" after function name "${name}" at row ${row}, char ${column}`);

    next(tokens, state); // eat the (

    let parameters = [];

    while (peek(tokens, state) && peek(tokens, state).value !== ")")
    {
        const parameter = peek(tokens, state);
        
        if (!parameter) throw new SyntaxError(`Expected parameter in function name "${name}" but got "${parameter}"`);
        if (parameters.includes(parameter.value)) throw new SyntaxError(`Duplicate parameter "${parameter.value}" at function name "${name}" at row ${parameter.row}, char ${parameter.column}`)
        if (parameter.value === ")") throw new SyntaxError(`Trailing comma in parameters of function name "${name}"`);
        if (parameter.type !== "Identifier") throw new SyntaxError(`Expected parameter in function name "${name}" with type "Identifier" but got "${parameter.value}" at row ${parameter.row}, char ${parameter.column}`);

        parameters.push(next(tokens, state).value);

        const nextToken = peek(tokens, state);
        if (nextToken && nextToken.value === ",") next(tokens, state);
    }

    const closingParentheses = peek(tokens, state);
    if (!closingParentheses || closingParentheses.value !== ")") throw new SyntaxError(`Expected ")" after parameters in function declaration "${name}"`);

    next(tokens, state); // eat the )

    const body = parseBlock(tokens, state);

    const node =
    {
        type: "FunctionDeclaration",
        name,
        parameters,
        body,
        row,
        column
    }

    ast.body.push(node);
    return true;
}

function returnHandler(ast, token, tokens, state)
{
    if (!token || token.type !== "Keyword" || token.value !== "return") return false;
    
    next(tokens, state); // nom nom return

    const peekToken = peek(tokens, state);

    // get argument
    let argument = null;
    if (peekToken && peekToken.value !== ";") argument = parseExpression(tokens, 0, state);

    checkForSemicolon(tokens, state, token.row, token.column);

    const node =
    {
        type: "ReturnStatement",
        argument,
        row: token.row,
        column: token.column
    }

    ast.body.push(node);
    return true;
}

export function parser(tokens)
{
    let state = 
    {
        position: 0
    };

    let ast =
    {
        type: "Program",
        body: 
        [
            
        ]
    };

    while (state.position < tokens.length)
    {
        const token = peek(tokens, state);
        if (!token) break;

        parseStatement(ast, tokens, state);
    }

    //console.dir(ast, {depth: null, colors: true});
    return ast;
}