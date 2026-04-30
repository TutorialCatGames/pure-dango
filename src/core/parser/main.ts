// the parser for pure-dango
// handles syntax rules
// turns the tokens from tokenizer in to objects the compiler can read

import {parseErrors}   from "../../runtime/errors";
import {errorTemplate} from "../../runtime/stdlib";
import * as handlers   from "./handlers";
import * as helpers    from "./helpers";

// the operators of pure-dango
export const OPERATORS : Operators =
{
    // operators
    "+": {prec: 10, assoc: "left", type: "binary"},
    "-": {prec: 10, assoc: "left", type: "binary"}, 
    "*": {prec: 20, assoc: "left", type: "binary"},
    "/": {prec: 20, assoc: "left", type: "binary"},
    "%": {prec: 20, assoc: "left", type: "binary"},

    // assignment operators
    "=":  {prec: 5, assoc: "right", type: "assignment"},
    "-=": {prec: 5, assoc: "right", type: "assignment"},
    "+=": {prec: 5, assoc: "right", type: "assignment"},
    "*=": {prec: 5, assoc: "right", type: "assignment"},
    "/=": {prec: 5, assoc: "right", type: "assignment"},

    // equality operators
    "==": {prec: 7, assoc: "left", type: "binary"},
    "!=": {prec: 7, assoc: "left", type: "binary"},
    ">":  {prec: 8, assoc: "left", type: "binary"},
    "<":  {prec: 8, assoc: "left", type: "binary"},
    ">=": {prec: 8, assoc: "left", type: "binary"},
    "<=": {prec: 8, assoc: "left", type: "binary"},

    // logical operators
    "&&": {prec: 3, assoc: "left", type: "logical"},
    "||": {prec: 2, assoc: "left", type: "logical"},

    // unary operators
    "!":  {prec: 30, assoc: "right", type: "unary", fix: "prefix"},
    "~":  {prec: 30, assoc: "right", type: "unary", fix: "prefix"},
    "+u": {prec: 30, assoc: "right", type: "unary", fix: "prefix"},
    "-u": {prec: 30, assoc: "right", type: "unary", fix: "prefix"},
    "++": {prec: 30, assoc: "right", type: "unary", fix: "both"},
    "--": {prec: 30, assoc: "right", type: "unary", fix: "both"} 
}

export function peek(tokens : Tokens, state : State) : BaseToken
{
    return tokens[state.position];
}

export function next(tokens : Tokens, state : State) : BaseToken | null
{
    if (state.position >= tokens.length)
        return null;
    const token : BaseToken = tokens[state.position++];
    state.lastToken = token;
    return token;
}

function isUnaryPrefix(operator : string) : boolean
{
    return OPERATORS[operator]?.type === "unary" && 
        OPERATORS[operator].fix !== "postfix";
}

