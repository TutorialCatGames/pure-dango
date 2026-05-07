import path from "path";
import {parseErrors} from "../../runtime/errors";
import {peek, next, parseExpression, parseStatement} from "./main";
import {errorTemplate} from "../../runtime/stdlib";

export function parseInstantationExpression(token : BaseToken, tokens : Tokens, state : State) : ParserToken
{
    const row    = token?.row    ?? state.lastToken?.row    ?? 0;
    const column = token?.column ?? state.lastToken?.column ?? 0;

    const classToken = peek(tokens, state);
    if (!classToken || classToken.type !== "Identifier")
        throw new Error(`Expected class name after "inst" at line ${row}:${column}`);

    const className : string = next(tokens, state)!.value;

    if (!peek(tokens, state) || peek(tokens, state).value !== "(")
        throw new parseErrors.MissingTokenError("(", row, column);
    next(tokens, state); // eat (

    // collect arguments
    const args : ParserToken[] = [];
    while (peek(tokens, state) && peek(tokens, state).value !== ")")
    {
        const argument = parseExpression(tokens, 0, state, true);
        if (argument) 
            args.push(argument);

        if (peek(tokens, state)?.value === ",")
            next(tokens, state);
    }

    if (!peek(tokens, state) || peek(tokens, state).value !== ")")
        throw new parseErrors.MissingTokenError(")", row, column);
    next(tokens, state); // eat )

    const node : ParserToken = 
    {
        type: "ClassInstantiation",
        className,
        args,
        row,
        column
    };

    return node;
}

export function variableHandler(ast : AST, token : BaseToken, tokens : Tokens, state : State) : boolean
{
    if (!token || token.type !== "Keyword" || token.value !== "new")
        return false;

    const {row, column} = next(tokens, state)!;

    // collect variable names
    const names : string[] = [];
    do
    {
        const nextToken = peek(tokens, state);
        if (nextToken && nextToken.type !== "Identifier")
            errorTemplate("variableHandler", `expected a variable after keyword "new" at line ${row}:${column}`);

        const {value : identifierValue} = next(tokens, state)!;
        names.push(identifierValue);

        if (peek(tokens, state)?.value === ",")
            next(tokens, state);
        else
            break;
    } while (true);

    // collect variable values
    const values : ParserToken[] = [];
    if (peek(tokens, state)?.value === "=")
    {
        next(tokens, state);   // eat =

        do
        {
            values.push(parseExpression(tokens, 0, state)!);
            if (peek(tokens, state)?.value === ",")
                next(tokens, state);
            else
                break;
        } while (true);
    }

    // merge names and values
    for (let i = 0; i < names.length; i++)
    {
        const value = i < values.length 
            ? values[i] 
            : null;

        const type = value
            ? "NewAssignment"
            : "NewDeclaration"

        ast.body.push({type, name: names[i], value, row, column});
    }

    return true;
}

export function parseBlock(tokens : Tokens, state : State) : ParserToken[]
{
    const openingBracket = peek(tokens, state);
    if (!openingBracket || openingBracket.value !== "{")
        throw new parseErrors.MissingTokenError("{", openingBracket?.row ?? 0, openingBracket?.column ?? 0);
    next(tokens, state); // remove {

    let block : ParserToken[] = [];

    // parse body
    while (peek(tokens, state) && peek(tokens, state).value !== "}")
    {
        const temporaryAST : AST = {type: "Program", body : []};
        parseStatement(temporaryAST, tokens, state);
        block.push(...temporaryAST.body);
    }

    const closingBracket = peek(tokens, state);
    if (!closingBracket || closingBracket.value !== "}")
        throw new parseErrors.MissingTokenError("}", closingBracket?.row ?? 0, closingBracket?.column ?? 0);
    next(tokens, state); // remove "}"

    return block;
}

export function parseNextToken(tokens : Tokens, state : State) : ParserToken[]
{
    const temporaryAst : AST =
    {
        type: "Program",
        body: []
    }

    parseStatement(temporaryAst, tokens, state);
    return temporaryAst.body;
}

