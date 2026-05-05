// the lexer for pure-dango. Returns a list of tokens.
import {Tokenizer} from "../../runtime/errors";
import * as quote_crimes from "./funnies";

const REGEX = new RegExp([
    // strings
    "(`(?:[^`\\\\]|\\\\.)*`)",           // backtick strings
    "('(?:[^'\\\\]|\\\\.)*')",           // single quote strings

    '(\u201C(?:[^\u201C\u201D\\\\]|\\\\.)*\u201D)', // curly single quote strings
    "(\u2018(?:[^\u2018\u2019\\\\]|\\\\.)*\u2019)", // curly double quote strings

    // multi-char operators
    "&&", "\\|\\|",
    "!=", "<=", ">=", "==",
    "--", "\\+\\+",
    "-=", "\\+=", "/=", "\\*=",
    "\\.\\.\.",                          // spread

    // number literals
    "0b[01]+",                           // binary
    "0x[0-9a-fA-F]+",                    // hex
    "\\d+(\\.\\d+)?",                    // float

    // identifiers
    "[\\p{L}_][\\p{L}\\d_]*",

    // single char
    "[+\\-*/=()&^%$#@!<>?:~,]",
    "[\\[\\]{}]",
    "[\\n;]",
    "\\.",
].join('|'), 'gu');

type BaseToken =
{
    type   : string
    value  : string
    row    : number
    column : number
}

type MatchIterable = IterableIterator<RegExpMatchArray>; 

/// the sets for types
const keywordSet = new Set(["new","if","else","while","continue","break","for","function","return","import","class","extends","inst","internal","try","catch","finally","do"]);
const separatorSet = new Set(["\n", ",", "\t", ";"]);
const operatorSet = new Set(["...", "&&","||","{","}","[","]","!=","<=",">=","==","-=","+=","++","/=","*=","--","+","-","*","/","%","=","(",")",  "&","^","!","<",">","?",":",  "~",".",  ]);