function parseStartingToken(token : BaseToken, tokens : Tokens, state : State) : ParserToken | null
{
    if (!token)
        errorTemplate("parseStartingToken", `Unexpected end of input`);

    let 
    {
        type,
        value, 
        row,
        column
    } = token;

    if (type === "Keyword" && value === "function")
        return handlers.parseFunctionNode(tokens, state, true); 

    if (type === "Keyword" && value === "inst")
        return handlers.parseInstantationExpression(token, tokens, state);

    if (type === "Operator" && (value === "+" || value === "-"))
    {
        const previousToken : BaseToken | null = state.lastToken;

        const isUnaryContext : boolean =
            !previousToken ||
            previousToken.type === "Keyword" ||
            previousToken.value === "(" ||
            previousToken.value === "," ||
            (
                previousToken.type === "Operator" &&
                previousToken.value !== ")" &&
                previousToken.value !== "++" &&
                previousToken.value !== "--"
            );

        if (isUnaryContext) 
            value += "u"
    }

    if (type === "Literal" || type === "StringLiteral")
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
        const operand     = parseExpression(tokens, valueObject.prec, state)!;

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

        throw new parseErrors.UnaryOperatorError(value, row, column);
    }

    if (type === "Identifier")
    {
        const peekToken = peek(tokens, state);

        // if the first item of tokens is "(" then treat it as a function
        if (peekToken && peekToken.value === "(")
            return parseFunctionCall(value, tokens, state);

        return {
            type: "VariableReference",
            value,
            row,
            column
        }
    }

    if (value === "(")
    {
        const expression = parseExpression(tokens, 0, state)!;
        
        const peekToken = peek(tokens, state);
        if (!peekToken || peekToken.value !== ")")
            throw new parseErrors.MissingTokenError(")", expression.row, expression.column);

        next(tokens, state);   // eat )

        return expression;
    }

    // handle ArrayAccesses
    if (value === "[")
    {
        const elements : ParserToken[] = [];
        
        while (peek(tokens, state) && peek(tokens, state).value !== "]")
        {
            const element = parseExpression(tokens, 0, state, true);
            if (element)
                elements.push(element);

            const peekToken = peek(tokens, state);
            if (peekToken && peekToken.value === ",")
                next(tokens, state);
            else if (peekToken && peekToken.value !== "]")
                throw new parseErrors.UnexpectedTokenError(peekToken.value, peekToken.row, peekToken.column);
        }

        if (!peek(tokens, state) || peek(tokens, state).value !== "]")
            throw new parseErrors.MissingTokenError("]", token.row, token.column);

        next(tokens, state);   // eat ]

        return {
            type: "ArrayLiteral",
            elements,
            row,
            column
        };
    }

    // handle Objects
    if (value === "{")
    {
        const properties : {key : string, value : ParserToken | null}[] = [];
        
        while (peek(tokens, state) && peek(tokens, state).value !== "}")
        {
            const keyToken = next(tokens, state)!;
            const isInvalid : boolean = !keyToken || !(keyToken.type === "Identifier" || keyToken.type === "StringLiteral" || keyToken.type === "Literal");

            if (isInvalid)
                throw new parseErrors.UnexpectedTokenError(keyToken?.value, keyToken?.row ?? row, keyToken?.column ?? column);
            
            if (!peek(tokens, state) || peek(tokens, state).value !== ":")
                throw new parseErrors.MissingTokenError(":", keyToken.row, keyToken.column);
            next(tokens, state);   // eat :

            const value = parseExpression(tokens, 0, state, true);

            properties.unshift({key: keyToken.value, value});

            const peekToken = peek(tokens, state);
            if (peekToken && peekToken.value === ",")
                next(tokens, state);
            else if (peekToken && peekToken.value !== "}")
                throw new parseErrors.UnexpectedTokenError(peekToken.value, peekToken.row, peekToken.column);
        }

        if (!peek(tokens, state) || peek(tokens, state).value !== "}")
            throw new parseErrors.MissingTokenError("}", token.row, token.column);

        next(tokens, state);   // eat }

        const node = 
        {
            type: "ObjectLiteral",
            properties,
            row,
            column
        };

        return node;
    }

    if (value === ";")
        return null;

    throw new parseErrors.UnexpectedTokenError(value, row, column);
}