export function getCondition(keyword : string, token : BaseToken, tokens : Tokens, state : State) : ParserToken | false
{
    if (!token || token.type !== "Keyword" || token.value !== keyword)
        return false;

    const {row, column}  = next(tokens, state)!; // delete the keyword

    if (!peek(tokens, state) || peek(tokens, state).value !== "(")
        throw new parseErrors.MissingTokenError("(", row, column);
    next(tokens, state); // remove (

    const condition = parseExpression(tokens, 0, state)!;
    if (!condition)
        throw new Error(`Expected condition after keyword "${keyword}" at line ${token.row}:${token.column}`);
    
    if (!peek(tokens, state) || peek(tokens, state).value !== ")")
        throw new parseErrors.MissingTokenError(")", condition.row, condition.column);
    next(tokens, state); // remove )

    return condition;
}

export function loopControlHandler(ast : AST, token : BaseToken, tokens : Tokens, state : State) : boolean
{
    if (!token ||
        token.type !== "Keyword" ||
        (
            token.value !== "continue" &&
            token.value !== "break"
        )
    )
        return false;
    next(tokens, state); // delete the keyword
    
    const node : ParserToken =
    {
        type   : token.value === "continue" ? "ContinueStatement": "BreakStatement",
        row    : token.row,
        column : token.column
    }

    ast.body.push(node);
    return true;
}

export function ifHandler(ast : AST, token : BaseToken, tokens : Tokens, state : State) : boolean
{
    const condition : ParserToken | false = getCondition("if", token, tokens, state);
    if (!condition)
        return false;

    let thenBlock : ParserToken[];
    const nextToken = peek(tokens, state);
    if (nextToken && nextToken.value === "{")
        thenBlock = parseBlock(tokens, state);
    else
        thenBlock = parseNextToken(tokens, state);
    
    while (peek(tokens, state)?.type === "Separator") 
        next(tokens, state);

    // if followed by "else if", parse using a temporary AST
    let elseBlock : ParserToken[] | null = null;
    const maybeElse = peek(tokens, state);
    if (maybeElse && maybeElse.type === "Keyword" && maybeElse.value === "else")
    {
        next(tokens, state); // eat the else
        const elseToken = peek(tokens, state);

        if (elseToken && elseToken.type === "Keyword" && elseToken.value === "if")
        {
            const elseIfAST : AST = 
            {
                type: "Program", 
                body: []
            };
            ifHandler(elseIfAST, elseToken, tokens, state);
            elseBlock = [elseIfAST.body[0]]!;
        }
        else
        {
            const maybeOpeningBracket = peek(tokens, state);

            if (maybeOpeningBracket && maybeOpeningBracket.value === "{")
                elseBlock = parseBlock(tokens, state)!;
            else
                elseBlock = parseNextToken(tokens, state)!;
        }
    }

    const node : ParserToken = 
    {
        type      : "IfStatement",
        condition,
        body      : thenBlock,
        else      : elseBlock,
        row       : token.row,
        column    : token.column
    }!;

    ast.body.push(node);
    return true;
}

export function checkForSemicolon(tokens : Tokens, state : State, row : number, column : number) : void
{
    const peekToken = peek(tokens, state);
    if (!peekToken || peekToken.value !== ";")
        throw new parseErrors.MissingTokenError(";", row, column);
    next(tokens, state); // consume the semicolon
}

