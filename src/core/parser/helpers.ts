import {parseErrors} from "../../runtime/errors";
import {peek, next, parseExpression, OPERATORS} from "./main";

// returns true at closing parentheses, question marks, colons, and commas
export const stoppingCheck = (token : BaseToken, stopAtComma : boolean) : boolean =>
{
    if (!token) 
        return true;

    if (token.value === ")")
        return true;

    if (token.value === "?")
        return true;

    if (token.value === ":")
        return true;

    if (stopAtComma && token.value === ",")
        return true;

    return false;
};

const attachProperty = (node : ParserToken, token : BaseToken, tokens : Tokens, state : State) : ParserToken =>
{
    next(tokens, state);   // eat .
    const property : BaseToken | null = next(tokens, state);
    if (!property ||
        !(property.type === "Identifier" || property.type === "Literal" || property.type === "StringLiteral")
    )
        throw new parseErrors.UnexpectedTokenError(property?.value, property?.row!, property?.column!);

    if (peek(tokens, state)?.value === "(")
    {
        next(tokens, state);   // eat (
        const args = [];

        while (peek(tokens, state) && peek(tokens, state).value !== ")")
        {
            if (peek(tokens, state)?.value === "...")
            {
                next(tokens, state);
                const expression = parseExpression(tokens, 0, state, true);
                args.push
                (
                    {
                        type     : "SpreadElement", 
                        argument : expression, 
                        row      : token.row, 
                        column   : token.column 
                    }
                );
            }
            else
            {
                const argument = parseExpression(tokens, 0, state, true);
                if (argument)
                    args.push(argument);
            }

            if (peek(tokens, state)?.value === ",")
                next(tokens, state);
        }

        if (!peek(tokens, state) || peek(tokens, state).value !== ")")
            throw new parseErrors.MissingTokenError(")", token.row, token.column);
        next(tokens, state);   // eat )

        return {
            type     : "MethodCall",
            object   : node,
            property : property.value,
            args,
            row      : token.row,
            column   : token.column
        };
    }
    else 
    {
        return {
            type     : "MemberExpression",
            object   : node,
            property : property.value,
            row      : token.row,
            column   : token.column
        };
    }
}

const attachAccess = (node : ParserToken, token : BaseToken, tokens : Tokens, state : State) : ParserToken =>
{
    next(tokens, state);   // eat [
    const index = parseExpression(tokens, 0, state)!;

    if (!peek(tokens, state) || peek(tokens, state).value !== "]")
        throw new parseErrors.MissingTokenError("]", token.row, token.column);
    next(tokens, state);   // eat ]

    return {
        type   : "ArrayAccess",
        object : node,
        index,
        row    : token.row,
        column : token.column
    }
}

// attaches parents to node
export const attach = (node : ParserToken, tokens : Tokens, state : State, stopAtComma : boolean) : ParserToken =>
{
    let lastOperator : string | null = null;

    while (true)
    {
        const token = peek(tokens, state);
        if (stoppingCheck(token, stopAtComma))
            break;

        if (token.value === ".")
        {
            node = attachProperty(node, token, tokens, state);
            continue;
        }

        if (token.value === "[")
        {
            node = attachAccess(node, token, tokens, state);
            continue;
        }

        const info = OPERATORS[token.value];
        if (!info || info.type !== "unary" || !(info.fix === "postfix" || info.fix === "both"))
            break;

        if ((lastOperator === "++" || lastOperator === "--") && (token.value === "++" || token.value === "--"))
            throw new parseErrors.ChainedIncDecError(token.row, token.column);
        
        if (node.type !== "VariableReference" && node.type !== "ArrayAccess" && node.type !== "MemberExpression")
            throw new parseErrors.InvalidPostfixError(token.value, node.type, node.value, node.row, node.column);
        
        const operator = next(tokens, state)!;
        
        node = 
        {
            type     : "PostfixUnaryExpression",
            operator : operator.value,
            argument : node,
            row      : operator.row,
            column   : operator.column
        };

        lastOperator = operator.value;
    }

    return node;
}