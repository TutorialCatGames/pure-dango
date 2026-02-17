# pure-dango v0.9.1 syntax

<style>
comment {color: grey;}
string {color: #88D57B;}
keyword {color: #7FBFFF;}
function {color: #E9C4E3;}
number {color: #BFE1B4;}
example {color: grey;}
</style>

## LANGUAGE CHARACTERISTICS
- dynamically typed
- variables default to `null`
- 0 = false, non-zero = true
- curly braces required for blocks
- statements don't need to end with `;`. But it is highly recommended for stylistic reasons


## KEYWORDS
### `new`
- Purpose:
    - creates a new variable in pure-dango
- Rules
    - cannot redeclare existing variables
    - variables are initialized as `null` until assigned

Syntax:
> **pure-dango**
<pre>
<keyword>new</keyword> <example>name</example> = <example>value</example>
</pre>

Example:
> **pure-dango**
<pre>
<keyword>new</keyword> x; <comment># declaration</comment>
x = <number>5</number>; <comment># assignment</comment>
</pre>

### `if`
- Purpose:
    - if the condition is true it runs the code inside of it
- Rules:
    - requires curly braces around code block
    - condition evaluates to truthy/falsy (0 = false, 1 = true)
    - requires parentheses around condition
  
Syntax:
> **pure-dango**
<pre>
<keyword>if</keyword> (<example>condition</example>)
{
    <example>...</example>
}
</pre>

Example:
> **pure-dango**
<pre>
<keyword>new</keyword> foo = <number>5</number>;
<keyword>if</keyword> (foo == <number>5</number>)
{
    <function>print</function>(<string>"hi"</string>);
}
</pre>

### `else`
- Purpose:
    - executes when preceding if condition is false
- Rules
    - must follow an `if` statement
    - can be extended with `else if` for multiple conditions
    - requires curly braces around code block
    - requires parentheses around condition

Syntax:
> **pure-dango**
<pre>
<comment># unconditional</comment>
<keyword>else</keyword>
{
    <example>...</example>
} 

<comment># conditional</comment>
<keyword>else if</keyword> (<example>condition</example>)
{
    <example>...</example>
}
</pre>

Example:
> **pure-dango**
<pre>
<keyword>new</keyword> foo = <number>5</number>;
<keyword>if</keyword> (foo < <number>5</number>)
{
    <function>print</function>(<string>"foo"</string>);
}

<keyword>else</keyword>
{
    <function>print</function>(<string>"bar"</string>);
}
</pre>

### `while`
- Purpose:
    - executes until its condition is false
- Rules
    - requires curly braces around code block
    - condition evaluates to truthy/falsy (0 = false, 1 = true)
    - requires parentheses around condition

Syntax:
> **pure-dango**
<pre>
<keyword>while</keyword> (<example>condition</example>)
{
    <example>...</example>
}
</pre>

Example:
> **pure-dango**
<pre>
<keyword>new</keyword> baz = <number>6</number>;
<keyword>while</keyword> (baz == <number>6</number>)
{
    <function>input</function>(<string>"baz"</string>); <comment># will run forever</comment>
}
</pre>

### `for`
- Purpose:
    - executes until its condition is false
- Rules
    - requires curly braces around code block
    - condition evaluates to truthy/falsy (0 = false, 1 = true)
    - requires parentheses around condition

Syntax:
> **pure-dango**
<pre>
<keyword>for</keyword> (<example>initial</example>; <example>condition</example>; <example>update</example>)
{
    <example>...</example>
}
</pre>

Example:
> **pure-dango**
<pre>
<keyword>new</keyword> pmochi = <number>6</number>;
<keyword>new</keyword> pdango = pmochi * <number>3</number>;
<keyword>for</keyword> (<keyword>new</keyword> i = 0; i < pdango; i++) <comment># since pdango is 18 (6*3 = 18) this loop will run 18 times</comment>
{
    <function>print</function>(i*pdango);
}
</pre>

### `break`
- Purpose:
    - immediately stops the `current loop` and exits it
- Rules
    - can only be used inside of loops (`for`, `while`)

Syntax:
> **pure-dango**
<pre>
<keyword>break</keyword>;
</pre>

Example:
> **pure-dango**
<pre>
<keyword>new</keyword> x;
x = <number>5</number>;
<keyword>for</keyword> (<keyword>new</keyword> i = <number>0</number>; i < <number>x</number>; i++)
{
    <keyword>if</keyword> (i == <number>0</number>)
    {
        <keyword>break</keyword>; <comment># immediately stops the loop</comment>
    }

    <function>print</function>(i);
}
</pre>

### `continue`
- Purpose:
    - immediately stops the `current iteration` of a loop and moves to the next one
- Rules
    - can only be used inside of loops (`for`, `while`)

Syntax:
> **pure-dango**
<pre>
<keyword>continue</keyword>;
</pre>

Example:
> **pure-dango**
<pre>
<keyword>new</keyword> fizz = <number>5</number>;
<keyword>new</keyword> buzz = <number>7</number>;
<keyword>for</keyword> (<keyword>new</keyword> i = <number>0</number>; i < fizz + buzz; i += 2)
{
    <keyword>if</keyword> (i == <number>5</number>)
    {
        <keyword>continue</keyword>; <comment># skips this iteration and goes to the next one</comment>
    }

    <function>print</function>(i);
}
</pre>

### `function`
- Purpose:
    - creates a new callable variable containing bytecode block
- Rules
    - cannot redeclare existing functions
    - requires curly braces around code block
    - requires parentheses around parameters
    - parameters are dynamically typed
    - functions return `null` if no `return` is used
    - functions cannot chain. (i.e., `f()()` is not supported)
- Function Semantics
    - functions are stored as variables
    - functions are assigned by reference
    - functions can be:
      - reassigned
      - passed as arguments
      - stored in variables
      - returned from other functions

Syntax:
> **pure-dango**
<pre>
<keyword>function</keyword> <example>name</example>(<example>parameters</example>)
{
    <example>...</example>
}
</pre>

Example:
> **pure-dango**
<pre>
<keyword>function</keyword> add(a, b)
{
    <keyword>return</keyword> a + b;
}

new op = <function>add</function>;
<keyword>print</keyword>(<function>op</function>(<number>2</number>, <number>3</number>));   <comment># prints "5"</comment>

<function>add</function> = <number>10</number>;
<keyword>print</keyword>(<function>op</function>(<number>2</number>, <number>3</number>));   <comment># still prints "5" because op still points to the original function</comment>
</pre>

### `return`
- Purpose:
    - exits a `function` and optionally returns a value
- Rules
    - `;` is needed after the value you want to return. (i.e. return 5;)
    - if no value is provided, the function returns `null`
    - immediately stops a function when called

Syntax:
> **pure-dango**
<pre>
<keyword>return</keyword> <example>value</example>;
</pre>

Example:
> **pure-dango**
<pre>
<comment># with return</comment>
<keyword>function</keyword> pow(a, b)
{
    <keyword>return</keyword> raise(a, b);
}

<function>print</function>(<function>pow</function>(<number>2</number>, <number>2</number>)) <comment># prints "4"</comment>

<comment># without return</comment>
<keyword>function</keyword> greet(name)
{
    <function>print</function>(<string>"Hello, "</string>, name);
}

<function>greet</function>(<string>"alice"</string>) <comment># prints "Hello, alice"</comment>
</pre>



## BUILT IN FUNCTIONS
### `print`
- Purpose:
    - prints text to the console

Syntax:
> **pure-dango**
<pre>
<function>print</function>(<example>...</example>);
</pre>

Example:
> **pure-dango**
<pre>
<keyword>new</keyword> greet1 = <string>"hello "</string>;
<keyword>new</keyword> greet2 = <string>"world!"</string>;
<function>print</function>(greet1, greet2); <comment># prints out "hello world!"</comment>
</pre>

### `now`
- Purpose:
    - returns the current timestamp in milliseconds

Syntax:
> **pure-dango**
<pre>
<function>now</function>();
</pre>

Example:
> **pure-dango**
<pre>
<keyword>new</keyword> start = <function>now</function>();
<keyword>new</keyword> iterations = <number>10000</number>;

<keyword>new</keyword> i = 0
<keyword>for</keyword> (i = 0; i < iterations; i++)
{
    <keyword>new</keyword> temp = i * <number>2</number>;
}

<keyword>new</keyword> end = <function>now</function>();

<function>print</function>("Loop time: ", end-start);
</pre>

### `setPrecision`
- Purpose:
    - sets Decimal precision to <example>precision</example>
- Rules:
    - throws an error if the true value of <example>precision</example> isn't a number

Syntax:
> **pure-dango**
<pre>
<function>setPrecision</function>(<example>precision</example>);
</pre>

Example:
> **pure-dango**
<pre>
<function>setPrecision</function>(<number>1000</number>);

<keyword>new</keyword> result = <number>1.01</number>;

<keyword>new</keyword> i = <number>0</number>;
<keyword>for</keyword> (i = <number>0</number>; i < <number>6</number>; i++)
{
    result += <function>raise</function>(result, i);
}

<function>print</function>(result); <comment># prints "2.075335420483538463387032931950717991643172131537589056731451534099765834960354642594532814087239997711781608519664648636522078428226943812450152800863173055702053951473991251429359622489604075730331078526506212598922643479526468070637501458922142146609368329751088648017607092245660106731348096824975011379053724696576e+78" because Decimal has limits.</comment>
</pre>

### `raise`
- Purpose:
    - gets the <example>exponent</example>th power of <example>base</example>
- Rules:
    - the return value will be mixed
    - throws an error if not exactly <number>2</number> or <number>3</number> parameters are provided
    - the third parameter <example>useNativeMath</example> is optional but affects the result if provided.

Syntax:
> **pure-dango**
<pre>
<function>raise</function>(<example>base</example>, <example>exponent</example>, <example>useNativeMath</example>);
</pre>

Example:
> **pure-dango**
<pre>
<comment># using precise math</comment>
<keyword>new</keyword> base = <number>2</number>;
<keyword>new</keyword> exp = <number>100</number>;

<function>print</function>(<function>raise</function>(base, exp)); <comment># prints "1267650600228229401496703205376"</comment>

<comment># using native JavaScript built in Math</comment>
<keyword>new</keyword> base = <number>2</number>;
<keyword>new</keyword> exp = <number>100</number>;

<function>print</function>(<function>raise</function>(base, exp, <keyword>true</keyword>)); <comment># prints "1.2676506002282294e+30"</comment>
</pre>

### `root`
- Purpose:
    - gets the <example>root</example>th root of <example>base</example>
- Rules:
    - the return value will be a Decimal
    - throws an error if not exactly <number>2</number> or <number>3</number> parameters are provided
    - the third parameter <example>useNativeMath</example> is optional but affects the result if provided.

Syntax:
> **pure-dango**
<pre>
<function>root</function>(<example>base</example>, <example>root</example>, <example>useNativeMath</example>);
</pre>

Example:
> **pure-dango**
<pre>
<comment># using precise math</comment>
<keyword>new</keyword> base = <number>1000000000000000000000000000000000000000000000000000000</number>;
<keyword>new</keyword> root = <number>2</number>;

<function>print</function>(<function>root</function>(base, root)); <comment># prints "1000000000000000000000000000"</comment>

<comment># using native JavaScript built in Math</comment>
<keyword>new</keyword> base = <number>1000000000000000000000000000000000000000000000000000000</number>;
<keyword>new</keyword> root = <number>2</number>;

<function>print</function>(<function>root</function>(base, root, <keyword>true</keyword>)); <comment># prints "1e+27"</comment>
</pre>

### `concat`
- Purpose:
    - joins multiple values or strings into a single string

Syntax:
> **pure-dango**
<pre>
<function>concat</function>(<example>...</example>);
</pre>

Example:
> **pure-dango**
<pre>
<keyword>new</keyword> part1 = <string>"pure"</string>;
<keyword>new</keyword> separator = <string>"-"</string>;
<keyword>new</keyword> part2 = <string>"dango"</string>;

<function>print</function>(<function>concat</function>(part1, separator, part2));   <comment># prints "pure-dango"</comment>
</pre>

### `input`
- Purpose:
    - joins all the arguments into a single string, then prompts the joined string to the console, and finally  returns the user's answer
- Rules:
    - all arguments are converted to strings before prompting

Syntax:
> **pure-dango**
<pre>
<function>input</function>(<example>...</example>);
</pre>

Example:
> **pure-dango**
<pre>
<keyword>new</keyword> name = input(<string>"What is your name"</string>, <string>"?: "</string>);

<function>print</function>(<string>"Hello "</string>, name, <string>"!"</string>);
</pre>