export function forHandler(ast : AST, token : BaseToken, tokens : Tokens, state : State) : boolean
{
    if (!token || token.type !== "Keyword" || token.value !== "for")
        return false;

    const{row, column}  = next(tokens, state)!; // delete for

    if (!peek(tokens, state) || peek(tokens, state).value !== "(")
        throw new parseErrors.MissingTokenError("(", row, column);
    next(tokens, state);

    // parse initializer as a temporary AST
    const temporaryAST : AST =
    {
        type: "Program",
        body: []
    };

    if (peek(tokens, state)?.value !== ";")
        parseStatement(temporaryAST, tokens, state);

    const initial : ParserToken = temporaryAST.body[0] ?? null;
    checkForSemicolon(tokens, state, row, column);

    const condition = parseExpression(tokens, 0, state)!;
    checkForSemicolon(tokens, state, row, column);

    let update = undefined;
    if (peek(tokens, state)?.value !== ")")
        update = parseExpression(tokens, 0, state)!;

    if (!peek(tokens, state) || peek(tokens, state).value !== ")")
        throw new parseErrors.MissingTokenError(")", row, column);
    next(tokens, state); // remove )

    let thenBlock : ParserToken[];
    const openingBracket = peek(tokens, state);
    if (openingBracket && openingBracket.value === "{")
        thenBlock = parseBlock(tokens, state);
    else
        thenBlock = parseNextToken(tokens, state);

    const node : ParserToken = 
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

export function doWhileHandler(ast : AST, token : BaseToken, tokens : Tokens, state : State) : boolean
{
    if (!token || token.type !== "Keyword" || token.value !== "do")
        return false;
 
    const {row, column} = next(tokens, state)!; // eat do
 
    // parse the body block
    const openingBracket = peek(tokens, state);
    if (!openingBracket || openingBracket.value !== "{")
        throw new parseErrors.MissingTokenError("{", row, column);
 
    const body : ParserToken[] = parseBlock(tokens, state);
 
    // skip separators between } and while
    while (peek(tokens, state)?.type === "Separator")
        next(tokens, state);
 
    // expect while keyword
    const whileToken = peek(tokens, state);
    if (!whileToken || whileToken.type !== "Keyword" || whileToken.value !== "while")
        throw new parseErrors.MissingTokenError("while", row, column);
    next(tokens, state); // eat while
 
    // expect (condition)
    if (!peek(tokens, state) || peek(tokens, state).value !== "(")
        throw new parseErrors.MissingTokenError("(", row, column);
    next(tokens, state); // eat (
 
    const condition = parseExpression(tokens, 0, state)!;
    if (!condition)
        throw new Error(`Expected condition after "do...while" at line ${row}:${column}`);
 
    if (!peek(tokens, state) || peek(tokens, state).value !== ")")
        throw new parseErrors.MissingTokenError(")", condition.row, condition.column);
    next(tokens, state); // eat )
 
    const node : ParserToken =
    {
        type : "DoWhileStatement",
        body,
        condition,
        row,
        column
    };
 
    ast.body.push(node);
    return true;
}


export function whileHandler(ast : AST, token : BaseToken, tokens : Tokens, state : State) : boolean
{
    const condition : ParserToken | false = getCondition("while", token, tokens, state);
    if (!condition)
        return false;
    
    let thenBlock : ParserToken[]; 
    const openingBracket = peek(tokens, state);
    if (openingBracket && openingBracket.value === "{")
        thenBlock = parseBlock(tokens, state);
    else
        thenBlock = parseNextToken(tokens, state);

    const node : ParserToken = 
    {
        type   : "WhileStatement",
        body   : thenBlock,
        row    : token.row,
        column : token.column,
        condition
    };

    ast.body.push(node);
    return true;
}

export function parseFunctionNode(tokens : Tokens, state : State, alreadyConsumed : boolean = false) : ParserToken
{
    let row : number, column : number;
    if (alreadyConsumed)
    {
        const previousToken = tokens[state.position - 1];
        row = previousToken.row;
        column = previousToken.column;
    }
    else 
        ({row, column} = next(tokens, state)!);

    let name : string | null = null;
    const nextToken = peek(tokens, state);
    if (nextToken && nextToken.type === "Identifier")
        name = next(tokens, state)!.value;

    const openingParentheses = peek(tokens, state);
    if (!openingParentheses || openingParentheses.value !== "(")
        errorTemplate("parseFunctionNode", `expected "(" after function name "${name}", got "${openingParentheses}" at line ${row}:${column}`);
    next(tokens, state); // eat the (

    // get the parameter names
    const parameters : {name: string, default: ParserToken | null, rest: boolean}[] = [];
    while (peek(tokens, state) && peek(tokens, state).value !== ")")
    {
        const parameter = peek(tokens, state);
        
        // handle SpreadElement (...name)
        if (parameter?.value === "...")
        {
            next(tokens, state);   // eat ...
            const restParam = peek(tokens, state);
            if (!restParam || restParam.type !== "Identifier")
                errorTemplate("parseFunctionNode", `expected parameter name after "...", got "${restParam}" at line ${parameter.row}:${parameter.column}`);

            parameters.push({name: next(tokens, state)!.value, default: null, rest: true});
            break; // rest param must be last
        }

        if (!parameter)
            errorTemplate("parseFunctionNode", `expected parameter in function name "${name}", got "${parameter}"`);
        if (parameters.some(param => param.name === parameter.value))
            errorTemplate("parseFunctionNode", `duplicate parameter "${parameter.value}" at function name "${name}" at line ${parameter.row}:${parameter.column}`)
        if (parameter.value === ")")
            errorTemplate("parseFunctionNode", `trailing comma in parameters of function name "${name}"`);
        if (parameter.type !== "Identifier")
            errorTemplate("parseFunctionNode", `expected parameter in function name "${name}" with type "Identifier", got "${parameter.value}" at line ${parameter.row}:${parameter.column}`);

        const paramName = next(tokens, state)!.value;

        if (peek(tokens, state)?.value === "=")
        {
            next(tokens, state);   // eat =
            const defaultValue = parseExpression(tokens, 0, state, true);
            parameters.push({name: paramName, default: defaultValue, rest: false});
        }
        else
            parameters.push({name: paramName, default: null, rest: false});

        const nextToken = peek(tokens, state);
        if (nextToken && nextToken.value === ",") 
            next(tokens, state);
    }

    const closingParentheses = peek(tokens, state);
    if (!closingParentheses || closingParentheses.value !== ")")
        errorTemplate("parseFunctionNode", `expected ")" after parameters in function declaration "${name}", got "${closingParentheses}"`);
    next(tokens, state); // eat the )

    let body : ParserToken[];
    const openingBracket = peek(tokens, state);
    if (openingBracket && openingBracket.value === "{")
        body = parseBlock(tokens, state);
    else
    {
        body = parseNextToken(tokens, state);
        if (peek(tokens, state)?.value === ";")
            next(tokens, state);
    }

    const node : ParserToken =
    {
        type: name ? "FunctionDeclaration" : "FunctionExpression",
        name,
        parameters,
        body,
        row,
        column
    }

    return node;
}

export function functionHandler(ast : AST, token : BaseToken, tokens : Tokens, state : State) : boolean
{
    if (!token || token.type !== "Keyword" || token.value !== "function")
        return false;

    const node = parseFunctionNode(tokens, state);
    
    ast.body.push(node);
    return true;
}

export function returnHandler(ast : AST, token : BaseToken, tokens : Tokens, state : State) : boolean
{
    if (!token || token.type !== "Keyword" || token.value !== "return")
        return false;
    
    next(tokens, state); // nom nom return

    const peekToken = peek(tokens, state);

    let argument : ParserToken | null = null;
    if (peekToken && peekToken.value !== ";")
        argument = parseExpression(tokens, 0, state)!;

    checkForSemicolon(tokens, state, token.row, token.column);

    const node : ParserToken =
    {
        type: "ReturnStatement",
        argument,
        row: token.row,
        column: token.column
    }

    ast.body.push(node);
    return true;
}

export function importHandler(ast : AST, token : BaseToken, tokens : Tokens, state : State) : boolean
{
    if (!token || token.type !== "Keyword" || token.value !== "import")
        return false;

    const
    {
        row,
        column
    }  = next(tokens, state)!;

    let importPath : string = "";

    // "internal" redirects the import path to src/runtime/libs
    const maybeInternal = peek(tokens, state);
    if (maybeInternal && maybeInternal.type === "Keyword" && maybeInternal.value === "internal")
    {
        next(tokens, state);   // eat internal
        const root : string = process.pkg
            ? path.resolve(path.dirname(process.execPath), "..")
            : path.resolve(path.dirname(process.argv[1]), "..");   // pure-dango

        const src     : string = path.resolve(root, "src");      // pure-dango/src
        const runtime : string = path.resolve(src, "runtime");   // pure-dango/src/runtime

        importPath = path.resolve(runtime, "libs"); // pure-dango/src/runtime/libs 
    }

    const pathToken = peek(tokens, state);
    if (!pathToken || pathToken.type !== "StringLiteral")
        errorTemplate("importHandler", `expected a file path with type String after keyword "import", got "${pathToken}" at line ${row}:${column}`);

    const fileName = next(tokens, state)!.value;

    const node : ParserToken = 
    {
        type : "ImportStatement",
        path : importPath ? path.join(importPath, fileName) : fileName,
        row,
        column
    };

    ast.body.push(node);
    return true;
}

export function classHandler(ast : AST, token : BaseToken, tokens : Tokens, state : State) : boolean
{
    if (!token || token.type !== "Keyword" || token.value !== "class")
        return false;

    const {row, column}  = next(tokens, state)!;

    const nameToken = peek(tokens, state);
    if (!nameToken || nameToken.type !== "Identifier")
        errorTemplate("classHandler", `expected class name at line ${row}:${column}`);
    const name = next(tokens, state)!.value;

    // if the next token's value is "extends", the value of the token after extends must be an identifier
    let superclass : string | null = null;
    const maybeExtends = peek(tokens, state);
    if (maybeExtends && maybeExtends.type === "Keyword" && maybeExtends.value === "extends")
    {
        next(tokens, state); // eat extends
        const superToken = peek(tokens, state);
        if (!superToken || superToken.type !== "Identifier")
            errorTemplate("classHandler", `expected superclass after keyword "extends", got "${superToken}"`);

        superclass = next(tokens, state)!.value;
    }

    if (!peek(tokens, state) || peek(tokens, state).value !== "{") 
        throw new parseErrors.MissingTokenError("{", row, column);
    next(tokens, state); // eat {

    // parse the method until it hits a closing curly brace
    const methods : ParserToken[] = [];   
    while (peek(tokens, state) && peek(tokens, state).value !== "}")
    {
        const methodToken = peek(tokens, state);
        if (!methodToken || methodToken.type !== "Identifier")
            throw new parseErrors.UnexpectedTokenError(methodToken?.value, methodToken?.row, methodToken?.column);
        
        const methodName : string = next(tokens, state)!.value;
        const methodNode : ParserToken = parseFunctionNode(tokens, state, true);
        methodNode.name = methodName;

        methods.push(methodNode);
    }

    if (!peek(tokens, state) || peek(tokens, state).value !== "}")
        throw new parseErrors.MissingTokenError("}", row, column);
    next(tokens, state); // eat }

    const node : ParserToken =
    {
        type: "ClassDeclaration",
        name,
        superclass,
        methods,
        row,
        column
    }

    ast.body.push(node);
    return true;
}

export function tryHandler(ast : AST, token : BaseToken, tokens : Tokens, state : State) : boolean
{
    if (!token || token.type !== "Keyword" || token.value !== "try")
        return false;

    const {row, column} = next(tokens, state)!;

    // parse try {...}
    const openingBracket = peek(tokens, state);
    if (!openingBracket || openingBracket.value !== "{")
        throw new parseErrors.MissingTokenError("{", row, column);

    const tryBlock = parseBlock(tokens, state);
    
    // skip separators
    while (peek(tokens, state)?.type === "Separator")
        next(tokens, state);

    // parse catch
    const maybeCatch = peek(tokens, state);
    if (!maybeCatch || maybeCatch.type !== "Keyword" || maybeCatch.value !== "catch")
        throw new parseErrors.MissingTokenError("catch", row, column);

    next(tokens, state); // eat catch

    // parse catch error variable name
    let errorVariable : string | null = null;
    if (peek(tokens, state)?.value === "(")
    {
        next(tokens, state); // eat (
        
        const errorToken = peek(tokens, state);
        if (!errorToken || errorToken.type !== "Identifier")
            errorTemplate("tryHandler", `expected identifier for catch parameter at line ${row}:${column}`);

        errorVariable = next(tokens, state)!.value;

        if (!peek(tokens, state) || peek(tokens, state).value !== ")")
            throw new parseErrors.MissingTokenError(")", row, column);

        next(tokens, state); // eat )
    }

    // parse catch body
    const catchOpeningBracket = peek(tokens, state);
    if (!catchOpeningBracket || catchOpeningBracket.value !== "{")
        throw new parseErrors.MissingTokenError("{", row, column);

    const catchBlock = parseBlock(tokens, state);

    while (peek(tokens, state)?.type === "Separator")
        next(tokens, state);

    let finallyBlock : ParserToken[] | null = null;
    const maybeFinally = peek(tokens, state);
    if (maybeFinally && maybeFinally.type === "Keyword" && maybeFinally.value === "finally")
    {
        next(tokens, state); // eat finally

        const finallyOpeningBracket = peek(tokens, state);
        if (!finallyOpeningBracket || finallyOpeningBracket.value !== "{")
            throw new parseErrors.MissingTokenError("{", row, column);

        finallyBlock = parseBlock(tokens, state);
    }

    const node : ParserToken =
    {
        type: "TryStatement",
        tryBlock,
        catchBlock,
        errorVariable : errorVariable ?? "error",
        finallyBlock,
        row,
        column
    }

    ast.body.push(node);
    return true;
}