// parse the expression using shunting-yard
export function parseExpression(tokens : Tokens, minimumPrecedence = 0, state : State, stopAtComma = false) : ParserToken | null
{
    let operatorStack : Tokens        = [];
    let outputStack   : ParserToken[] = [];

    let token = next(tokens, state);
    if (!token)
        return null;

    let node = parseStartingToken(token, tokens, state)!;
    node = helpers.attach(node, tokens, state, stopAtComma);
    outputStack.push(node);
    while (true)
    {
        let token = peek(tokens, state);
        if (helpers.stoppingCheck(token, stopAtComma))
            break;

        const operatorInfo = OPERATORS[token.value];
        if (!operatorInfo || operatorInfo.prec < minimumPrecedence)
            break;

        const operator = next(tokens, state)!;

        while (outputStack.length > 0)
        {
            const topOperator : BaseToken       = operatorStack[operatorStack.length - 1]!;
            const topInfo     : Operator | null = OPERATORS[topOperator?.value] ?? null;
            if (!topInfo)
                break;

            if (
                topInfo.type !== "assignment" && (
                    (operatorInfo.assoc === "left" && operatorInfo.prec <= topInfo.prec) ||
                    (operatorInfo.assoc === "right" && operatorInfo.prec < topInfo.prec)
                )
            )
            {
                if (topInfo.type === "unary")
                {
                    const operand = outputStack.pop()!;
                    outputStack.push
                    (
                        {
                            type: "UnaryExpression",
                            value: topOperator.value,
                            argument: operand,
                            row: topOperator.row,
                            column: topOperator.column
                        }
                    );
                }
                else
                {
                    const rightNode : ParserToken = outputStack.pop()!;
                    const leftNode  : ParserToken = outputStack.pop()!;

                    outputStack.push
                    (
                        {
                            type: topInfo.type === "logical" ? "LogicalExpression" : "BinaryExpression",
                            operator: topOperator.value,
                            left: leftNode,
                            right: rightNode,
                            row: topOperator.row,
                            column: topOperator.column
                        }
                    );
                }

                operatorStack.pop();
            }
            
            else
                break;
        }

        if (operatorInfo.type === "assignment")
        {
            const leftNode = outputStack.pop()!;
            if (leftNode.type !== "VariableReference" && leftNode.type !== "ArrayAccess"  && leftNode.type !== "MemberExpression")
                throw new parseErrors.AssignmentError(operator.value, operator.row, operator.column);

            const rightNode = parseExpression(tokens, operatorInfo.prec, state, stopAtComma);

            const baseOperators : Record<string, string> =
            {
                "+=": "+",
                "-=": "-",
                "*=": "*",
                "/=": "/",
                "%=": "%"
            };

            const name = leftNode.type === "ArrayAccess" || leftNode.type === "MemberExpression" 
                ? leftNode 
                : leftNode.value
            const valueType = OPERATORS[baseOperators[operator.value]]?.type === "logical"
                                ? "LogicalExpression"
                                : "BinaryExpression";
            outputStack.push
            (
                {
                    type: "Assignment",
                    name,
                    value: operator.value === "="
                        ? rightNode
                        : {
                            type: valueType,
                            operator: baseOperators[operator.value],
                            left: leftNode,
                            right: rightNode
                        },
                    row: operator.row,
                    column: operator.column
                }
            );

            break;
        }

        operatorStack.push(operator);

        let nextToken = next(tokens, state);
        if (!nextToken)
            throw new parseErrors.UnexpectedTokenError("end of input", operator.row, operator.column);
            
        let node = parseStartingToken(nextToken, tokens, state);
        if (!node)
            throw new parseErrors.UnexpectedTokenError(nextToken.value, nextToken.row, nextToken.column);

        node = helpers.attach(node, tokens, state, stopAtComma);

        outputStack.push(node);
    }

    while (operatorStack.length)
    {
        const operator = operatorStack.pop()!;
        const operatorInfo = OPERATORS[operator.value];
        if (operatorInfo.type === "unary")
        {
            const operand = outputStack.pop(); // take one value
            outputStack.push
            (
                {
                    type: "UnaryExpression",
                    value: operator.value,
                    argument: operand,
                    row: operator.row,
                    column: operator.column
                }
            );
        }
        else
        {
            const rightNode : ParserToken = outputStack.pop()!;   // take 2 values
            const leftNode  : ParserToken = outputStack.pop()!;
            outputStack.push
            (
                {
                    type: operatorInfo.type === "logical" ? "LogicalExpression" : "BinaryExpression",
                    operator: operator.value,
                    left: leftNode,
                    right: rightNode,
                    row: operator.row,
                    column: operator.column
                }
            );
        }
    }

    const maybeTernary = peek(tokens, state);
    if (maybeTernary && maybeTernary.value === "?")
    {
        next(tokens, state);   // eat ?

        const thenBranch = parseExpression(tokens, 0, state, stopAtComma)!;

        const elseColon = peek(tokens, state);
        if (!elseColon || elseColon.value !== ":")
            throw new parseErrors.MissingTokenError(":", elseColon?.row ?? 0, elseColon?.column ?? 0);
        next(tokens, state);   // eat :
        
        const elseBranch = parseExpression(tokens, 0, state, stopAtComma)!;

        return {
            type: "TernaryExpression",
            condition: outputStack[0],
            then: thenBranch,
            else: elseBranch,
            row: maybeTernary.row,
            column: maybeTernary.column
        }
    }

    return outputStack[0];
}

