type BaseToken =
{
    type   : string
    value  : string
    row    : number
    column : number
}

type ParserToken =
{
    type : string,
    
    argument? : ParserToken | null | undefined,
    name?     : any,
    value?    : any,
    object?   : any,
    property? : any,

    operator? : string,
    left?     : any,
    right?    : any,

    condition? : ParserToken,

    args? : 
    (
        ParserToken | 
        {
            type: string;
            argument: ParserToken;
            row: number;
            column: number;
        }
    )[],

    index? : ParserToken,

    initial? : ParserToken | null,
    update?  : ParserToken,

    parameters? : {name: string, default: ParserToken | null, rest: boolean}[],
    methods?    : ParserToken[], 

    body?  : ParserToken | ParserToken[],
    then?  : ParserToken,
    else?  : ParserToken | ParserToken[] | null,

    tryBlock?: ParserToken[],
    catchBlock?: ParserToken[],
    finallyBlock?: ParserToken[] | null,

    errorVariable?: string,

    elements? : ParserToken[],

    className?    : string,
    variableName? : string,

    path? : string,

    superclass? : string | null,

    row    : number,
    column : number
}

type AST = 
{
    type : "Program",
    body : ParserToken[]
}

type Operator =
{
    prec  : number, 
    assoc : string, 
    type  : string, 
    fix?  : string
}

type Operators =  Record<string, Operator>;

type Tokens = BaseToken[];

type State = 
{
    time      : number, 
    position  : number,
    lastToken : BaseToken | null
}