const REGEX = /\n|;|&&|\|\||{|}|!=|<=|>=|==|--|\+\+|\-=|\+=|\/=|\*=|`([^`\\]|\\.)*`|"([^"\\]|\\.)*"|'([^'\\]|\\.)*'|0b[01]+|0x[0-9a-fA-F]+|\d+(\.\d+)?|[a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*|\d+(\.\d+)?|[+\-*/=()&^%$#@!<>?:~]|[,\t]/g;

const tokenTypes = // satisfying
[
    [/^(new|if|else|while|continue|break|for|function|return)$/,                  "Keyword"         ],
    [/^(\n|,|\t|;)/,                                                              "Separator"       ],
    [/^".*"$|^'.*'$|^`.*`$/,                                                      "StringLiteral"   ],
    [/^(\d+(\.\d+)?|0b[01]+|0x[0-9a-fA-F]+)$/,                                    "Literal"         ],
    [/[a-zA-Z_]\w*(\.[a-zA-Z_]\w*)*/,                                             "Identifier"      ],
    [/&&|\|\||{|}|!=|<=|>=|==|\-=|\+=|\+\+|\/=|\*=|--|[+\-*/=%()&^%$#@!<>?:~]/,   "Operator"        ]
]

function getType(code)
{
    for (const [regex, tokenType] of tokenTypes)
    {
        if (regex.test(code)) return tokenType;
    }

    return "Unknown"
}

export function tokenizer(code)
{
    let tokens = [];

    // get all the tokens needed 
    let column = 1;
    let row = 1;
    const matches = code.matchAll(REGEX);

    let commented = false;

    for (const match of matches)
    {
        let value = match[0];

        if (value === "\n" || value === "\\n") {
            //console.log(`\\n at row ${row}, char ${column}`);
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

        if (value === "\t" || value === ",") {
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

        const lines = value.split("\n");

        if (lines.length > 1) {
            row += lines.length - 1;
            column = lines[lines.length - 1].length + 1;
        }

        const type = getType(value);
        tokens.push(
        {
            type,
            value,
            row,
            column
        });
        previousToken = {type, value};

        if (lines.length === 1) column += value.length;
    }

    return tokens;
}