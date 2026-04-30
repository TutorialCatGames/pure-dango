export class GeneralError extends Error
{
    constructor(name : string, message : string)
    {
        super(`[ERROR] ${name}:\n${message}`);
        this.name = "";
    }
}

// singular tokenizer error
export class Tokenizer extends GeneralError
{
    constructor(message : string, row : number, column : number)
    {
        super(`Tokenizer [${row}:${column}]`, message);
    }
}

// runtime errors
class ConstantAssignmentOperator extends GeneralError
{
    constructor(variableName : string)
    {
        super(`ConstantAssignmentOperator`, `assignment to a constant "${variableName}"`);
    }
}

class FunctionError extends GeneralError
{
    constructor(functionName : string) 
    {
        super("FunctionError", `function "${functionName}" does not exist`);
    }
}

class StackError extends GeneralError
{
    constructor()
    {
        super("StackError", `pop on empty stack`);
    }
}

class MissingStackTokenError extends GeneralError
{
    constructor(expected : string | number)
    {
        super("MissingTokenError", `expected a value after "${expected}"`);
    }
}

class BreakError extends GeneralError
{
    constructor()
    {
        super("BreakError", `break statement outside of loop`);
    }
}

class ContinueError extends GeneralError
{
    constructor()
    {
        super("ContinueError", `continue statement outside of loop`);
    }
}

class DivisionByZero extends GeneralError
{
    constructor(left : bigint | any, right : bigint | any)
    {
        super("DivisionByZero", `operands must not divide by 0, got "${left}/${right}"`);
    }
}

class InternalError extends GeneralError
{
    constructor(message: string)
    {
        super("InternalError", message);
    }
}

class MethodError extends GeneralError
{
    constructor(methodName: string)
    {
        super("MethodError", `method "${methodName}" does not exist`);
    }
}

class PropertyError extends GeneralError
{
    constructor(methodName: string)
    {
        super("PropertyError", `property "${methodName}" does not exist`);
    }
}

class ClassError extends GeneralError
{
    constructor(className: string)
    {
        super("ClassError", `"${className}" is not a class`);
    }
}

export const runtimeErrors =
{
    FunctionError,
    ConstantAssignmentOperator,
    BreakError,
    ContinueError,
    StackError,
    MissingStackTokenError,
    DivisionByZero,
    InternalError,
    MethodError,
    PropertyError,
    ClassError
}

// parsing errors
class SyntaxError extends GeneralError
{
    constructor(message : string, row : number, column : number)
    {
        super("SyntaxError", `${message} at line ${row}:${column}`);
    }
}

class FunctionCallError extends SyntaxError 
{
    constructor(message : string, row : number, column : number) 
    {
        super(message, row, column);
    }
}

class ChainedFunctionCallError extends SyntaxError
{
    constructor (name : string, row : number, column : number)
    {
        super(`chained function calls are not allowed: "${name}(...)()"`, row, column);
    }
}

class ChainedIncDecError extends SyntaxError
{
    constructor (row : number, column : number)
    {
        super(`chained increment/decrement operators are not allowed`, row, column);
    }
}

class InvalidPostfixError extends SyntaxError
{
    constructor (operator : string, type : string, value : any, row : number, column : number)
    {
        super(`cannot apply "${operator}" to ${type.toLocaleLowerCase()} "${value}"`, row, column);
    }
}

class AssignmentError extends SyntaxError
{
    constructor(operator : any, row : number, column : number)
    {
        super(`left side of "${operator}" must be a variable`, row, column);
    }
}

class UnexpectedTokenError extends SyntaxError
{
    constructor(tokenValue : any, row : number, column : number)
    {
        super(`unexpected token "${tokenValue}"`, row, column);
    }
}

class MissingTokenError extends SyntaxError
{
    constructor(expected : string, row : number, column : number)
    {
        super(`expected "${expected}"`, row, column);
    }
}

class MissingRightSide extends SyntaxError
{
    constructor(after : any, row : number, column : number)
    {
        super(`rxpected an expression or value after "${after}"`, row, column);
    }
}

class UnaryOperatorError extends SyntaxError
{
    constructor(value : any, row : number, column : number)
    {
        super(`unknown fix type for unary operator "${value}"`, row, column);
    }
}

export const parseErrors = 
{
    FunctionCallError,
    ChainedFunctionCallError,
    ChainedIncDecError,
    AssignmentError,
    UnexpectedTokenError,
    MissingTokenError,
    InvalidPostfixError,
    MissingRightSide,
    UnaryOperatorError
}

// utils errors

class NegativeExponentError extends GeneralError
{
    constructor(exponent : number | bigint | any)
    {
        super("NegativeExponentError", `exponent "${exponent}" must be positive when raising BigInt`);
    }
}

class FunctionArgumentError extends GeneralError
{
    constructor(functionName : string, maxLength : number, plural : string)
    {
        super("FunctionArgumentError", `function "${functionName}" only takes ${maxLength} ${plural}`);
    }
}

export const utilsErrors = 
{
    NegativeExponentError,
    FunctionArgumentError
}