const REGEX = /\[|\]|\n|;|&&|\|\||\{|\}|!=|<=|>=|==|--|\+\+|-=|\+=|\/=|\*=|`([^`\\]|\\.)*`|"([^"\\]|\\.)*"|'([^'\\]|\\.)*'|0b[01]+|0x[0-9a-fA-F]+|\d+(\.\d+)?|[\p{L}_][\p{L}\d_]*(?:\.[\p{L}_][\p{L}\d_]*)*|[+\-*/=()&^%$#@!<>?:~\[\]]|[,\t]/gu;

type BaseToken =
{
    type   : string
    value  : string
    row    : number
    column : number
}

type MatchIterable = IterableIterator<RegExpMatchArray>; 

const tokenTypes : [RegExp, string][] = // satisfying
[
    [/^(new|if|else|while|continue|break|for|function|return|import)$/,                   "Keyword"      ],
    [/^(\n|,|\t|;)$/,                                                                     "Separator"    ],
    [/^".*"$|^'.*'$|^`.*`$/,                                                              "StringLiteral"],
    [/^(\d+(\.\d+)?|0b[01]+|0x[0-9a-fA-F]+)$/,                                            "Literal"      ],
    [/^[\p{L}_][\p{L}\d_]*(\.[\p{L}_][\p{L}\d_]*)*/u,                                     "Identifier"   ],
    [/^(&&|\|\||{|}|\[|\]|!=|<=|>=|==|-=|\+=|\+\+|\/=|\*=|--|[+\-*/=%()&^!<>?:~\[\]])$/,   "Operator"     ]
]

function getType(code : string)
{
    for (const [regex, tokenType] of tokenTypes)
    {
        if (regex.test(code)) return tokenType;
    }

    return "Unknown";
}

export function tokenizer(code : string)
{
    let tokens : BaseToken[] = [];

    // get all the tokens needed 
    let column : number = 1;
    let row    : number = 1;

    const matches : MatchIterable = code.matchAll(REGEX);

    let commented : boolean = false;

    for (const match of matches)
    {
        let value : string = match[0];

        if (value === "\n")
        {
            row++;
            commented = false;
            column = 1;
            continue;
        }

        if (value === "#")
        {
            commented = true;
            continue
        }

        if (commented)
        {
            //console.log(`Token "${value}" was commented out and ignored at row ${row}, char ${column}`);
            column += value.length;
            continue;
        }

        if (value === "\t")
        {
            column += value.length;
            continue;
        }

        if (value === ",") {
            tokens.push(
            {
                type: "separator",
                value,
                row,
                column
            });
            column += value.length;
            continue;
        }

        const lines : string[] = value.split("\n");

        if (lines.length > 1)
        {
            row    +=   lines.length - 1;
            column =    lines[lines.length - 1].length + 1;
        }

        const type : string = getType(value);
        tokens.push(
        {
            type,
            value,
            row,
            column
        });

        if (lines.length === 1) column += value.length;
    }

    return tokens;
}