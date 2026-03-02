import Decimal from "decimal.js";

// runtime errors
class ConstantAssignmentOperator extends Error
{
    constructor(variableName : string)
    {
        super(`Assignment to a constant "${variableName}"`);
        this.name = "ConstantAssignmentOperator";
    }
}

class FileNotFoundError extends Error
{
    constructor(path : string)
    {
        super(`File "${path}" was not found`);
        this.name = "FileNotFoundError";
    }
}

class FunctionError extends Error
{
    constructor(functionName : string)
    {
        super(`Function "${functionName}" does not exist`);
        this.name = "FunctionError";
    }
}

class StackError extends Error
{
    constructor()
    {
        super(`POP on empty stack`);
        this.name = "StackError";
    }
}

class MissingStackTokenError extends Error
{
    constructor(expected : string | number)
    {
        super(`Expected a value after "${expected}"`);
        this.name = "MissingTokenError";
    }
}

class BreakError extends Error
{
    constructor()
    {
        super("Break statement outside of loop");
        this.name = "BreakError";
    }
}

class ContinueError extends Error
{
    constructor()
    {
        super("Continue statement outside of loop");
        this.name = "ContinueError";
    }
}

class DivisionByZero extends Error
{
    constructor(left : number | Decimal | bigint, right : number | Decimal | bigint)
    {
        super(`Operands must not divide by 0: "${left}/${right}`);
        this.name = "DivisionByZero";
    }
}

class InternalError extends Error
{
    constructor(message: string)
    {
        super(message);
        this.name = "InternalError";
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
    FileNotFoundError,
    InternalError
}

// parsing errors
class SyntaxError extends Error
{
    constructor(message : string, row : number, column : number)
    {
        super(`${message} at row ${row}, char ${column}`);
        this.name = "SyntaxError";
    }
}

class FunctionCallError extends SyntaxError {
    constructor(message : string, row : number, column : number) 
    {
        super(message, row, column);
        this.name = "FunctionCallError";
    }
}

class ChainedFunctionCallError extends SyntaxError
{
    constructor (name : string, row : number, column : number)
    {
        super(`Chained function calls are not allowed: "${name}(...)()"`, row, column);
        this.name = "ChainedFunctionCallError";
    }
}

class ChainedIncDecError extends SyntaxError
{
    constructor (row : number, column : number)
    {
        super(`Chained increment/decrement operators are not allowed`, row, column);
        this.name = "ChainedIncDecError";
    }
}

class InvalidPostfixError extends SyntaxError
{
    constructor (operator : string, type : string, value : any, row : number, column : number)
    {
        super(`Cannot apply "${operator}" to ${type.toLocaleLowerCase()} "${value}"`, row, column);
        this.name = "InvalidPostfixError";
    }
}

class AssignmentError extends SyntaxError
{
    constructor(operator : any, row : number, column : number)
    {
        super(`Left side of "${operator}" must be a variable`, row, column);
        this.name = "AssignmentError";
    }
}

class UnexpectedTokenError extends SyntaxError
{
    constructor(tokenValue : any, row : number, column : number)
    {
        super(`Unexpected token "${tokenValue}"`, row, column);
        this.name = "UnexpectedTokenError";
    }
}

class MissingTokenError extends SyntaxError
{
    constructor(expected : string, row : number, column : number)
    {
        super(`Expected "${expected}"`, row, column);
        this.name = "MissingTokenError";
    }
}

class MissingRightSide extends SyntaxError
{
    constructor(after : any, row : number, column : number)
    {
        super(`Expected an expression or value after "${after}"`, row, column);
        this.name = "MissingTokenError";
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
    MissingRightSide
}

// utils errors

class NegativeExponentError extends Error
{
    constructor(exponent : number | Decimal | bigint)
    {
        super(`Exponent "${exponent}" must be positive when raising BigInt`);
        this.name = "NegativeExponentError";
    }
}

class FunctionArgumentError extends Error
{
    constructor(functionName : string, maxLength : number, plural : string)
    {
        super(`Function "${functionName}" only takes ${maxLength} ${plural}`);
        this.name = "FunctionArgumentError";
    }
}

export const utilsErrors = 
{
    NegativeExponentError,
    FunctionArgumentError
}