function parseFunctionCall(name : string, tokens : Tokens, state : State) : ParserToken
{
    const row    = state.lastToken?.row    ?? 0;
    const column = state.lastToken?.column ?? 0;

    next(tokens, state);   // eat (
    
    let args : ParserToken[] = [];

    const peekToken = peek(tokens, state);

    if (peekToken && peekToken.value === ")")
    {
        next(tokens, state);   // eat )
        return {
            type: "FunctionCall",
            name,
            args,
            row,
            column
        }
    }

    // get all the arguments
    while (peek(tokens, state) && peek(tokens, state).value !== ")")
    {
        if (peek(tokens, state)?.value === "...")
        {
            next(tokens, state);
            const expression = parseExpression(tokens, 0, state, true);
            args.push
            (
                {
                    type: "SpreadElement",
                    argument: expression,
                    row,
                    column
                }
            )
        }
        else
        {
            const expression = parseExpression(tokens, 0, state, true);

            if (!expression)
            {
                console.warn(`\n Expected expression in function call "${name}"`);
                break;
            }

            args.push(expression);
        }

        const peekToken = peek(tokens, state);

        if (peekToken && peekToken.value === ",")
            next(tokens, state);
        else if (peekToken && peekToken.value !== ")")
            throw new parseErrors.UnexpectedTokenError(peekToken.value, peekToken.row, peekToken.column);
    }

    if (!peek(tokens, state) || peek(tokens, state).value !== ")")
    {
        const lastToken = tokens[state.position - 1];
        const row       = lastToken?.row    ?? 0;
        const column    = lastToken?.column ?? 0;

        throw new parseErrors.FunctionCallError(`Missing ")" in function call for name "${name}"`, row, column);
    }

    next(tokens, state);   // eat )

    if (peek(tokens, state) && peek(tokens, state).value === "(")
        throw new parseErrors.ChainedFunctionCallError(name, peek(tokens, state).row, peek(tokens, state).column);

    return {
        type: "FunctionCall",
        name,
        args,
        row,
        column
    };
}

export function parseStatement(ast : AST, tokens : Tokens, state : State) : true | ParserToken | null
{
    const token = peek(tokens, state);
    if (!token)
        return null;

    // run all the handlers for keywords
    if (token.type === "Keyword")
    {
        if (handlers.variableHandler(ast, token, tokens, state))
            return true;

        else if (handlers.ifHandler(ast, token, tokens, state))
            return true;

        else if (handlers.whileHandler(ast, token, tokens, state))
            return true;

        else if (handlers.loopControlHandler(ast, token, tokens, state))
            return true;

        else if (handlers.forHandler(ast, token, tokens, state))
            return true;

        else if (handlers.functionHandler(ast, token, tokens, state))
            return true;

        else if (handlers.returnHandler(ast, token, tokens, state))
            return true;

        else if (handlers.importHandler(ast, token, tokens, state))
            return true;

        else if (handlers.classHandler(ast, token, tokens, state))
            return true;
    }

    const expression = parseExpression(tokens, 0, state)!;
    if (expression)
        ast.body.push(expression);

    return expression;
}

export function parser(tokens : Tokens) : AST
{
    let state : State = 
    {
        position: 0,
        time: 0,
        lastToken: null
    };

    let ast : AST =
    {
        type: "Program",
        body: 
        [
            
        ]
    };

    while (state.position < tokens.length)
    {
        const token = peek(tokens, state);
        if (!token)
            break;

        parseStatement(ast, tokens, state);
    }

    return ast;
}