// gets the type of a token.
function getType(code : string) : string
{
    if (keywordSet.has(code))   
        return "Keyword";

    if (separatorSet.has(code)) 
        return "Separator";

    if (operatorSet.has(code))  
        return "Operator";

    if (/^["'`]/.test(code))    
        return "StringLiteral";
    
    if (/^\d/.test(code))       
        return "Literal";

    return "Identifier";
}

export function tokenizer(code : string) : BaseToken[]
{
    // priority: Comments (#) > strings "<any>" > normal character <any>
    const tokens : BaseToken[] = [];

    // uid generated with 11 random characters (e.g. 0.epnonhkzjjl)
    const uid : string = Math.random().toString(36).slice(2);
    const stringMeta = new Map<string, {value: string; row: number; column: number}>();
    const out : string[] = [];

    let row : number = 1;
    let column : number = 1;
    let i : number = 0;
    let stringIndex : number = 0;

    while (i < code.length)
    {
        const character = code[i];

        // single line comment
        if (character === "#")
        {
            while (i < code.length && code[i] !== "\n") 
                i++;

            // \n will be handled in the next iteration
            continue;
        }

        // multi line comments
        if (character === "/" && code[i + 1] === "*")
        {
            while (i < code.length && !(code[i] === "*" && code[i + 1] === "/")) 
            {
                if (code[i] === "\n")
                {
                    row++;
                    column = 1;
                }
                i++;
            } 

            i += 2; // eat */
            continue;
        }

        // handle strings
        if 
        (
            (
                character === '"' || character === "\u201C" || 
                character === "'" || character === "\u2018" ||
                character === "`"
            ) &&
            (i === 0 || !/[\p{L}\d]/u.test(code[i - 1]))
        )
        {
            const quote = character === "\u201C" ? "\u201D" // check for curly double quotes
                : character === "\u2018" ? "\u2019"         // check for curly single quotes
                : character;

            const stringRow    : number = row;
            const stringColumn : number = column;

            const start : number = i;

            i++;
            column++;
            
            while (i < code.length && code[i] !== quote)
            {
                const type    = quote === "\u201D" ? "double" : "single";
                const opening = type === "double" ? "\u201C" : "\u2018";
                    
                if ((code[i] === "\u201C" && quote === "\u201D") || (code[i] === "\u2018" && quote === "\u2019"))
                {   
                    const quoteCrimesMessage = quote_crimes.QuoteCrimesMessage(quote_crimes.incrementQuoteCrimes() - 1, opening) + " ";
                    throw new Tokenizer
                    (
                        quoteCrimesMessage +
                        `Found: ${opening}...${opening}. ` + 
                        `Tip: Either match them or just use normal ${type} quotes`,
                        row,
                        column
                    );
                }

                if (code[i] === "\\")
                {
                    i      += 2;
                    column += 2;
                }

                else
                {
                    if (code[i] === "\n")
                    {
                        row++;
                        column = 1;
                    }
                    else
                        column++;

                    i++
                }
            }
            
            // closing quote
            i++;
            column++;
            
            const raw         : string = code.slice(start, i);
            const placeholder : string = `__STRING${uid}_${stringIndex++}__`;
            stringMeta.set
            (
                placeholder,
                {
                    value:  raw.slice(1, -1)
                            .replace(/\\"/g,  '"')
                            .replace(/\\'/g,  "'")
                            .replace(/\\\\/g, '\\')
                            .replace(/\\n/g,  '\n')
                            .replace(/\\t/g,  '\t')
                            .replace(/\\r/g,  '\r'),
                    row:    stringRow,
                    column: stringColumn
                }
            );
            
            out.push(placeholder);
            continue;
        }

        // when encountering a "\n" character we add one to row and set column to one
        // else, we add one to column
        if (character === "\n")
        {
            row++;
            column = 1;
        }
        else
            column++;

        out.push(character);
        i++;
    }

    // we join all characters from out in to a string
    const processed : string = out.join("");

    row    = 1;
    column = 1;

    let commented : boolean = false;

    // get the tokens we need
    const matches : MatchIterable = processed.matchAll(REGEX);
    for (const match of matches)
    {
        const value : string = match[0];

        // \n encounter
        if (value === "\n")
        {
            row++;
            column = 1;
            commented = false;
            continue;
        }

        // comment encounter
        if (value === "#")
        {
            commented = true;
            continue;
        }

        // if the value is part of a comment or value is the tab character
        // we don't add the token and only add its length to column
        if (commented || value === "\t")
        {
            column += value.length;
            continue;
        }

        // comma encounter
        if (value === ",")
        {
            tokens.push
            (
                {
                    type: "Separator",
                    value,
                    row,
                    column
                }
            );
            column += value.length;
            continue;
        }

        // if value is in stringMeta, we get value in stringMeta
        // then, we push a StringLiteral to tokens
        // finally, we add the length to value
        if (stringMeta.has(value))
        {
            const meta = stringMeta.get(value)!;
            tokens.push
            (
                {
                    type   : "StringLiteral",
                    value  : meta.value,
                    row    : meta.row, 
                    column : meta.column
                }
            );
            column += value.length;
            continue;
        }

        // split value into separate lines
        // if lines has a length more than one
        // we add the length of lines decreased by one to row
        // then, we change column to be equal to the the last line's length + 1
        const lines = value.split("\n");
        if (lines.length > 1)
        {
            row    += lines.length - 1;
            column =  lines[lines.length - 1].length + 1;
        }

        // we push value as an object to tokens
        tokens.push
        (
            {
                type : getType(value),
                value,
                row,
                column
            }
        );

        // finally, if the length of lines is equal to one
        // we add the length of value to column
        if (lines.length === 1)
            column += value.length;
    }
    //console.dir(tokens, {depth: null, colors: false})

    return tokens;
}